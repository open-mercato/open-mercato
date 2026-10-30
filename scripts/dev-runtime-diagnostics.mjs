import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  MAX_BROWSER_REPORT_BYTES,
  MAX_STACK_LENGTH,
  redactSensitiveText,
  RUNTIME_RECOVERY_ACTIONS,
} from './dev-runtime-state.mjs'

export const BROWSER_REPORT_KINDS = [
  'global-error',
  'window-error',
  'unhandled-rejection',
  'chunk-load-error',
  'request-error',
]

export const MAX_DIAGNOSTIC_SINK_BYTES = 512 * 1024

export function createDevRuntimeToken() {
  return crypto.randomBytes(24).toString('base64url')
}

// Constant-time comparison so a local attacker cannot probe the token byte by
// byte through response timing.
export function isMatchingDevRuntimeToken(expected, provided) {
  if (typeof expected !== 'string' || expected.length === 0) return false
  if (typeof provided !== 'string' || provided.length === 0) return false
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  if (expectedBuffer.length !== providedBuffer.length) return false
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer)
}

function invalid(message) {
  return { ok: false, status: 400, error: { code: 'invalid_report', message } }
}

// Validates an untrusted browser report. A report may inform runtime state but
// can never select an action, a command, or a configuration value.
export function validateBrowserReport(input, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : MAX_BROWSER_REPORT_BYTES

  let payload = input
  if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > maxBytes) {
      return { ok: false, status: 400, error: { code: 'report_too_large', message: 'Diagnostic report exceeds the size limit.' } }
    }
    try {
      payload = JSON.parse(input)
    } catch {
      return invalid('Diagnostic report is not valid JSON.')
    }
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('Diagnostic report must be an object.')
  }
  if (!BROWSER_REPORT_KINDS.includes(payload.kind)) {
    return invalid('Diagnostic report kind is not supported.')
  }
  if (typeof payload.message !== 'string' || payload.message.trim().length === 0) {
    return invalid('Diagnostic report requires a message.')
  }

  const message = redactSensitiveText(payload.message, 500)
  if (!message) return invalid('Diagnostic report message is empty after redaction.')

  const report = { kind: payload.kind, message }

  if (payload.digest != null) {
    if (typeof payload.digest !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.digest)) {
      return invalid('Diagnostic report digest is malformed.')
    }
    report.digest = payload.digest
  }

  if (payload.path != null) {
    if (typeof payload.path !== 'string' || payload.path.length > 300) {
      return invalid('Diagnostic report path is malformed.')
    }
    const sanitized = redactSensitiveText(payload.path, 300)
    if (sanitized) report.path = sanitized.startsWith('/') ? sanitized : `/${sanitized}`
  }

  if (payload.stack != null) {
    if (typeof payload.stack !== 'string') {
      return invalid('Diagnostic report stack is malformed.')
    }
    const sanitized = redactSensitiveText(payload.stack, MAX_STACK_LENGTH)
    if (sanitized) report.stack = sanitized
  }

  if (payload.timestamp != null) {
    if (typeof payload.timestamp !== 'string' || Number.isNaN(Date.parse(payload.timestamp))) {
      return invalid('Diagnostic report timestamp is malformed.')
    }
    report.timestamp = new Date(payload.timestamp).toISOString()
  }

  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > maxBytes) {
    return { ok: false, status: 400, error: { code: 'report_too_large', message: 'Diagnostic report exceeds the size limit.' } }
  }

  return { ok: true, report }
}

export function browserReportToSignal(report, generation) {
  return {
    source: 'browser',
    severity: 'error',
    generation,
    message: report.message,
    digest: report.digest,
    path: report.path,
    blocking: false,
  }
}

// Fixed-window limiter. Bounded, per-process and dev-only: it exists so a
// looping browser cannot flood the sink, not as a security control.
export function createRateLimiter(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 30
  const windowMs = Number.isInteger(options.windowMs) && options.windowMs > 0 ? options.windowMs : 10_000
  const now = typeof options.now === 'function' ? options.now : () => Date.now()

  let windowStart = now()
  let count = 0

  return {
    tryConsume() {
      const timestamp = now()
      if (timestamp - windowStart >= windowMs) {
        windowStart = timestamp
        count = 0
      }
      if (count >= limit) return false
      count += 1
      return true
    },
  }
}

export const MAX_ACTION_REQUEST_BYTES = 16 * 1024

