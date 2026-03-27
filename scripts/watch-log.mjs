const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

const WATCH_PREFIX = '@open-mercato/watch:dev:'

function shouldColor(stream) {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR === '0') return false
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true
  return Boolean(stream?.isTTY)
}

function colorize(stream, text, color) {
  if (!shouldColor(stream)) return text
  return `${color}${text}${ANSI.reset}`
}

function formatLine(stream, scope, message) {
  const prefix = colorize(stream, WATCH_PREFIX, ANSI.magenta)
  if (!scope) return `${prefix} ${message}`
  const renderedScope = colorize(stream, `[${scope}]`, ANSI.dim)
  return `${prefix} ${renderedScope} ${message}`
}

function write(method, stream, scope, message, args) {
  method(formatLine(stream, scope, message), ...args)
}

export function watchLog(scope, message, ...args) {
  write(console.log, process.stdout, scope, message, args)
}

export function watchWarn(scope, message, ...args) {
  write(console.warn, process.stderr, scope, message, args)
}

export function watchError(scope, message, ...args) {
  write(console.error, process.stderr, scope, message, args)
}
