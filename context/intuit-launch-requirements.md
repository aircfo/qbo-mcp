# Intuit Requirements & Constraints for a Public Launch

**Researched:** 2026-06-09 · **Context:** evaluating a public/webinar launch of qbo-mcp as a free hosted tool.

> Intuit's developer program and pricing changed materially in 2026 (the new
> "App Partner Program"). Pricing and thresholds below were accurate as of the
> research date — **re-verify with Intuit before launch**, and confirm the two
> open questions at the bottom directly with Intuit developer support.

## Bottom line

Intuit will **not block** a public, read-only tool where each user connects
their own QuickBooks company via OAuth — that's the sanctioned pattern, and we've
already cleared the gate that matters most (production keys require a self-attested
questionnaire, which we passed).

**The real constraint is pricing, not approval.** Under Intuit's 2026 program,
"read" calls are the metered/charged kind, our server is 100% reads, and the free
tier's quota is *shared across all users* and *blocks everyone* when exhausted.
"Free + hosted + popular" is therefore in direct tension with how Intuit now charges.

## Gate 1 — Permission to launch publicly (passable; mostly done)

- Every app touching **production data** must pass a **self-attested app
  assessment questionnaire** (legal / technical / security) and accept the
  updated Developer Terms of Service — whether or not it's listed on the App
  Store. We've already done this (our `qbo-prod` connection is live).
- That questionnaire does **not** require a third-party penetration test or
  SOC 2. It's attestation: secure credential storage, proper token refresh,
  error handling, no unauthorized data sharing — all of which our code and
  `SECURITY.md` already cover.
- A heavier **security review** (vulnerability scan + mandatory remediation of
  critical/high/medium findings) only applies if we **list on the QuickBooks
  App Store** — which we do **not** need to do. A public tool can run on
  production keys without being listed.

## Gate 2 — Scrutiny ramps at 500 connections

- Any app exceeding **500 active connections** is pulled into **annual (or more
  frequent) security reviews**, regardless of listing. (500+ is also the
  eligibility line for the "Gold" tier.)
- Translation: if the tool takes off, we graduate from "self-attested and left
  alone" to "Intuit reviews us periodically" — ongoing overhead with no revenue
  behind it.

## Gate 3 — The real wall: metered pricing on reads

Intuit's 2026 program splits API calls in two:

- **Core calls** (data *in* — create/update invoices, customers, etc.):
  **free, unmetered.**
- **CorePlus calls** (data *out* — reading accounts, querying, **fetching
  reports**): **metered and capped.**

**Our server is entirely CorePlus.** Every tool — P&L, balance sheet, general
ledger, trial balance, all searches — is a data-out call.

| Tier | Monthly fee | CorePlus credits/mo | Over the limit |
|---|---|---|---|
| **Builder** (free, default) | $0 | 500,000 | **Blocked** — calls fail until next month |
| Silver | $300 | 1,000,000 | $3.50 per 1,000 |
| Gold | $1,700 | 10,000,000 | lower rate |
| Platinum | $4,500 | 75,000,000 | $0.25 per 1,000 |

Two details make this sharp for a free public tool:

1. **The 500k quota is aggregated at the workspace level** — shared across *every*
   connected company, not allocated per user. All users draw down one common pool.
2. **On the free Builder tier, exceeding it blocks rather than throttles.** When
   the shared pool runs dry mid-month, the tool stops working **for everyone**
   until the monthly reset.

**Rough math:** Claude fans out many tool calls per question (multiple reports,
ledger drill-downs, cross-checks) — call it ~20–100 CorePlus calls per real
analysis session. 500,000 ÷ ~50 ≈ **~10,000 sessions/month across all users,
total**, before everything goes dark. A few hundred genuinely active founders —
especially anyone running a monthly-close deep dive, which hammers the ledger —
hits the cap. Then the only options are: let it break for everyone, or move to
**Silver ($300/mo)** and up. The cost of a "free" tool scales *up* with its
success, and the failure mode (silent mid-month blackout) is exactly what erodes
trust in a tool from a *finance* firm.

> Note: a *write*-heavy tool would be mostly free under this model. A read-only
> reporting tool is the single worst shape for the free tier.

## Implications for the webinar launch

- **Don't launch ungated-public on the free tier.** A webinar can drive a spike
  of connections in a short window — the exact thing that blows the shared 500k
  pool and causes a mid-event blackout for everyone.
- **A gated rollout solves two problems at once:** it keeps us under the
  500-connection review threshold *and* keeps aggregate CorePlus usage under the
  free 500k so the tool stays free and reliable. (This is the same gated-beta
  conclusion reached on the broader go/no-go analysis — pricing is now a second,
  independent reason for it.)
- **If we want it truly public and reliable, budget $300/mo minimum (Silver),
  climbing with adoption** — and decide whether lead-gen from early-stage founders
  justifies a standing, growing bill with no revenue attached.
- **Per-connection rate limiting (already built, 120/min) is necessary but not
  sufficient** — it bounds any single user, but the binding constraint is the
  *aggregate* monthly pool across all users.

## Open questions to confirm with Intuit before launch

1. **Exact credits-per-call.** This doc assumes ~1 credit per report/read call;
   reports may cost more, which only tightens the cap. Confirm the rate card.
2. **Current tier enrollment.** Confirm our existing production app is enrolled
   in the Builder tier under the new program, and what (if anything) is required
   to move to Silver if/when we need to.

## Sources

- [Intuit App Partner Program — platform service fees](https://help.developer.intuit.com/s/article/platform-service-fees)
- [API classification (Core vs CorePlus)](https://help.developer.intuit.com/s/article/API-classification-for-the-Intuit-App-Partner-Program)
- [Understanding Builder Tier API limits (Intuit, Jan 2026)](https://blogs.intuit.com/2026/01/08/understanding-builder-tier-api-limits-for-you-and-your-customers/)
- [Introducing the Intuit App Partner Program (Intuit)](https://blogs.intuit.com/2025/05/15/introducing-the-intuit-app-partner-program/)
- [QuickBooks API cost & rate limits, 2026 (Truto)](https://truto.one/blog/how-much-does-the-quickbooks-api-cost-2026-pricing-rate-limits/)
- [QBO app assessment questionnaire (Codat)](https://docs.codat.io/integrations/accounting/quickbooksonline/qbo-app-assessment-questionnaire)
- [Security requirements for apps (Intuit Developer)](https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/security-requirements)
- [App assessment process FAQ (Intuit)](https://help.developer.intuit.com/s/article/New-app-assessment-process-FAQ)
