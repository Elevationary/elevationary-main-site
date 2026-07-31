// Spec § 9 — Error-handling posture for the D2.1 webhook receiver.
//
//   § 9.1  DLQ object shape + R2 key
//   § 9.2  Telegram page on deposit  (INTENT ONLY — see the note below)
//   § 9.3  Hard-reject vs transient-retry taxonomy
//   § 9.4  Stuck-retry-loop page suppression
//
// ⚠ § 9.2's page is specified as `send_notification.py "Website" "..."` — a
// PYTHON CLI. Cloudflare Workers have no process, no filesystem, and no shell,
// so that line cannot execute in the runtime that owns the deposit. This module
// therefore builds the page INTENT (exact § 9.2 text + a suppression decision)
// and does NOT send. Wiring it to a real transport needs a Telegram bot token,
// which is a 13th secret not present in § 11.1/§ 11.2's 12-secret contract —
// note that § 11.4's env-sync check asserts "all 12 present" and would pass
// while the pager is unreachable.
//
// ⚠ PII BOUNDARY: § 9.1 requires the FULL Stripe event verbatim, because § 9.5
// replay depends on it. Redacting here would break recovery. The boundary is
// enforced at the bucket (§ 9.6: public-access OFF, Worker-only write, 90-day
// lifecycle) — a DEPLOY-TIME control, not a code-time one. Nothing in this file
// makes the DLQ safe on its own.

import type { TransformRejectCode } from "./stripe_event_transform";

export const DLQ_PAGED_PREFIX = "dlq-paged-";
/** § 9.4 — 24h suppression window. Well above KV's 60s expirationTtl floor. */
export const DLQ_PAGE_SUPPRESSION_TTL_SEC = 86400;

// ---------------------------------------------------------------------------
// Injected surfaces
// ---------------------------------------------------------------------------

export interface DlqKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

// ---------------------------------------------------------------------------
// § 9.1 — object key + body
// ---------------------------------------------------------------------------

/**
 * § 9.1 key: `YYYY/MM/DD/${event_id}_${event_type}.json`
 *
 * ⚠ OBSERVABLE CONSEQUENCE, documented rather than "fixed": the key is DATE-
 * scoped, not attempt-scoped. Stripe retries the same event.id for up to 3 days,
 * so every same-day retry OVERWRITES its predecessor and `retry_attempts`
 * reflects the LAST deposit, not the cumulative total. Crossing midnight UTC
 * produces a second object for the same event.
 *
 * Not changed to a per-attempt key because § 9.5 replay looks an item up BY
 * EVENT ID, and a proliferating key space would break that lookup. If cumulative
 * attempt history is ever needed, it belongs in the object body, not the key.
 */
export function dlqObjectKey(eventId: string, eventType: string, atIso: string): string {
  const d = atIso.slice(0, 10); // YYYY-MM-DD, already UTC from toISOString()
  const [yyyy, mm, dd] = d.split("-");
  return `${yyyy}/${mm}/${dd}/${sanitiseSegment(eventId)}_${sanitiseSegment(eventType)}.json`;
}

/** Keys must not carry path separators or an attacker-influenced traversal. */
function sanitiseSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}

export interface DlqErrorMeta {
  step: string;
  zoho_status: number;
  zoho_body: string;
  retry_attempts: number;
  final_error_at: string;
}

export interface DlqWorkerMeta {
  cf_ray: string | null;
  colo: string | null;
  isolate_start_time: string | null;
}

export interface DlqObject {
  stripe_event: unknown;
  error: DlqErrorMeta;
  worker_metadata: DlqWorkerMeta;
}

