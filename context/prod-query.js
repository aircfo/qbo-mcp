const D = require('/app/node_modules/better-sqlite3');
const db = new D('/data/qbo-mcp.db', { readonly: true });
const q = (sql) => db.prepare(sql).all();
const conns = q("SELECT id, realm_id, company_name, email, datetime(created_at/1000,'unixepoch') AS connected, datetime(updated_at/1000,'unixepoch') AS last_token_refresh, datetime(refresh_updated_at/1000,'unixepoch') AS refresh_rotated FROM connections ORDER BY created_at");
console.log('CONNECTIONS ' + conns.length); console.table(conns);
console.log('TOKENS BY KIND'); console.table(q("SELECT kind, COUNT(*) n, SUM(revoked_at IS NOT NULL) revoked, MIN(datetime(created_at/1000,'unixepoch')) earliest, MAX(datetime(created_at/1000,'unixepoch')) latest FROM oauth_tokens GROUP BY kind"));
console.log('LIVE TOKENS PER CONNECTION'); console.table(q("SELECT connection_id, kind, COUNT(*) n, MAX(datetime(created_at/1000,'unixepoch')) latest FROM oauth_tokens WHERE revoked_at IS NULL AND expires_at > strftime('%s','now')*1000 GROUP BY connection_id, kind"));
console.log('CLIENTS'); console.table(q("SELECT substr(client_id,1,8) cid, json_extract(client_info,'$.client_name') name, json_extract(client_info,'$.redirect_uris') redirects, datetime(created_at/1000,'unixepoch') created FROM oauth_clients ORDER BY created_at"));
