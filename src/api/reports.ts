import type { Request, Response } from "express";
import type QuickBooks from "node-quickbooks";
import { log } from "../log.js";
import {
  ConnectionNotFoundError,
  ReauthRequiredError,
} from "../qbo/client-manager.js";
import { TimeoutError, qboErrorMessage, shapeReport } from "../tools/_format.js";
import { runQboRaw } from "../tools/_shared.js";
import { selectConnections } from "./connections-logic.js";
import type { ConnectionsSource } from "./connections.js";
import {
  DEFAULT_MAX_ROWS,
  isReportSlug,
  parseReportQuery,
  type ReportSlug,
} from "./reports-logic.js";

type QboCb = (err: unknown, data: unknown) => void;
type ReportCaller = (qb: QuickBooks, params: object, cb: QboCb) => void;

/**
 * Each slug's call into the Reports API, and whether it needs a row cap.
 *
 * The general ledger is the only detail report here, and an unfiltered pull of
 * it can be enormous, so it carries the default cap while the summaries do not.
 */
const CALLERS: Record<
  ReportSlug,
  { call: ReportCaller; defaultMaxRows?: number }
> = {
  "profit-and-loss": { call: (qb, p, cb) => qb.reportProfitAndLoss(p, cb) },
  "balance-sheet": { call: (qb, p, cb) => qb.reportBalanceSheet(p, cb) },
  "trial-balance": { call: (qb, p, cb) => qb.reportTrialBalance(p, cb) },
  "general-ledger": {
    call: (qb, p, cb) => qb.reportGeneralLedgerDetail(p, cb),
    defaultMaxRows: DEFAULT_MAX_ROWS,
  },
};

function promisify(
  run: (cb: QboCb) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    run((err, data) => (err ? reject(err) : resolve(data)));
  });
}

/**
 * One report for one company, for a scheduled job.
 *
 * Failures are mapped onto status codes a pipeline can act on rather than
 * retry blindly: 404 means nobody has ever connected that company, 409 means
 * its credential lapsed and a human must reconnect once, and 502 means
 * QuickBooks itself failed after this server had already retried.
 */
export function reportsHandler(source: ConnectionsSource) {
  return async (req: Request, res: Response): Promise<void> => {
    // Express types a route parameter as possibly repeated; this one never is.
    const raw = req.params.report;
    const slug = Array.isArray(raw) ? raw[0] : raw;
    if (!slug || !isReportSlug(slug)) {
      res.status(400).json({ error: "unknown_report", report: slug ?? null });
      return;
    }

    const parsed = parseReportQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) {
      res.status(400).json({ error: "invalid_request", detail: parsed.error });
      return;
    }
    const { realm, qboParams, format, maxRows } = parsed.request;

    // Resolve the realm to a connection by the same rule the connections
    // endpoint reports, so what a caller is told it can pull and what it
    // actually pulls can never disagree.
    const entry = selectConnections(source.listSummaries()).find(
      (candidate) => candidate.realmId === realm,
    );
    if (!entry) {
      res.status(404).json({ error: "not_connected", realm });
      return;
    }

    const { call, defaultMaxRows } = CALLERS[slug];
    try {
      const report = await runQboRaw(
        entry.connectionId,
        (qb) => promisify((cb) => call(qb, qboParams, cb)),
        `api:${slug}`,
      );
      res.json(
        shapeReport(report, { format, maxRows: maxRows ?? defaultMaxRows }),
      );
    } catch (err) {
      // A connection row that vanished between the lookup and the call is the
      // same situation as never having been connected, from the caller's side.
      if (err instanceof ConnectionNotFoundError) {
        res.status(404).json({ error: "not_connected", realm });
        return;
      }
      if (err instanceof ReauthRequiredError) {
        res.status(409).json({ error: "reauth_required", realm });
        return;
      }
      log.warn(
        { realm, report: slug, err: qboErrorMessage(err) },
        "api_report_failed",
      );
      res.status(502).json({
        error: "upstream_failed",
        realm,
        detail:
          err instanceof TimeoutError
            ? "QuickBooks did not answer in time. Narrow the date range and try again."
            : qboErrorMessage(err),
      });
    }
  };
}
