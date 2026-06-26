import { env } from "../config/env.js";

export interface ConnectPageParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  mcpState?: string;
  /** Pre-filled email + an error message, when re-rendering after a bad submit. */
  email?: string;
  error?: string;
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The acknowledgment line — links to terms/privacy if configured, else generic. */
function acknowledgment(): string {
  const links: string[] = [];
  if (env.TERMS_URL)
    links.push(`<a href="${escape(env.TERMS_URL)}" target="_blank">Terms</a>`);
  if (env.PRIVACY_URL)
    links.push(
      `<a href="${escape(env.PRIVACY_URL)}" target="_blank">Privacy Policy</a>`,
    );
  const suffix = links.length ? ` and agree to the ${links.join(" and ")}` : "";
  return `I understand this tool will access my QuickBooks data${suffix}.`;
}

/**
 * Interstitial shown before the QuickBooks consent screen. Collects a
 * self-reported email and an acknowledgment, then POSTs to /connect/start,
 * which forwards the user to Intuit. The MCP OAuth params ride along as hidden
 * fields and are re-validated server-side on submit.
 */
export function renderConnectPage(params: ConnectPageParams): string {
  const errorHtml = params.error
    ? `<p style="color:#d32f2f;margin:0 0 16px">${escape(params.error)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect airCFO QuickBooks</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f5f6f8;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">
  <main style="background:#fff;max-width:420px;width:90%;padding:32px;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.1)">
    <h1 style="font-size:20px;margin:0 0 8px">Connect airCFO QuickBooks</h1>
    <p style="color:#555;font-size:14px;margin:0 0 24px">
      Enter your email, then you'll be sent to QuickBooks to authorize access to your company's data.
    </p>
    ${errorHtml}
    <form method="POST" action="/connect/start">
      <input type="hidden" name="client_id" value="${escape(params.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escape(params.redirectUri)}" />
      <input type="hidden" name="code_challenge" value="${escape(params.codeChallenge)}" />
      <input type="hidden" name="state" value="${escape(params.mcpState ?? "")}" />
      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Email</label>
      <input type="email" name="email" required value="${escape(params.email ?? "")}"
        placeholder="you@example.com"
        style="width:100%;box-sizing:border-box;padding:10px;font-size:14px;border:1px solid #ccc;border-radius:8px;margin-bottom:16px" />
      <label style="display:flex;gap:8px;font-size:13px;color:#555;margin-bottom:20px;align-items:flex-start">
        <input type="checkbox" name="ack" value="yes" required style="margin-top:2px" />
        <span>${acknowledgment()}</span>
      </label>
      <button type="submit"
        style="width:100%;padding:12px;font-size:15px;font-weight:600;color:#fff;background:#2ca01c;border:none;border-radius:8px;cursor:pointer">
        Continue to QuickBooks
      </button>
    </form>
  </main>
</body>
</html>`;
}
