/**
 * Tiny structured-ish logger. Keeps dependencies out of a lean 2 GB-VPS image.
 *
 * PRIVACY: do not pass phone numbers to info/warn/error. Transcripts and other
 * potentially sensitive text should only go through logger.debug, which is
 * silent unless LOG_LEVEL=debug.
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
const threshold = ORDER[configured] ?? ORDER.info;

function emit(level: Level, msg: string, meta?: unknown): void {
  if (ORDER[level] < threshold) return;
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] ${msg}`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (meta === undefined) sink(line);
  else sink(line, meta);
}

export const logger = {
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
};
