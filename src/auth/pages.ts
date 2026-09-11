/**
 * The handful of HTML pages the connect flow renders. Kept together so the
 * flow modules stay about flow, and so every page looks like the same tool.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CARD =
  "background:#fff;max-width:460px;width:90%;padding:32px;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.1)";
const BODY =
  "font-family:system-ui,-apple-system,sans-serif;background:#f5f6f8;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center";
const PRIMARY_BUTTON =
  "display:block;width:100%;box-sizing:border-box;padding:12px;font-size:15px;font-weight:600;color:#fff;background:#2ca01c;border:none;border-radius:8px;cursor:pointer;text-align:center;text-decoration:none";
const SECONDARY_BUTTON =
  "display:block;width:100%;box-sizing:border-box;padding:12px;font-size:14px;font-weight:500;color:#444;background:#fff;border:1px solid #ccc;border-radius:8px;cursor:pointer;margin-top:10px";

function shell(title: string, head: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${head}
</head>
<body style="${BODY}">
  <main style="${CARD}">${body}</main>
</body>
</html>`;
}

/** Something went wrong and the flow cannot continue. */
export function errorPage(message: string): string {
  return shell(
    "Couldn't connect QuickBooks",
    "",
    `<h1 style="font-size:20px;margin:0 0 8px;color:#d32f2f">Couldn't connect QuickBooks</h1>
     <p style="color:#555;font-size:14px;margin:0">${escapeHtml(message)}</p>`,
  );
}

/**
 * A Google account this server does not admit. Says which address was refused,
 * because the usual cause is signing in with a personal account by mistake.
 */
export function deniedPage(email: string, domain: string): string {
  return shell(
    "Not authorized",
    "",
    `<h1 style="font-size:20px;margin:0 0 8px">Not authorized</h1>
     <p style="color:#555;font-size:14px;margin:0 0 16px">
       This connector is for airCFO staff. You signed in as
       <strong>${escapeHtml(email)}</strong>, which isn't an approved
       <strong>@${escapeHtml(domain)}</strong> account.
     </p>
     <p style="color:#555;font-size:14px;margin:0">
       If you have an airCFO account, close this tab and start again, choosing
       it at the Google prompt. Otherwise ask Alex for access.
     </p>`,
  );
}

export interface ConfirmPageParams {
  token: string;
  companyName: string | null;
  realmId: string;
  environment: string;
  email: string;
}

/**
 * Shown after Intuit consent and before the MCP client gets its authorization
 * code, so the person can see *which company* they just connected.
 *
 * The Intuit company picker decides the realm and the server has no say in it,
 * so without this page connecting the wrong company is silent — you find out
 * later, from numbers that look plausible and belong to someone else.
 */
export function confirmPage(params: ConfirmPageParams): string {
  const company = params.companyName ?? "(name unavailable)";
  const sandboxNote =
    params.environment === "sandbox"
      ? `<p style="font-size:13px;color:#b26a00;background:#fff6e5;border-radius:8px;padding:10px;margin:0 0 16px">
           This is a <strong>sandbox</strong> company, not real books.
         </p>`
      : "";
  return shell(
    "Confirm the company",
    "",
    `<h1 style="font-size:20px;margin:0 0 8px">Confirm the company</h1>
     <p style="color:#555;font-size:14px;margin:0 0 16px">
       You're connecting as <strong>${escapeHtml(params.email)}</strong>.
     </p>
     ${sandboxNote}
     <dl style="margin:0 0 20px;padding:14px 16px;background:#f5f7fb;border-radius:8px;font-size:14px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px">
       <dt style="color:#666">Company</dt><dd style="margin:0;font-weight:600">${escapeHtml(company)}</dd>
       <dt style="color:#666">Realm</dt><dd style="margin:0;font-family:ui-monospace,Menlo,monospace">${escapeHtml(params.realmId)}</dd>
     </dl>
     <form method="POST" action="/connect/confirm">
       <input type="hidden" name="token" value="${escapeHtml(params.token)}" />
       <button type="submit" style="${PRIMARY_BUTTON}">Yes, connect this company</button>
     </form>
     <form method="POST" action="/connect/cancel">
       <input type="hidden" name="token" value="${escapeHtml(params.token)}" />
       <button type="submit" style="${SECONDARY_BUTTON}">Wrong company — cancel</button>
     </form>`,
  );
}

/**
 * The connection succeeded; hand the authorization code back to the MCP
 * client. A top-level meta-refresh rather than a 302, because the destination
 * is the client's own loopback listener and it may not be up at this instant —
 * a blind redirect then dead-ends the browser on a raw connection error even
 * though the connection itself worked.
 */
export function successPage(redirectUrl: string): string {
  const safeUrl = escapeHtml(redirectUrl);
  return shell(
    "QuickBooks connected",
    `<meta http-equiv="refresh" content="2;url=${safeUrl}" />`,
    `<div style="text-align:center">
       <div style="font-size:40px;line-height:1">✅</div>
       <h1 style="font-size:20px;margin:12px 0 8px">QuickBooks connected</h1>
       <p style="color:#555;font-size:14px;margin:0 0 24px">Returning you to Claude…</p>
       <a href="${safeUrl}" style="${PRIMARY_BUTTON}">Return to Claude</a>
       <p style="color:#888;font-size:12px;margin:20px 0 0">
         If this page shows a connection error, your QuickBooks connection still
         succeeded — go back to Claude and try your request again.
       </p>
     </div>`,
  );
}

/** The person said "wrong company"; nothing was left connected. */
export function cancelledPage(): string {
  return shell(
    "Nothing was connected",
    "",
    `<h1 style="font-size:20px;margin:0 0 8px">Nothing was connected</h1>
     <p style="color:#555;font-size:14px;margin:0">
       The connection was cancelled and its QuickBooks access has been revoked.
       Close this tab and start again when you're ready, picking the right
       company at Intuit's prompt.
     </p>`,
  );
}
