import type { LogBindings, Logger } from './index'
import { isLevelEnabled, type LogLevel } from './level'

function formatBindingValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function formatBindings(bindings: LogBindings): string {
  return Object.entries(bindings)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatBindingValue(value)}`)
    .join(' ')
}

export function createConsoleLogger(namespace: string, bindings: LogBindings = {}): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogBindings): void => {
    if (!isLevelEnabled(level)) return
    const { err, ...rest } = { ...bindings, ...fields }
    const suffix = formatBindings(rest)
    const line = suffix ? `[${namespace}] ${msg} ${suffix}` : `[${namespace}] ${msg}`
    if (err instanceof Error) console[level](line, err.stack ?? err.message)
    else if (err !== undefined) console[level](line, err)
    else console[level](line)
  }
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (childBindings) => createConsoleLogger(namespace, { ...bindings, ...childBindings }),
  }
}
