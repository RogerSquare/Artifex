/**
 * Simple structured logger.
 * Outputs JSON lines with timestamp, level, message, and optional context.
 */

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? 2;

function formatLog(level, message, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  return JSON.stringify(entry);
}

function log(level, message, context) {
  if (LOG_LEVELS[level] > CURRENT_LEVEL) return;
  const line = formatLog(level, message, context);
  if (level === 'error') console.error(line);
  else console.log(line);
}

module.exports = {
  error: (msg, ctx) => log('error', msg, ctx),
  warn: (msg, ctx) => log('warn', msg, ctx),
  info: (msg, ctx) => log('info', msg, ctx),
  debug: (msg, ctx) => log('debug', msg, ctx),
};
