// Spec § 8 — Website -> Zoho retry policy for the D2.1 webhook receiver.
//
// ⚠ THE BUDGET IS THE BOUND. THE ATTEMPT COUNT IS A CEILING THAT NEVER FIRES.
//
// § 8.2 specifies "5 attempts with exponential backoff: 500ms, 1s, 2s, 4s, 8s"
// AND "MUST NOT hold Stripe's connection open past 8s", as if both bounds were
// live. Measured 2026-07-31, at 200 / 350 / 500ms Zoho latency:
//
//     attempts fitting in the 8s budget: 4, 4, 4  — always stopped by BUDGET
//     sum of all 5 backoffs alone: 15500ms = 1.94x the entire budget
//     the final 8000ms backoff alone EQUALS the entire budget
//
// So the 5th attempt is unreachable at ANY latency. `runRetryLadder` therefore
// takes the budget explicitly and reports which bound actually stopped it, so a
// caller cannot reason about retry tolerance the handler does not have. A test
// pins that under spec's own numbers the reason is always `exhausted_budget`.

export const SPEC_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;
export const SPEC_MAX_ATTEMPTS = 5;
/** § 2.2 internal budget — the Worker must not hold Stripe's connection longer. */
export const STRIPE_CONNECTION_BUDGET_MS = 8000;
export const JITTER_FRACTION = 0.1;

/** What a single Zoho call reported. Mirrors `ZohoResult` structurally. */
export interface AttemptResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export type StopReason =
  | "success"
  /** Ladder ran out of attempts. Per finding D this should never occur under spec numbers. */
  | "exhausted_attempts"
  /** Ran out of Stripe connection budget — the bound that actually fires. */
  | "exhausted_budget"
  /** § 8.4: a non-retryable client error. Stopped deliberately at the first sight of it. */
  | "non_retryable";

export interface LadderOutcome {
  ok: boolean;
  attempts: number;
  elapsedMs: number;
  stopReason: StopReason;
  last: AttemptResult | null;
  /** § 8.3 — a forced token refresh happened; it does NOT consume ladder budget. */
  refreshedAuth: boolean;
  /** § 8.4 — the one permitted duplicate-invoice_number recompute was used. */
  recomputedInvoiceNumber: boolean;
}

export interface LadderDeps {
  nowMs: () => number;
  sleep: (ms: number) => Promise<void>;
  /** § 8.3 one-shot token refresh. Returns true if a fresh token was obtained. */
  refreshAuth?: () => Promise<boolean>;
  /** § 8.4 / CBM § 3.3 Option A — recompute max+1 exactly once on a collision. */
  recomputeInvoiceNumber?: () => Promise<boolean>;
  /** Deterministic in tests; Math.random in production. */
  jitter?: () => number;
}

export interface LadderOptions {
  budgetMs?: number;
  maxAttempts?: number;
  backoffMs?: readonly number[];
}

/**
 * § 8.4 — is this response worth another identical attempt?
 *
 * 5xx and 429 are transient. 401 is handled separately (§ 8.3). EVERY OTHER 4xx
 * is a client-side bug or config drift: a missing custom field, a malformed
 * customer_id. Retrying those burns the Stripe connection budget on a request
 * that will fail identically, and delays the DLQ deposit that IS the correct
 * outcome.
 */
export function isRetryable(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500) return true;
  // status 0 = transport failure (fetch threw) — genuinely transient.
  if (status === 0) return true;
  return false;
}

/** § 8.4 third bullet — Zoho's duplicate invoice_number collision. */
export function isDuplicateInvoiceNumber(result: AttemptResult): boolean {
  if (result.status !== 400) return false;
  const text = JSON.stringify(result.body ?? "").toLowerCase();
  return text.includes("invoice number") && text.includes("already");
}

function applyJitter(ms: number, jitter: () => number): number {
  // ±10% per § 8.2. jitter() in [0,1) -> factor in [0.9, 1.1).
  const factor = 1 - JITTER_FRACTION + jitter() * (2 * JITTER_FRACTION);
  return Math.round(ms * factor);
}

/**
 * Run `op` under § 8.2's ladder, bounded FIRST by the Stripe connection budget.
 *
 * `op` must not throw — it returns an `AttemptResult`. A throwing `op` is
 * treated as a transport failure (status 0) rather than propagating, because an
 * exception at this layer is indistinguishable at the Stripe boundary from a
 * Worker crash, which Stripe retries against input that may never succeed.
 */
export async function runRetryLadder(
  op: () => Promise<AttemptResult>,
  deps: LadderDeps,
  options: LadderOptions = {},
): Promise<LadderOutcome> {
  const budgetMs = options.budgetMs ?? STRIPE_CONNECTION_BUDGET_MS;
  const maxAttempts = options.maxAttempts ?? SPEC_MAX_ATTEMPTS;
  const backoff = options.backoffMs ?? SPEC_BACKOFF_MS;
  const jitter = deps.jitter ?? Math.random;

  const started = deps.nowMs();
  let attempts = 0;
  let last: AttemptResult | null = null;
  let refreshedAuth = false;
  let recomputedInvoiceNumber = false;

  const elapsed = () => deps.nowMs() - started;

  for (;;) {
    if (attempts >= maxAttempts) {
      return done("exhausted_attempts");
    }

    attempts += 1;
    last = await safeCall(op);

    if (last.ok) return done("success");

    // --- § 8.3: 401 gets ONE forced refresh, outside the ladder budget. ---
    if (last.status === 401 && !refreshedAuth && deps.refreshAuth) {
      refreshedAuth = true;
      const got = await deps.refreshAuth();
      if (got) {
        // Immediate re-attempt; § 8.3 says this does not consume ladder budget,
        // so it does not count as an attempt and skips the backoff.
        attempts -= 1;
        continue;
      }
      return done("non_retryable");
    }

    // --- § 8.4: duplicate invoice_number gets EXACTLY ONE recompute. ---
    if (
      isDuplicateInvoiceNumber(last) &&
      !recomputedInvoiceNumber &&
      deps.recomputeInvoiceNumber
    ) {
      recomputedInvoiceNumber = true;
      const ok = await deps.recomputeInvoiceNumber();
      if (ok) continue; // retry immediately with the new number, no backoff
      return done("non_retryable");
    }

    // --- § 8.4: any other non-retryable status stops the ladder NOW. ---
    if (!isRetryable(last.status)) return done("non_retryable");

    // --- backoff, but only if it fits inside the remaining budget ---
    const idx = Math.min(attempts - 1, backoff.length - 1);
    const wait = applyJitter(backoff[idx], jitter);
    if (elapsed() + wait > budgetMs) return done("exhausted_budget");
    await deps.sleep(wait);
    if (elapsed() >= budgetMs) return done("exhausted_budget");
  }

  function done(stopReason: StopReason): LadderOutcome {
    return {
      ok: stopReason === "success",
      attempts,
      elapsedMs: elapsed(),
      stopReason,
      last,
      refreshedAuth,
      recomputedInvoiceNumber,
    };
  }
}

async function safeCall(op: () => Promise<AttemptResult>): Promise<AttemptResult> {
  try {
    return await op();
  } catch (err) {
    return { ok: false, status: 0, body: { transport_error: String(err) } };
  }
}
