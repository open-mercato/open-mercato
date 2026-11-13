import { AsyncLocalStorage } from 'node:async_hooks'

/** Return false to retain the normal terminal presentation for this warning. */
type KmsWarningWriter = (lines: readonly string[]) => void | boolean
const warningWriters = new AsyncLocalStorage<KmsWarningWriter>()

export function runWithKmsWarningWriter<T>(writer: KmsWarningWriter, operation: () => T): T {
  return warningWriters.run(writer, operation)
}

/** Presentation only: the caller retains its separate canonical security log. */
export function writeKmsWarning(lines: readonly string[]): void {
  const writer = warningWriters.getStore()
  if (writer) {
    try { if (writer(lines) !== false) return } catch { /* Preserve the warning if its scoped presentation fails. */ }
  }
  const rich = process.stderr.isTTY === true && !Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR') && process.env.TERM !== 'dumb'
  if (!rich) { process.stderr.write(lines.join('\n') + '\n'); return }
  const width = 110, start = '\x1b[41m\x1b[97m', reset = '\x1b[0m'
  const border = `${start}${'━'.repeat(width)}${reset}`
  process.stderr.write([border, ...lines.map(line => `${start} ${line.padEnd(width - 2, ' ')} ${reset}`), border].join('\n') + '\n')
}
