import { describe, it, expect } from "vitest";
import {
  runRetryLadder,
  isRetryable,
  isDuplicateInvoiceNumber,
  SPEC_BACKOFF_MS,
  SPEC_MAX_ATTEMPTS,
  STRIPE_CONNECTION_BUDGET_MS,
  type AttemptResult,
  type LadderDeps,
} from "../src/retry_ladder";

/** Virtual clock: sleep advances time instantly, so tests stay sub-millisecond. */
function fakeClock(startMs = 0) {
  let t = startMs;
  const slept: number[] = [];
  const deps: LadderDeps = {
    nowMs: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    jitter: () => 0.5, // exactly 1.0x — no jitter, deterministic
  };
  return {
    deps,
    slept,
    advance: (ms: number) => {
      t += ms;
    },
    get now() {
      return t;
    },
  };
}

/** An op that consumes `latencyMs` of clock per call and returns scripted results. */
function scriptedOp(results: AttemptResult[], clock: ReturnType<typeof fakeClock>, latencyMs = 0) {
  let i = 0;
  return async (): Promise<AttemptResult> => {
    clock.advance(latencyMs);
    const r = results[Math.min(i, results.length - 1)];
    i += 1;
    return r;
  };
}

const OK: AttemptResult = { ok: true, status: 200, body: { invoice: { invoice_id: "1" } } };
const R503: AttemptResult = { ok: false, status: 503, body: {} };
const R429: AttemptResult = { ok: false, status: 429, body: {} };
const R400: AttemptResult = { ok: false, status: 400, body: { message: "bad field" } };
const R401: AttemptResult = { ok: false, status: 401, body: { message: "expired" } };
const RDUP: AttemptResult = {
  ok: false,
  status: 400,
  body: { message: "Invoice Number already exists." },
};

describe("§8.4 retryability classification", () => {
  it("5xx, 429 and transport-failure(0) are retryable", () => {
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(0)).toBe(true);
  });

  it("other 4xx are NOT retryable — they fail identically every time", () => {
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(403)).toBe(false);
    expect(isRetryable(404)).toBe(false);
    expect(isRetryable(422)).toBe(false);
  });

  it("duplicate invoice_number is detected from the Zoho message", () => {
    expect(isDuplicateInvoiceNumber(RDUP)).toBe(true);
    expect(isDuplicateInvoiceNumber(R400)).toBe(false);
    expect(isDuplicateInvoiceNumber(R503)).toBe(false);
  });
});

describe("🔴 finding D — the budget is the bound; the 5th attempt never fires", () => {
  it("under SPEC's OWN numbers the ladder stops on BUDGET, never on attempts", async () => {
    // This is the regression guard for finding D. If a future spec revision ever
    // makes 5 attempts reachable, this test fails and tells someone.
    for (const latency of [200, 350, 500]) {
      const clock = fakeClock();
      const out = await runRetryLadder(
        scriptedOp([R503], clock, latency),
        clock.deps,
        // no options -> spec defaults
      );
      expect(out.stopReason).toBe("exhausted_budget");
      expect(out.stopReason).not.toBe("exhausted_attempts");
      expect(out.attempts).toBeLessThan(SPEC_MAX_ATTEMPTS);
      expect(out.ok).toBe(false);
    }
  });

  it("performs 4 attempts at every plausible Zoho latency, not the advertised 5", async () => {
    for (const latency of [200, 350, 500]) {
      const clock = fakeClock();
      const out = await runRetryLadder(scriptedOp([R503], clock, latency), clock.deps);
      expect(out.attempts).toBe(4);
    }
  });

  it("the arithmetic behind the finding: backoffs alone are ~1.94x the budget", () => {
    const total = SPEC_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(total).toBe(15500);
    expect(total).toBeGreaterThan(STRIPE_CONNECTION_BUDGET_MS);
    // The final backoff ALONE equals the whole budget -> unreachable by construction.
    expect(SPEC_BACKOFF_MS[SPEC_BACKOFF_MS.length - 1]).toBe(STRIPE_CONNECTION_BUDGET_MS);
  });

  it("never exceeds the budget it was given", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(scriptedOp([R503], clock, 300), clock.deps);
    expect(out.elapsedMs).toBeLessThanOrEqual(STRIPE_CONNECTION_BUDGET_MS);
  });

  it("a LARGER budget does reach the attempt ceiling — proving which bound bites", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(scriptedOp([R503], clock, 100), clock.deps, {
      budgetMs: 120_000,
    });
    expect(out.stopReason).toBe("exhausted_attempts");
    expect(out.attempts).toBe(SPEC_MAX_ATTEMPTS);
  });
});

describe("ladder happy paths", () => {
  it("first-attempt success does not sleep at all", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(scriptedOp([OK], clock, 200), clock.deps);
    expect(out).toMatchObject({ ok: true, attempts: 1, stopReason: "success" });
    expect(clock.slept).toEqual([]);
  });

  it("recovers on a later attempt and reports the count", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(scriptedOp([R503, R503, OK], clock, 200), clock.deps);
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(3);
    expect(out.stopReason).toBe("success");
  });

  it("applies the spec backoff sequence in order", async () => {
    const clock = fakeClock();
    await runRetryLadder(scriptedOp([R503, R503, OK], clock, 100), clock.deps);
    expect(clock.slept).toEqual([500, 1000]);
  });

  it("429 is retried like a 5xx", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(scriptedOp([R429, OK], clock, 100), clock.deps);
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
  });

  it("jitter stays within ±10%", async () => {
    for (const j of [0, 0.999]) {
      const clock = fakeClock();
      clock.deps.jitter = () => j;
      await runRetryLadder(scriptedOp([R503, OK], clock, 10), clock.deps);
      const slept = clock.slept[0];
      expect(slept).toBeGreaterThanOrEqual(450);
      expect(slept).toBeLessThanOrEqual(550);
    }
  });
});

