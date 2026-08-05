---
layout: default
title: Trust & security
nav_order: 4
---

# Trust & security

You're about to connect your company's books to an AI. You should expect a
straight answer about what that does and doesn't mean. Here it is, in plain
English. (If you want the engineering-level detail, it's in the
[technical security documentation](./security-details.md).)

---

## The three things that matter most

**1. It can only read. It can never change your books.**
This connector is read-only, end to end. There are no tools that create, edit, or
delete anything in QuickBooks — so no matter what you or Claude type, no invoice
gets sent, no entry gets posted, and nothing in your books changes.

**2. We don't store your financial data.**
Your P&L, ledger, transactions — none of it lives on our servers. Every time you
ask a question, the data is pulled live from QuickBooks and returned to Claude so
it can answer in your conversation. We do not persist a copy in our database. So
if our systems were ever compromised, there is no warehouse of everyone's
financials to steal — because it doesn't exist.

**3. You can disconnect anytime.**
Just ask Claude to disconnect QuickBooks. We immediately delete the stored
connection on our side and attempt to revoke the Intuit token. You can also
revoke the app directly from your Intuit account.

---

## What we *do* store, and how it's protected

To stay connected without making you re-authorize every time, we store the bare
minimum:

| What | Why we keep it | How it's protected |
|---|---|---|
| Your QuickBooks access keys (tokens) | So Claude can fetch data when you ask | **Encrypted at rest** (AES-256-GCM). The key that unlocks them is stored separately from the database, so a leak of the database alone reveals nothing. Intuit expires them automatically after **100 days of inactivity**. |
| Your QuickBooks company ID, and company name when available | To identify the connection | Not your financial data |
| The email you enter at connect | A basic accountability signal | Stored as-is; not verified |
| **Your actual financial data** | We don't keep it | Fetched live and returned to Claude for the answer; not persisted by us |

The "access keys" are like a valet key to your QuickBooks: they let us *read*
when you ask, they are encrypted so the database alone cannot reveal them, and
you can end the connection whenever you want.

## How your data stays yours (and only yours)

This is a shared service — lots of people connect their own companies. The thing
people rightly worry about is: *can someone else see my books?* No.

- **Each connection is sealed off.** When you ask a question, the system can only
  reach the one company tied to your login. There's no way to point it at someone
  else's data — not by accident, not on purpose.
- **Your session is bound to you.** A live conversation can only be driven by the
  connection that started it. Someone else can't slip into your session.
- **Claude-to-server credentials are unguessable.** The tokens Claude uses to talk
  to this connector are long random values, and we store only hashed fingerprints
  of them.
- **Intuit credentials are encrypted.** We do store Intuit's revocable access keys
  because the connector needs them to fetch QuickBooks data when you ask. Those
  keys are encrypted at rest, and the encryption key is kept outside the database.

## Encrypted in transit, too

Everything above is about data sitting *at rest*. *In transit*, **every
connection is encrypted with TLS/HTTPS** — from your Claude client to our server,
and from our server to QuickBooks. Your financial data is never sent over an
unencrypted connection at any point in the chain.

## Where it runs, and who touches your data

- **Hosting.** The service runs on **Railway**, in their **US East (Virginia)**
  region — a single instance with one persistent, encrypted volume.
- **The only third parties in the loop:**
  - **Railway** — hosts the server and the encrypted volume that holds your
    connection tokens.
  - **Intuit / QuickBooks Online** — the source of your financial data, which you
    authorize directly.
  - **Anthropic (Claude)** — receives the QuickBooks data needed to answer your
    question, inside your own Claude conversation.
- **Your data is never used to train any AI model — not by us.** Our server does
  not retain or repurpose your financial data for anything beyond answering the
  question in front of it. The data is sent to Claude (Anthropic) only to produce
  your answer; how Anthropic handles it is governed by the terms of your own
  Claude account and workspace settings.

## What we log (and what we don't)

To keep the service healthy and to investigate problems, we write a short
operational log line for each request and for connect/disconnect events. A line
records a timestamp, an internal connection ID, the name of the tool that ran,
the response status, how long it took, and — on connect/disconnect — the email
you entered.

**Logs never contain your financial data or your QuickBooks tokens.** They're
retained for up to **30 days**, then rotated out, and access is limited to
airCFO engineering staff with access to our hosting environment.

## What we ask you to keep in mind

We believe in being upfront about the edges, too:

- **The email at connect isn't verified.** It's a light accountability signal, not
  proof of identity. It doesn't gate access to anyone else's data — that's handled
  by the isolation above — but treat it as "self-reported."
- **Claude receives the data needed to answer.** We do not store your financial
  data, but the QuickBooks rows and reports requested for an answer are sent to
  Claude inside your conversation. Your use of Claude is governed by your Claude
  account, workspace settings, and Anthropic's applicable terms.
- **Answers depend on the state of your books.** If a period is still open,
  transactions are uncategorized, or cash/accrual basis matters, ask Claude to
  show the source report or transactions before relying on the answer.
- **We hold the keys to many companies' QuickBooks.** Because of that, the most
  important thing we protect is our own infrastructure. We encrypt tokens, keep
  the unlock key separate, log every access, and have an incident-response plan if
  anything ever looks wrong.
- **This is a beta.** We're rolling it out to a limited group on purpose, so we can
  keep it fast, reliable, and closely watched while it matures.

## How connecting actually works

You're never typing your QuickBooks password into us. Connecting goes through
**Intuit's own official sign-in** (the same OAuth flow QuickBooks uses for every
approved app):

1. You start the connection from Claude.
2. You enter your email and acknowledge that the tool will read your QuickBooks
   data.
3. **Intuit** shows you their consent screen and asks you to approve.
4. Intuit hands us a scoped, revocable key — never your password.

You stay in control the whole way, and you can end that access by disconnecting
or revoking the app in Intuit.

## Quick FAQ

**Can Claude change, delete, or send anything in my QuickBooks?**
No. It's read-only. There are no write actions, period.

**Do you keep a copy of my financials?**
No. Financial data is fetched live for each question and returned to Claude for
the answer, but it is not stored in our database.

**Where do you store my login?**
We never see your QuickBooks password. We store only Intuit's revocable access
keys, encrypted.

**Can another user see my company's data?**
No. Every connection is isolated to its own company, with no path to anyone
else's.

**Is my data used to train AI?**
Not by us — we never use it to train any model, and we don't keep it. To answer
your questions it's sent to Claude (Anthropic); Anthropic's use of it is governed
by your own Claude account's terms.

**Is my data encrypted on the way to and from QuickBooks?**
Yes. Every hop — Claude ↔ our server ↔ QuickBooks — uses TLS/HTTPS.

**Where is the service hosted?**
On Railway, in the US East (Virginia) region.

**How do I disconnect?**
Ask Claude to disconnect QuickBooks. The stored connection is deleted immediately,
and we attempt to revoke the Intuit token. You can also revoke the app directly
inside Intuit.

**Who do I contact about security?**
Email [alex@aircfo.com](mailto:alex@aircfo.com) with "Security" in the subject.

---

*This page is a plain-language summary for users. It is not legal advice. The
full technical posture, threat model, and accepted limitations live in the
[technical security documentation](./security-details.md).*
