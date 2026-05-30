# subscriber-content Worker

Entitlement Worker for `elevationary.com` gated subscriber routes (`/editions/*`, `/account/*`).

**Status:** Phase A scaffold — deny-by-default. Not yet deployed.

## What this is

The downstream half of the Cloudflare Access gate. Cloudflare Access at the edge enforces **identity** (Google SSO or Email OTP). This Worker enforces **entitlement** — whether the authenticated subscriber actually has access to the requested content based on their Stripe subscription status and the Sales-canonical R2 CRM.

## Why it returns 403 in Phase A

Phase A ships the scaffold before Sales P1 (the Subscription schema) lands. To prevent any content leak before entitlement logic is wired, the Worker default-denies every request with HTTP 403. If `cf-access-authenticated-user-email` is present, the body echoes the email so James can verify Access is enforcing in front; otherwise it warns that Access is missing.

## Phase B (waits on Sales P1)

When `~/Antigravity/Elevationary_Sales/schemas/subscription.schema.json` ships and Sales begins writing `sales/subscriptions/<sb_id>.json` to R2, this Worker grows:

1. R2 bindings (`SALES_CRM`, `NEWSLETTER_CONTENT`) wired in `wrangler.toml`.
2. Subscription lookup: resolve `contact_id` from authenticated email, query `sales/subscriptions/` for `status=active` matching `(contact_id = ct.ct_id) OR (tier='enterprise' AND company_id = co.co_id)`.
3. Stripe live-state defense-in-depth: call `subscriptions.retrieve(sub_id)` on every gated request to catch the race where a cancellation hit Stripe but hasn't propagated to R2 yet (+50ms accepted; CEO-ratified 2026-05-30).
4. Stream + historical access check: `entitlements.streams_accessible` includes requested stream AND `entitlements.historical_access_from <= edition_date`.
5. Pass → render Markdown from `newsletter/drafts/<date>/` and serve.
6. Fail → 302 to `/upgrade?stream=<requested>&edition=<date>`.

## Deploy (when ready)

```
npm install
npx wrangler login          # James — interactive
npx wrangler deploy
```

Then uncomment the `[[routes]]` blocks in `wrangler.toml` and redeploy.

## References

- Plan: `~/.claude/plans/i-need-to-clarify-agile-snail.md` §4
- Access spec: `../cloudflare/access/subscriber_content_app.md`
- ORS log (Phase A): `~/Antigravity_Data/Website/docs/ORS_logs/ORS_subscriptions_phase_a_2026_05_30.md`
- P4D3: `Operations/Fleet_Governance/Subscription_Revenue_Pipeline` deliverable `P4_D1_Entitlement_Worker`
