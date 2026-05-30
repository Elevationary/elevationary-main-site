// Subscriber Content Entitlement Worker — Phase A (deny-by-default scaffold).
//
// Phase A behavior: respond 403 to every request. Echo the authenticated email
// (from cf-access-authenticated-user-email) when present so James can verify
// Cloudflare Access is enforcing in front. No R2 reads. No Stripe calls.
//
// Phase B (waits on Sales P1 Subscription schema) will:
//   1. Read sales/subscriptions/ from R2 (binding SALES_CRM).
//   2. Resolve contact_id from email via sales/contacts/.
//   3. Check active subscription entitlement (individual contact_id match OR
//      enterprise company_id OR-join).
//   4. Defense-in-depth: call Stripe subscriptions.retrieve to confirm
//      status=active (+50ms accepted per CEO ratification 2026-05-30).
//   5. On pass: render content from newsletter/drafts/<date>/ (binding
//      NEWSLETTER_CONTENT).
//   6. On fail: 302 to /upgrade?stream=<requested>&edition=<date>.

export interface Env {
  // Empty for Phase A. Phase B adds R2 bindings + Stripe secret.
}

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const email = request.headers.get("cf-access-authenticated-user-email");
    const url = new URL(request.url);

    if (!email) {
      return new Response(
        "Cloudflare Access not enforced for this route.\n\n" +
          "If you see this in production, the Access policy is missing or " +
          "the Worker is receiving traffic before Access. Configure the " +
          "Subscriber Content app per cloudflare/access/subscriber_content_app.md.\n",
        {
          status: 403,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }
      );
    }

    return new Response(
      `Entitlement Worker stub — Phase B logic pending Sales P1 schema.\n\n` +
        `Authenticated as: ${email}\n` +
        `Requested path:   ${url.pathname}\n\n` +
        `Phase A is intentionally deny-by-default. No subscriber content is served ` +
        `until Sales ships sales/subscriptions/ and Phase B entitlement logic is wired.\n`,
      {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }
    );
  },
};
