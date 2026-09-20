const LEVELS = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', success: '\x1b[32m' };
const RESET = '\x1b[0m';

function timestamp() {
  return new Date().toISOString();
}

function write(level, scope, message, meta) {
  const color = LEVELS[level] ?? '';
  const prefix = `${color}[${timestamp()}] [${level.toUpperCase()}] [${scope}]${RESET}`;
  if (meta !== undefined) {
    console.log(prefix, message, meta);
  } else {
    console.log(prefix, message);
  }
}

/**
 * Small structured logger. Never pass tokens/passwords/secrets to this —
 * callers are responsible for redacting sensitive values before logging.
 */
export function createLogger(scope) {
  return {
    info: (message, meta) => write('info', scope, message, meta),
    warn: (message, meta) => write('warn', scope, message, meta),
    error: (message, meta) => write('error', scope, message, meta),
    success: (message, meta) => write('success', scope, message, meta),
  };
}

export default createLogger;
