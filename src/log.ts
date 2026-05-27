/**
 * Minimal structured logger. Emits one JSON line per event to stdout/stderr,
 * which Railway captures and indexes. No dependency; swap for pino later if the
 * volume warrants it.
 */
type Level = "info" | "warn" | "error";

function emit(
  level: Level,
  fields: Record<string, unknown>,
  msg: string,
): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  info: (fields: Record<string, unknown>, msg: string) =>
    emit("info", fields, msg),
  warn: (fields: Record<string, unknown>, msg: string) =>
    emit("warn", fields, msg),
  error: (fields: Record<string, unknown>, msg: string) =>
    emit("error", fields, msg),
};
