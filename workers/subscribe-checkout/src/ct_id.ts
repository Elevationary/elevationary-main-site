// Spec § 3.4 — ct_id canonicalization algorithm.
// Closes spec ORS red-team R-3 (ambiguous derivation rule).
//
// Algorithm (deterministic, single-pass):
//   1. lowercased   = raw_email.toLowerCase()
//   2. validated    = passes § 3.2 regex (called by caller; this fn assumes pre-validated)
//   3. deplused     = strip "+suffix" from local-part: alice+work@acme.com → alice@acme.com
//   4. idified      = replace [@.] with "_": alice@acme.com → alice_acme_com
//   5. ct_id        = "ct_" + idified
//
// Coordination flag (spec § 3.4): Sales' current ct_id comments use the
// human-readable scheme ct_2026_alice_acme. Worker-generated IDs are
// email-derived (deterministic from at-first-checkout-time). Sales Agent
// confirms both coexist (or proposes unification) before LIVE.
// TODO(Sales coordination): confirm scheme + collision-handling alignment.

export function deriveCtId(rawEmail: string): string {
  const lowercased = rawEmail.toLowerCase();
  const deplused = lowercased.replace(/\+[^@]*@/, "@");
  const idified = deplused.replace(/[@.]/g, "_");
  return "ct_" + idified;
}