export function buildDlqObject(
  stripeEvent: unknown,
  error: DlqErrorMeta,
  worker: Partial<DlqWorkerMeta> = {},
): DlqObject {
  return {
    stripe_event: stripeEvent,
    error,
    worker_metadata: {
      cf_ray: worker.cf_ray ?? null,
      colo: worker.colo ?? null,
      isolate_start_time: worker.isolate_start_time ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// § 9.4 — page suppression
// ---------------------------------------------------------------------------

export function pagedMarkerKey(eventId: string): string {
  return DLQ_PAGED_PREFIX + eventId;
}

/**
 * § 9.4 — first deposit for an event.id pages; repeats inside 24h do not.
 *
 * FAIL-OPEN ON PURPOSE: if KV is unreadable we PAGE. The failure being guarded
 * against is alarm fatigue; the failure being risked by staying silent is an
 * unnoticed revenue stoppage. Duplicate pages are recoverable by a human
 * ignoring one. A missed page is not.
 */
export async function shouldPage(
  kv: DlqKv | undefined,
  eventId: string,
): Promise<{ page: boolean; reason: "first" | "suppressed_24h" | "kv_unavailable" }> {
  if (!kv) return { page: true, reason: "kv_unavailable" };
  try {
    const existing = await kv.get(pagedMarkerKey(eventId));
    if (existing !== null) return { page: false, reason: "suppressed_24h" };
  } catch {
    return { page: true, reason: "kv_unavailable" };
  }
  return { page: true, reason: "first" };
}

/** Records that a page fired. Best-effort — a lost marker costs one extra page. */
export async function markPaged(
  kv: DlqKv | undefined,
  eventId: string,
  atIso: string,
): Promise<boolean> {
  if (!kv) return false;
  try {
    await kv.put(pagedMarkerKey(eventId), atIso, {
      expirationTtl: DLQ_PAGE_SUPPRESSION_TTL_SEC,
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// § 9.2 — page intent (built, never sent; see header)
// ---------------------------------------------------------------------------

export interface PageIntent {
  agent: "Website";
  message: string;
}

export function buildPageIntent(args: {
  eventType: string;
  eventId: string;
  step: string;
  retryAttempts: number;
  r2Key: string;
}): PageIntent {
  return {
    agent: "Website",
    message:
      `DLQ: ${args.eventType} ${args.eventId} — ${args.step} failed after ` +
      `${args.retryAttempts} attempts. R2 key: ${args.r2Key}.`,
  };
}

// ---------------------------------------------------------------------------
// § 9.3 — the taxonomy
// ---------------------------------------------------------------------------

export type DispositionCategory =
  | "hard_reject"
  | "config_error"
  | "zoho_client_error"
  | "zoho_transient"
  | "zoho_auth"
  | "unsubscribed_event"
  | "revenue_impact";

export interface Disposition {
  category: DispositionCategory;
  /** HTTP status to return to Stripe. */
  httpStatus: number;
  dlq: boolean;
  page: boolean;
  /** Why, in one line — carried into the DLQ body's `step` for forensics. */
  rationale: string;
}

/**
 * § 9.3 disposition for a 2c transform reject.
 *
 * ⚠ THIS FUNCTION EXISTS BECAUSE 2c RETURNS ALL EIGHT REJECT CODES THROUGH ONE
 * SHAPE, AND § 9.3 GIVES TWO OF THEM OPPOSITE DISPOSITIONS.
 *
 *   event_type_unsupported -> 200 OK, no DLQ, NO PAGE
 *   billing_reason_unknown -> 5xx,    DLQ,    PAGE IMMEDIATELY
 *
 * The obvious handler — `if (!verdict.ok) { dlq(); page(); return 500 }` — is
 * wrong in BOTH directions at once. Stripe fires unsubscribed event types as
 * ordinary traffic, so a uniform reject-handler pages the CEO on routine events,
 * and § 9.4's suppression CANNOT help because each carries a distinct event.id
 * — i.e. the defect defeats the very control built to prevent alarm fatigue.
 * Inverted, a uniform 200 silently swallows the revenue-impact case.
 *
 * The `switch` below has NO `default`. Adding a 9th code to
 * `TransformRejectCode` will FAIL `tsc` here until its § 9.3 row is decided.
 * That is deliberate: enforcement by construction, not by code review.
 */
export function classifyTransformReject(code: TransformRejectCode): Disposition {
  switch (code) {
    case "event_type_unsupported":
      // § 9.3 row 6. Routine Stripe traffic — NOT an error.
      return {
        category: "unsubscribed_event",
        httpStatus: 200,
        dlq: false,
        page: false,
        rationale: "event type outside the §4.1 subscribed set; acknowledged and logged",
      };

    case "billing_reason_unknown":
      // § 9.3 row 7. Stripe API change on a money path.
      return {
        category: "revenue_impact",
        httpStatus: 500,
        dlq: true,
        page: true,
        rationale: "unknown billing_reason on invoice.payment_succeeded — potential revenue impact",
      };

    // The remaining six are malformed-payload cases on a subscribed event: the
    // money shape could not be built. Retrying an identical payload cannot help,
    // but the event IS in scope and revenue may be uncaptured, so they DLQ and
    // page. 5xx keeps Stripe's delivery marked failed so a fix inside the 3-day
    // window can still be replayed (§9.5) — Layer 1/2 idempotency prevents the
    // double-create that would otherwise imply.
    case "invoice_malformed":
    case "line_items_missing":
    case "product_unexpanded":
    case "amount_not_integer":
    case "charge_reference_missing":
    case "charge_reference_too_long":
      return {
        category: "revenue_impact",
        httpStatus: 500,
        dlq: true,
        page: true,
        rationale: `transform reject '${code}' on a subscribed event — payload could not be mapped`,
      };
  }
}

/** § 9.3 rows 1-5 — dispositions keyed on where the failure happened. */
export function classifyOperationalFailure(
  kind:
    | "signature_invalid"
    | "missing_env"
    | "zoho_4xx"
    | "zoho_transient"
    | "zoho_401"
    | "binding_failure",
): Disposition {
  switch (kind) {
    case "signature_invalid":
      // § 9.3 row 1 — NO DLQ and NO page, deliberately: an attacker probing
      // signatures must not be able to drive our alerting or fill the DLQ.
      return {
        category: "hard_reject",
        httpStatus: 401,
        dlq: false,
        page: false,
        rationale: "signature/timestamp rejection — no oracle, no alert amplification",
      };
    case "missing_env":
      return {
        category: "config_error",
        httpStatus: 500,
        dlq: true,
        page: true,
        rationale: "required env var missing",
      };
    case "zoho_4xx":
      return {
        category: "zoho_client_error",
        httpStatus: 500,
        dlq: true,
        page: true,
        rationale: "Zoho 4xx (non-401/429) — client-side bug or config drift; not retryable",
      };
    case "zoho_transient":
      return {
        category: "zoho_transient",
        httpStatus: 500,
        dlq: true,
        page: true,
        rationale: "Zoho 5xx/429 persisted past the §8.2 ladder",
      };
    case "zoho_401":
      return {
        category: "zoho_auth",
        httpStatus: 500,
        dlq: true,
        page: true,
        rationale: "Zoho 401 persisted after forced token refresh",
      };
    case "binding_failure":
      // Increment 3 finding C: a §4.3.1 binding failure is PERMANENT. It reaches
      // here rather than the transient row precisely so it is never retried as
      // one.
      return {
        category: "zoho_client_error",
        httpStatus: 500,
        dlq: true,
        page: true,
        rationale: "query-binding assertion failed — filter did not bind; permanent, not transient",
      };
  }
}