describe("§8.4 non-retryable stops IMMEDIATELY", () => {
  it("a 400 stops at attempt 1 — it does not burn the budget", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(scriptedOp([R400], clock, 200), clock.deps);
    expect(out.stopReason).toBe("non_retryable");
    expect(out.attempts).toBe(1);
    expect(clock.slept).toEqual([]);
  });

  it("a 403 likewise stops at attempt 1", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(
      scriptedOp([{ ok: false, status: 403, body: {} }], clock, 200),
      clock.deps,
    );
    expect(out.attempts).toBe(1);
    expect(out.stopReason).toBe("non_retryable");
  });
});

describe("§8.3 401 forced refresh sits OUTSIDE the ladder budget", () => {
  it("refreshes once and the retry does NOT consume an attempt", async () => {
    const clock = fakeClock();
    let refreshes = 0;
    clock.deps.refreshAuth = async () => {
      refreshes += 1;
      return true;
    };
    const out = await runRetryLadder(scriptedOp([R401, OK], clock, 100), clock.deps);
    expect(out.ok).toBe(true);
    expect(refreshes).toBe(1);
    expect(out.refreshedAuth).toBe(true);
    // The 401 attempt was rolled back, so success lands on attempt 1.
    expect(out.attempts).toBe(1);
    expect(clock.slept).toEqual([]);
  });

  it("a failed refresh is non-retryable, not an infinite loop", async () => {
    const clock = fakeClock();
    clock.deps.refreshAuth = async () => false;
    const out = await runRetryLadder(scriptedOp([R401], clock, 100), clock.deps);
    expect(out.stopReason).toBe("non_retryable");
    expect(out.refreshedAuth).toBe(true);
  });

  it("a SECOND 401 after a successful refresh does not refresh again", async () => {
    const clock = fakeClock();
    let refreshes = 0;
    clock.deps.refreshAuth = async () => {
      refreshes += 1;
      return true;
    };
    const out = await runRetryLadder(scriptedOp([R401], clock, 100), clock.deps);
    expect(refreshes).toBe(1);
    expect(out.stopReason).toBe("non_retryable");
  });

  it("with no refreshAuth injected a 401 is simply non-retryable", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(scriptedOp([R401], clock, 100), clock.deps);
    expect(out.stopReason).toBe("non_retryable");
    expect(out.refreshedAuth).toBe(false);
  });
});

describe("§8.4 duplicate invoice_number — EXACTLY ONE recompute", () => {
  it("recomputes once then succeeds", async () => {
    const clock = fakeClock();
    let recomputes = 0;
    clock.deps.recomputeInvoiceNumber = async () => {
      recomputes += 1;
      return true;
    };
    const out = await runRetryLadder(scriptedOp([RDUP, OK], clock, 100), clock.deps);
    expect(out.ok).toBe(true);
    expect(recomputes).toBe(1);
    expect(out.recomputedInvoiceNumber).toBe(true);
  });

  it("a SECOND collision is NOT retried again — that is a deterministic bug, not contention", async () => {
    const clock = fakeClock();
    let recomputes = 0;
    clock.deps.recomputeInvoiceNumber = async () => {
      recomputes += 1;
      return true;
    };
    const out = await runRetryLadder(scriptedOp([RDUP], clock, 100), clock.deps);
    expect(recomputes).toBe(1); // exactly one, never a loop
    expect(out.stopReason).toBe("non_retryable");
  });

  it("a failed recompute stops the ladder", async () => {
    const clock = fakeClock();
    clock.deps.recomputeInvoiceNumber = async () => false;
    const out = await runRetryLadder(scriptedOp([RDUP], clock, 100), clock.deps);
    expect(out.stopReason).toBe("non_retryable");
  });
});

describe("ladder robustness", () => {
  it("a THROWING op becomes a transport failure, never propagates", async () => {
    const clock = fakeClock();
    const throwing = async (): Promise<AttemptResult> => {
      clock.advance(100);
      throw new Error("socket reset");
    };
    const out = await runRetryLadder(throwing, clock.deps);
    expect(out.ok).toBe(false);
    expect(out.last?.status).toBe(0);
    expect(out.stopReason).toBe("exhausted_budget");
  });

  it("reports the LAST result for the DLQ body", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(scriptedOp([R503], clock, 200), clock.deps);
    expect(out.last).toEqual(R503);
  });

  it("a zero budget performs exactly one attempt and stops", async () => {
    const clock = fakeClock();
    const out = await runRetryLadder(scriptedOp([R503], clock, 100), clock.deps, { budgetMs: 0 });
    expect(out.attempts).toBe(1);
    expect(out.stopReason).toBe("exhausted_budget");
  });
});
