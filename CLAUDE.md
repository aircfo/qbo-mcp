# qbo-mcp — rules for Claude sessions in this repo

## What this is

A multi-user remote MCP server that holds airCFO's QuickBooks Online connections and
exposes each company's books as tools. Teammates sign in with their `@aircfo.com` Google
account; each connection is bound to one QuickBooks company. It runs on Railway with an
encrypted SQLite database on a volume.

**The people working here are often not career engineers.** Explain what you are doing in
plain language, and when a change is risky, say why before making it.

## Hard rules

1. **Never print, log, or write a token anywhere.** Not to stdout, not into an error
   message, not into a test fixture, not into a document. Logs carry ids and email
   addresses, never credentials.
2. **The data tools are read-only.** Anything that writes to a client's books needs an
   explicit dry-run, a human approval bound to that exact batch, and an audit row. Never
   add a write path "temporarily".
3. **Never touch a payment rail.** No wires, transfers, or bill payments, whatever the
   API technically allows and whoever asks.
4. **Merging to `main` deploys to production immediately.** There is no staging
   environment. A pull request is the last point at which anything is reversible cheaply.
5. **Don't change the deployment URL.** Every teammate's saved authorization and every
   client folder is keyed to it; changing it forces everyone to reconnect everything.
6. **`TOKEN_ENCRYPTION_KEY` is permanent.** Rotating it makes every stored connection
   undecryptable and forces every client to be reconnected.

## Toolchain

```sh
mise x node@22 -- pnpm install
mise x node@22 -- pnpm typecheck
mise x node@22 -- pnpm test
mise x node@22 -- pnpm dev      # local, against an Intuit sandbox company
```

**Always run through `mise x node@22`.** The machine's default Node is newer than the
native SQLite binding supports, and the failure is a confusing ABI error rather than a
clear one. If it appears anyway, run
`mise x node@22 -- pnpm rebuild better-sqlite3` once.

## Where things live

| Path | What |
|---|---|
| `src/index.ts` | Express wiring, routes, rate limits, the process-level guards |
| `src/transport.ts` | MCP sessions over HTTP. Session lookup, eviction, per-request logging |
| `src/server.ts` | Builds one MCP server per connection and registers its tools |
| `src/auth/` | The connect flow: Google identity, Intuit callback, the confirmation step, the OAuth store |
| `src/qbo/` | The Intuit client and per-connection token refresh |
| `src/store/` | SQLite, the encrypted connection store, the cipher |
| `src/tools/` | The tools themselves. `_format.ts`, `_search.ts`, `_shared.ts` are shared pure helpers |
| `context/decisions.md` | Why things are the way they are. Append-only |
| `context/product/` | Design options not yet decided |

## Conventions

- **TypeScript strict. No `any`.** Narrow from `unknown` instead. `asRecord` in
  `src/tools/_format.ts` is the sanctioned way to narrow untyped third-party JSON.
- **Comments explain *why*, never what.** If a line needs a comment to say what it does,
  rewrite the line.
- **Tests go in a `__tests__/` folder beside the code.** Vitest. Test behaviour, not
  implementation, and name tests like sentences.
- **Pure logic separate from I/O.** A module that reaches for the database or the network
  is hard to test, so the decision-making part usually lives in its own file with its
  dependencies passed in. `connection-reconcile.ts` and `access.ts` are the pattern.
- **Guarantees belong at the chokepoint**, not in each caller remembering. Search limits
  live in `buildCriteria`; the report date guard lives in `runReport`.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`), feature branches, pull
  requests into `main`.

## Things that have bitten us

Read `context/decisions.md` for the full record. The ones most likely to bite again:

- **QuickBooks folds some amounts into subtotal rows only.** `shapeReport` returns
  `{ columns, rows, totals }` and `totals` carries amounts posted directly to a parent
  account. Summing `rows` alone under-reports and looks plausible.
- **A report given only one of `start_date` / `end_date`** is silently answered for the
  current period by QuickBooks. Both or neither.
- **`intuit-oauth`'s `revoke()` ignores a `{ token }` argument** and falls back to
  revoking whatever token the client instance is holding. Always pass
  `{ refresh_token }`.
- **An MCP session the server no longer holds must be answered 404**, not 400. Clients
  re-initialise on 404 and retry a 400 forever.

## Before you finish

Run `pnpm typecheck && pnpm test`. Update `context/decisions.md` when you make an
architectural call. Update `README.md` when you add or remove a tool.
