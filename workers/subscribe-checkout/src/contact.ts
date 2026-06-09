// Spec § 3 step 2 + § 3.11 — Sales Contact resolve-or-create on R2.
// Closes spec ORS red-team R-10 + § 8 F-6 (contact-id collision) + § 8 F-7 (orphan acceptance).
//
// Worker reads/writes sales/contacts/<ct_id>.json directly against R2.
// Sales Agent owns the canonical schema (subscription.schema.json v2).
// TODO(Sales coordination): confirm § 3.11 shape matches before LIVE.
// Spec § 3.10 dry-run flag short-circuits R2 write for sign-off.

import type { Env, SalesContact, WorkerError } from "./types.js";

export interface ContactResolution {
  contact: SalesContact;
  was_existing: boolean;
}

// Spec § 3 step 2 — three outcomes:
//   1. Contact absent → create + return new SalesContact.
//   2. Contact exists, email matches → reuse, return existing.
//   3. Contact exists, email mismatches → return contact_collision error (F-6).
export async function resolveOrCreateContact(args: {
  env: Env;
  ctId: string;
  email: string; // already lowercased per spec § 3.6
  name: string;
  company: string;
}): Promise<ContactResolution | WorkerError> {
  const { env, ctId, email, name, company } = args;

  // Skeleton-state guard: if R2_SALES binding is absent (pre-activation),
  // synthesize an in-memory contact so the rest of the request can flow
  // through unit tests + dev mode. Production REQUIRES R2_SALES bound.
  // TODO(CEO Q6): R2_SALES binding is uncommented at activation in wrangler.toml.
  if (!env.R2_SALES) {
    return {
      contact: synthContact(ctId, email, name, company),
      was_existing: false,
    };
  }

  // Spec § 3.10 dry-run flag — short-circuit the R2 write for Sales schema
  // confirmation; log proposed shape instead of writing.
  const dryRun = env.DRY_RUN_CONTACT_WRITE === "true";

  const key = "sales/contacts/" + ctId + ".json";

  // 1. GET existing
  const existing = await env.R2_SALES.get(key);
  if (existing) {
    let parsed: SalesContact;
    try {
      parsed = JSON.parse(await existing.text()) as SalesContact;
    } catch {
      return {
        error: "contact_create_failed",
        message: "Existing Contact record is malformed.",
        status: 500,
      };
    }
    if (parsed.email !== email) {
      // F-6 collision — different buyer with same ct_id (extremely rare; until
      // Sales' contact-by-email uniqueness invariant lands).
      return {
        error: "contact_collision",
        message: "A Contact with this identifier already exists for a different email.",
        status: 400,
      };
    }
    return { contact: parsed, was_existing: true };
  }

  // 2. Create new
  const contact = synthContact(ctId, email, name, company);

  if (dryRun) {
    console.log("[DRY_RUN] Would PUT %s with: %s", key, JSON.stringify(contact));
    return { contact, was_existing: false };
  }

  try {
    await env.R2_SALES.put(key, JSON.stringify(contact), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (e) {
    return {
      error: "contact_create_failed",
      message: "Failed to persist Sales Contact record.",
      status: 500,
    };
  }
  return { contact, was_existing: false };
}

function synthContact(ctId: string, email: string, name: string, company: string): SalesContact {
  return {
    ct_id: ctId,
    email,
    name: name || "",
    company_id: null,
    company: company || "",
    source: "stripe_checkout_elevationary_com",
    created_at: new Date().toISOString(),
    notes: "",
  };
}
