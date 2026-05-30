# Cloudflare Access — Subscriber Content App

**Status:** Spec only. Not yet configured in Cloudflare dashboard.
**Owner:** Website (P4D3 `P3_D1_Access_App_and_IdP_Wiring`)
**Ratified by:** CEO 2026-05-30 in `~/.claude/plans/i-need-to-clarify-agile-snail.md` (§4 + §"Decisions locked" #4)

This is the spec James configures from in the Cloudflare Zero Trust dashboard. Treat every field below as locked.

---

## Application

| Field | Value |
|---|---|
| **Application name** | `Subscriber Content` |
| **Application type** | Self-hosted |
| **Session duration** | **30 days** (revisit if revocation-latency complaints surface) |
| **App launcher visible** | No |
| **Allow authentication via Access JWT** | Yes (Worker reads `Cf-Access-Jwt-Assertion` and `Cf-Access-Authenticated-User-Email`) |
| **Auto-redirect to identity** | Off (let users choose Google SSO or Email OTP) |

### Application domains (route patterns)

Both of these patterns must be added under this one Access app:

```
elevationary.com/editions/*
elevationary.com/account/*
```

**NOT gated** (must remain public): `elevationary.com/subscribe/`, `elevationary.com/`, `elevationary.com/about/`, `elevationary.com/services/`, `elevationary.com/contact/`, `elevationary.com/legal/`, `elevationary.com/newsletter-stories/*`, `elevationary.com/llms.txt`, `elevationary.com/sitemap.xml`, `elevationary.com/.well-known/*`.

---

## Identity Providers

Two IdPs must be enabled and both selectable at the Access login screen:

### 1. Google Workspace SSO

| Field | Value |
|---|---|
| **Type** | Google Workspace |
| **Provider name** | `Google` |
| **Apps Domain** | `elevationary.com` (and any additional Google Workspace domains in use) |
| **Open ID Connect Auth URL** | (auto-populated by Cloudflare) |

### 2. Email OTP (one-time PIN)

| Field | Value |
|---|---|
| **Type** | One-time PIN |
| **Provider name** | `Email OTP` |
| **PIN length** | 6 digits |

Email OTP is the **primary path** for individual subscribers without Google Workspace accounts. Google SSO is the path for staff and Workspace-account subscribers.

---

## Policies

One policy attached to this Access app. Logic:

```
Action: Allow
Include:
  - Emails ending in any domain (catch-all)  ← effectively "any authenticated identity"
Require: (none)
Exclude: (none)
```

Rationale: Cloudflare Access enforces **identity**, not **entitlement**. Entitlement is enforced by the Entitlement Worker (P4_D1) downstream — it reads `cf-access-authenticated-user-email` and queries the Sales R2 CRM. Splitting concerns this way matches the plan §4(b)–(d).

**Machine-readable equivalent** of this policy: see `subscriber_content_policy.json` in this directory.

---

## Service Token

A Cloudflare service token must be provisioned for Worker-to-Access programmatic verification of the Access JWT.

| Field | Value |
|---|---|
| **Service token name** | `subscriber-content-worker` |
| **Duration** | 1 year (rotate annually) |
| **Stored at** | `CF_ACCESS_SERVICE_TOKEN_ID` + `CF_ACCESS_SERVICE_TOKEN_SECRET` as Worker secrets via `wrangler secret put` |

After the Worker is deployed (Phase B), add both vars as rows in `~/Antigravity_Data/Administrator/docs/secret_consumer_registry.md` per the registry's "What NOT to store" rule (names + smoke tests only, never values).

---

## What this Phase A delivers vs Phase B

**Phase A (this session):**
- Spec written (this file + `subscriber_content_policy.json`).
- Worker scaffold deployed with default-deny (returns 403 to any request, with `cf-access-authenticated-user-email` echoed in the body for live-fire verification).
- Eleventy routes `/editions/` and `/account/` exist but are statically rendered as placeholders. Worker (when deployed) intercepts and returns 403.

**Phase B (waits on Sales P1 Subscription schema):**
- Worker reads `sales/subscriptions/<sb_id>.json` from R2.
- OR-join entitlement logic: `contact_id` match OR `tier=enterprise AND company_id` match.
- Stripe `subscriptions.retrieve` defense-in-depth call (+50ms).
- Render R2 content from `newsletter/drafts/<date>/*.md` on success.
- 302 redirect to `/upgrade?stream=<requested>&edition=<date>` on entitlement failure.

---

## Configuration checklist (for James)

When you sit down at the Cloudflare Zero Trust dashboard:

- [ ] Settings → Authentication → Login methods → add **Google Workspace** (per "Identity Providers" §1 above)
- [ ] Settings → Authentication → Login methods → add **One-time PIN** (per §2 above)
- [ ] Access → Applications → Add an application → Self-hosted → fill per "Application" table above
- [ ] Add both domain patterns under the app (`elevationary.com/editions/*`, `elevationary.com/account/*`)
- [ ] Enable both IdPs on this app
- [ ] Add the policy per "Policies" §above
- [ ] Access → Service Auth → create service token `subscriber-content-worker`
- [ ] Copy the service token ID + secret into a secure note for later `wrangler secret put` (Phase B)
- [ ] **Verify:** visit `https://elevationary.com/editions/` in a private window. Should see Access login screen with Google + Email OTP options.
- [ ] **Verify:** complete OTP login. Should land on Worker's deny-by-default 403 page with your email echoed.

---

## Rollback

To temporarily disable Access gating (e.g., during a Worker incident):

1. Dashboard → Access → Applications → `Subscriber Content` → toggle to disabled, OR
2. Remove the two route patterns from the app (re-add to restore).

Pages and Eleventy routes remain accessible without Access in front (will hit the placeholder Eleventy templates only — no R2 content leaks because the Worker is what reads R2, and the Worker won't be invoked if Access is disabled and traffic falls through to Pages).

---

## References

- Ratified plan: `~/.claude/plans/i-need-to-clarify-agile-snail.md`
- P4D3 project: `Operations/Fleet_Governance/Subscription_Revenue_Pipeline` phase `P3_Cloudflare_Access_Setup`
- ORS log: `~/Antigravity_Data/Website/docs/ORS_logs/ORS_subscriptions_phase_a_2026_05_30.md`
