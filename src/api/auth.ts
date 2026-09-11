import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { log } from "../log.js";
import { RateLimiter } from "../rate-limit.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireServicePrincipal` once the shared secret matched. */
      principal?: ServicePrincipal;
    }
  }
}

export interface ServicePrincipal {
  id: string;
}

export interface ServiceAuthOptions {
  token: string;
  principalId: string;
  limiter?: RateLimiter;
}

/** Why a request was turned away. Logged; never returned to the caller. */
type RejectionReason = "missing" | "malformed" | "mismatch";

/**
 * A monthly pull of a dozen clients across four reports is roughly fifty
 * calls, so this leaves room for a backfill while still bounding a runaway
 * loop. The per-IP limiter in `index.ts` runs first and independently; this is
 * the tighter of the two and the one that will actually bite.
 */
const REQUESTS_PER_MINUTE = 300;
const WINDOW_MS = 60_000;
const SWEEP_MS = 5 * 60_000;

/**
 * Constant-time secret comparison that does not leak the secret's length.
 *
 * `timingSafeEqual` throws outright when its buffers differ in length, so the
 * obvious workaround is to compare lengths first and return early — which
 * leaks the length through timing. Hashing both sides to a fixed 32 bytes
 * removes the throw and the leak together.
 */
export function secretMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

/**
 * The path as the caller wrote it, minus any query string.
 *
 * `req.path` is relative to the router's mount point, and `req.baseUrl` is
 * restored before a finish handler runs, so neither is stable across a matched
 * route and a fall-through. `originalUrl` is never rewritten.
 */
function pathOf(req: Request): string {
  return req.originalUrl.split("?")[0] ?? req.originalUrl;
}

/** The token from an `Authorization: Bearer <token>` header, if well-formed. */
function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

function reject(
  req: Request,
  res: Response,
  reason: RejectionReason,
): void {
  // The reason and the caller's address, never the presented token — not its
  // value, not a prefix, not its length.
  log.warn(
    { reason, ip: req.ip, path: pathOf(req) },
    "service_auth_rejected",
  );
  res.setHeader("WWW-Authenticate", "Bearer");
  res.status(401).json({ error: "unauthorized" });
}

/**
 * Authenticates the one non-interactive caller, then rate-limits it by
 * principal.
 *
 * This door reaches every connected company, where an MCP session reaches only
 * the one company its connection holds. That is the point of it and also the
 * risk, which is why the routes behind it are read-only permanently and why
 * every request that gets through is logged.
 */
export function requireServicePrincipal(
  options: ServiceAuthOptions,
): RequestHandler {
  const { token, principalId } = options;
  const limiter = options.limiter ?? new RateLimiter(REQUESTS_PER_MINUTE, WINDOW_MS);
  setInterval(() => limiter.sweep(), SWEEP_MS).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header) return reject(req, res, "missing");

    const presented = bearerFrom(header);
    if (presented === null) return reject(req, res, "malformed");
    if (!secretMatches(presented, token)) return reject(req, res, "mismatch");

    const { allowed, retryAfterMs } = limiter.check(principalId);
    if (!allowed) {
      log.warn(
        { principal: principalId, path: pathOf(req) },
        "service_rate_limited",
      );
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    req.principal = { id: principalId };
    next();
  };
}

/** One log line per authenticated request, mirroring `mcp_request`. */
export function logApiRequest(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  const path = pathOf(req);
  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    log.info(
      {
        principal: req.principal?.id ?? null,
        method: req.method,
        path,
        status: res.statusCode,
        ms,
      },
      "api_request",
    );
  });
  next();
}
