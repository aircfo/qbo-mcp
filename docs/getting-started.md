---
title: Getting Started
---

# Getting started

Connecting your QuickBooks to Claude takes about two minutes. You'll do it once,
and then you can just start asking questions. No software to install, no exports,
no spreadsheets.

> **Heads up:** this connector is in a **gated beta.** You'll need an access link
> from us before you can connect. **[Request beta access →](mailto:alex@aircfo.com)**

## Before you start

You'll need:

- **A QuickBooks Online account** that you have permission to access.
- **A Claude account with custom connectors enabled.** Custom connectors are
  currently available across Claude plans, but plan limits and workspace admin
  controls can apply. On Team or Enterprise, an owner may need to add the
  connector before members can connect it.
- **The connector link** we send you when you're approved for the beta.

## Step 1 — Add the connector in Claude

1. In Claude, open **Customize → Connectors**. On Team or Enterprise, an owner
   may need to start from **Organization settings → Connectors** first.
2. Choose **Add custom connector**.
3. Paste in the connector URL from your beta invite. It will end in `/mcp`.
4. Save. Claude will now offer to connect it.

## Step 2 — Connect your QuickBooks

1. When you start the connection, Claude opens a short page that asks for **your
   email** and a checkbox confirming you understand the tool will read your
   QuickBooks data. Enter your email and check the box, then click **Continue to
   QuickBooks**.
2. You'll land on **Intuit's own QuickBooks sign-in and consent screen** — the
   same one every approved QuickBooks app uses. Sign in if needed. The app
   requesting access will show as **airCFO QBO Gateway**.
3. **Choose the company** you want to connect (if you have more than one) and
   click **Connect** / **Authorize**.
4. QuickBooks sends you back to Claude, and you're connected.

You never type your QuickBooks password into us — you authorize through Intuit
directly, and they hand back a revocable key. See
**[Trust & security →](./trust-and-security.md)** for exactly what that means.

## Step 3 — Ask your first question

Try one of these to confirm it's working:

- *"What company am I connected to?"*
- *"Show me this month's profit and loss."*
- *"What's our current cash position?"*

From there, ask most read-only finance questions — see the full
**[What you can ask →](./what-you-can-ask.md)** gallery for ideas.

## Disconnecting

Whenever you want to end access, just tell Claude:

> *"Disconnect my QuickBooks."*

That immediately deletes the stored connection on our side and attempts to revoke
the Intuit token. You can also revoke the app directly from your Intuit account.
To use it again later, you simply reconnect with Step 2.

## Troubleshooting

**The connector won't add in Claude.**
Double-check the URL (it should end in `/mcp`) and that custom connectors are
enabled for your Claude account or workspace. If you're on Team or Enterprise,
ask an owner to confirm the connector has been added for the organization.

**I get sent to QuickBooks but never make it back.**
Make sure pop-ups/redirects aren't blocked, and that you fully clicked
**Connect/Authorize** on Intuit's screen. Try the connection once more.

**Claude says it isn't connected when I ask a question.**
Re-run Step 2 to reconnect. Connections can be ended (by you, or after long
inactivity), and reconnecting takes just a few seconds.

**Something looks wrong with the data.**
Remember the connector only *reads* — it can't change your books, so nothing it
does will affect what's in QuickBooks. If a number looks off, ask Claude to show
the source report or underlying transactions, and confirm the date range,
cash/accrual basis, and whether the books for that period are final.

## Questions?

For how your data is handled, read **[Trust & security →](./trust-and-security.md)**.
For anything else, contact us at the address on your access invite.
