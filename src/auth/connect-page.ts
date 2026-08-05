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
  const suffix = links.length
    ? `, and I agree to the ${links.join(" and ")}`
    : "";
  return `I understand this connector gives my own Claude account read-only access to my QuickBooks data — airCFO cannot view my books through this tool, cannot change anything in QuickBooks, and does not store my financial data${suffix}.`;
}

/** Plain-English assurances shown above the form, linked to the user guide. */
function assurances(): string {
  const docsUrl = escape(env.DOCS_URL);
  return `<ul style="list-style:none;padding:14px 16px;margin:0 0 20px;background:#f5faf5;border:1px solid #dcefdc;border-radius:8px;font-size:13px;color:#333;display:grid;gap:8px">
      <li>🔒&ensp;<strong>Read-only.</strong> It can never change, add, or delete anything in your books.</li>
      <li>🗄️&ensp;<strong>Never stored.</strong> Your financial data is fetched live for each answer — airCFO keeps no copy.</li>
      <li>👤&ensp;<strong>Only you.</strong> Your books are accessible only through your own Claude account — airCFO cannot view your data through this tool.</li>
      <li>🔑&ensp;<strong>What we do store:</strong> one encrypted QuickBooks connection key (never your password), so you don't have to re-authorize every time. It expires on its own after 100 days of inactivity, and you can disconnect at any moment by asking Claude.</li>
    </ul>
    <p style="font-size:12px;color:#888;margin:0 0 20px">Full details: <a href="${docsUrl}" target="_blank" style="color:#2ca01c">how it works</a> · <a href="${docsUrl}trust-and-security.html" target="_blank" style="color:#2ca01c">trust &amp; security</a></p>`;
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
  <title>Connect airCFO QBO Gateway</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f5f6f8;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">
  <main style="background:#fff;max-width:420px;width:90%;padding:32px;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.1)">
    <h1 style="font-size:20px;margin:0 0 8px">Connect airCFO QBO Gateway</h1>
    <p style="color:#555;font-size:14px;margin:0 0 16px">
      Enter your email, then you'll continue to Intuit's own QuickBooks sign-in to authorize the connection for your company. Whatever access Intuit's screen describes, this connector only ever reads.
    </p>
    ${assurances()}
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