// Validates an action request coming from the dev-only app route. The action is
// matched against the fixed allowlist here as well as at the runner, so a
// malformed sink line can never widen what the supervisor will execute.
export function validateActionRequest(input, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : MAX_ACTION_REQUEST_BYTES
  const serialized = typeof input === 'string' ? input : JSON.stringify(input)
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    return { ok: false, status: 400, error: { code: 'action_too_large', message: 'Action request exceeds the size limit.' } }
  }

  let payload = input
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(input)
    } catch {
      return { ok: false, status: 400, error: { code: 'invalid_action', message: 'Action request is not valid JSON.' } }
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, error: { code: 'invalid_action', message: 'Action request must be an object.' } }
  }
  if (!RUNTIME_RECOVERY_ACTIONS.includes(payload.action)) {
    return { ok: false, status: 400, error: { code: 'unknown_action', message: 'Unknown recovery action.' } }
  }
  const request = { action: payload.action }
  if (Number.isInteger(payload.generation)) request.generation = payload.generation
  if (typeof payload.requestedAt === 'string' && !Number.isNaN(Date.parse(payload.requestedAt))) {
    request.requestedAt = new Date(payload.requestedAt).toISOString()
  }
  return { ok: true, request }
}

// A cursor is only meaningful while the bytes it already consumed are still the
// same records. Every line the sink writes ends in a newline, so the byte before
// the cursor must be one; when it is not, the file underneath the reader was
// replaced and the cursor has to restart.
function endsOnRecordBoundary(handle, cursor) {
  const probe = Buffer.alloc(1)
  return fs.readSync(handle, probe, 0, 1, cursor - 1) === 1 && probe[0] === 0x0a
}

// Append-only NDJSON hand-off between the dev-only app route (writer) and the
// supervisor (reader). The reader tracks a byte offset so it never re-ingests a
// line, and the file is rotated rather than growing without bound. Used for both
// browser reports and recovery-action requests via the `validate` option.
export function createDiagnosticsSink(options = {}) {
  const filePath = options.filePath
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : MAX_DIAGNOSTIC_SINK_BYTES
  // Every drained line is re-validated, so the same sink shape can carry either
  // browser reports or action requests without trusting what was written.
  const validate = typeof options.validate === 'function' ? options.validate : validateBrowserReport
  let offset = 0
  let inode = null

  function ensureDirectory() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }

  // Rotation unlinks instead of truncating so a reader can detect it through
  // the changed inode even when it never observed the empty file.
  function rotate() {
    offset = 0
    inode = null
    try {
      ensureDirectory()
      fs.rmSync(filePath, { force: true })
    } catch {
      // The sink is best-effort; the terminal remains authoritative.
    }
  }

  return {
    getFilePath() {
      return filePath
    },

    clear: rotate,

    append(report) {
      try {
        ensureDirectory()
        fs.appendFileSync(filePath, `${JSON.stringify(report)}\n`, 'utf8')
        return true
      } catch {
        return false
      }
    },

    drain() {
      let stats
      try {
        stats = fs.statSync(filePath)
      } catch {
        offset = 0
        inode = null
        return []
      }

      // A changed inode proves rotation, but an unchanged one proves nothing:
      // inode numbers are recycled as soon as they are freed, so a rotated file
      // routinely reappears under the inode the reader already recorded. The
      // record-boundary check below is what actually catches that.
      if (inode !== null && stats.ino !== inode) offset = 0
      inode = stats.ino
      if (stats.size < offset) offset = 0

      let chunk = ''
      try {
        const handle = fs.openSync(filePath, 'r')
        try {
          if (offset > 0 && !endsOnRecordBoundary(handle, offset)) offset = 0
          if (stats.size === offset) return []
          const length = stats.size - offset
          const buffer = Buffer.alloc(length)
          fs.readSync(handle, buffer, 0, length, offset)
          chunk = buffer.toString('utf8')
        } finally {
          fs.closeSync(handle)
        }
      } catch {
        return []
      }

      const lastNewline = chunk.lastIndexOf('\n')
      if (lastNewline === -1) return []
      offset += Buffer.byteLength(chunk.slice(0, lastNewline + 1), 'utf8')

      const reports = []
      for (const line of chunk.slice(0, lastNewline).split('\n')) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          const validated = validate(parsed)
          if (validated.ok) reports.push(validated.report ?? validated.request)
        } catch {
          // Ignore malformed lines; a partial write must not stall the drain.
        }
      }

      if (offset > maxBytes) rotate()

      return reports
    },
  }
}
