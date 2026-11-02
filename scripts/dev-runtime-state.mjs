import crypto from 'node:crypto'

export const RUNTIME_STATUS_SCHEMA_VERSION = 1
export const MAX_INCIDENTS = 20
export const MAX_DIAGNOSTIC_LINES = 200
export const MAX_BROWSER_REPORT_BYTES = 8192
export const MAX_TITLE_LENGTH = 120
export const MAX_DETAIL_LENGTH = 400
export const MAX_STACK_LENGTH = 2000
export const MAX_LEGACY_FAILURE_LINES = 20

export const RUNTIME_SOURCES = ['process', 'log', 'warmup', 'probe', 'browser']
export const RUNTIME_RECOVERY_ACTIONS = ['generate', 'migrate', 'restart']

const REDACTION_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***'],
  [/\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?)::?\/\/[^\s'"`<>)]+/gi, '$1://***'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***'],
  [/\b(authorization|proxy-authorization|x-api-key|x-auth-token)(\s*[:=]\s*)(?:\w+\s+)?\S+/gi, '$1$2***'],
  [/\b(set-cookie|cookie)(\s*[:=]\s*)[^\n]+/gi, '$1$2***'],
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g, '***'],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, '***'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '***'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|session[_-]?id)("?\s*[:=]\s*"?)([^\s"',;)}]+)/gi, '$1$2***'],
]

// Redacts credentials before a signal reaches runtime state, the diagnostic
// sink, or any status/log response. Applied to every free-text field.
export function redactSensitiveText(value, maxLength = MAX_DETAIL_LENGTH) {
  if (value == null) return undefined
  let text = String(value)
  for (const [pattern, replacement] of REDACTION_RULES) {
    text = text.replace(pattern, replacement)
  }
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+$/g, '')
  if (!text) return undefined
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function quoteIdentifier(value) {
  return `\`${value}\``
}

const RUNTIME_CLASSIFIERS = [
  {
    code: 'db_column_missing',
    pattern: /column "?([\w.]+)"? (?:of relation "([^"]+)" )?does not exist/i,
    title: 'Database schema mismatch',
    detail: (match) => (match[2]
      ? `Column ${quoteIdentifier(match[1])} is missing on relation ${quoteIdentifier(match[2])}`
      : `Column ${quoteIdentifier(match[1])} is missing`),
    recovery: 'migrate',
  },
  {
    code: 'db_relation_missing',
    pattern: /relation "([^"]+)" does not exist/i,
    title: 'Database schema mismatch',
    detail: (match) => `Relation ${quoteIdentifier(match[1])} is missing`,
    recovery: 'migrate',
  },
  {
    code: 'db_type_missing',
    pattern: /type "([^"]+)" does not exist/i,
    title: 'Database schema mismatch',
    detail: (match) => `Type ${quoteIdentifier(match[1])} is missing`,
    recovery: 'migrate',
  },
  {
    code: 'db_pending_migrations',
    pattern: /pending migrations|migrations? (?:are )?out of sync|run .*db:migrate/i,
    title: 'Pending database migrations',
    detail: () => 'The database schema is behind the current entity definitions',
    recovery: 'migrate',
  },
  {
    code: 'db_unreachable',
    pattern: /(ECONNREFUSED|ENOTFOUND|ETIMEDOUT)[^\n]*(5432|postgres)|could not connect to server|Connection terminated unexpectedly/i,
    title: 'Database is unreachable',
    detail: () => 'The development database did not accept a connection',
  },
  {
    code: 'db_auth_failed',
    pattern: /password authentication failed|role "[^"]+" does not exist/i,
    title: 'Database credentials rejected',
    detail: () => 'The configured database user could not authenticate',
  },
  {
    code: 'generated_registry_missing',
    pattern: /Cannot find module '[^']*generated[^']*'|Module not found:[^\n]*generated/i,
    title: 'Generated registry is missing',
    detail: () => 'A generated module registry is missing or stale',
    recovery: 'generate',
  },
  {
    code: 'module_not_found',
    pattern: /Module not found: Can't resolve '([^']+)'|Cannot find module '([^']+)'/i,
    title: 'Module cannot be resolved',
    detail: (match) => `Cannot resolve ${quoteIdentifier(match[1] ?? match[2])}`,
    recovery: 'generate',
  },
  {
    code: 'chunk_load_failed',
    pattern: /ChunkLoadError|Loading chunk \S+ failed|Loading CSS chunk/i,
    title: 'Stale build assets',
    detail: () => 'The browser requested a chunk the current build no longer serves',
    recovery: 'restart',
  },
  {
    code: 'bundler_crashed',
    pattern: /TurbopackInternalError|\bpanicked at\b|FATAL ERROR: .*heap out of memory/i,
    title: 'Bundler crashed',
    detail: () => 'The development bundler terminated unexpectedly',
    recovery: 'restart',
  },
  {
    code: 'dev_server_conflict',
    pattern: /Another next dev server is already running|Unable to acquire lock/i,
    title: 'Another dev server is running',
    detail: () => 'A second development server holds the runtime lock',
  },
  {
    code: 'port_in_use',
    pattern: /EADDRINUSE/i,
    title: 'Port is already in use',
    detail: () => 'The configured development port is occupied by another process',
  },
  {
    code: 'type_error',
    pattern: /^\s*(?:Type error|TS\d+):/im,
    title: 'TypeScript error',
    detail: (match, message) => message,
  },
  {
    code: 'syntax_error',
    pattern: /SyntaxError|Parsing ecmascript source code failed|Unexpected token/i,
    title: 'Syntax error',
    detail: (match, message) => message,
  },
]

const SOURCE_FALLBACKS = {
  process: { code: 'process_failed', title: 'Runtime process failed' },
  log: { code: 'runtime_error', title: 'Runtime error detected' },
  warmup: { code: 'warmup_failed', title: 'Startup warmup failed' },
  probe: { code: 'probe_failed', title: 'Runtime health check failed' },
  browser: { code: 'browser_error', title: 'Browser rendering error' },
}

// Maps a raw failure message onto a stable code + user-readable title/detail.
// Never executes anything; classification is pure text analysis.
export function classifyRuntimeMessage(message, source = 'log') {
  const text = typeof message === 'string' ? message : ''
  for (const classifier of RUNTIME_CLASSIFIERS) {
    const match = classifier.pattern.exec(text)
    if (!match) continue
    return {
      code: classifier.code,
      title: classifier.title,
      detail: classifier.detail(match, text),
      recovery: classifier.recovery,
    }
  }
  const fallback = SOURCE_FALLBACKS[source] ?? SOURCE_FALLBACKS.log
  return { code: fallback.code, title: fallback.title, detail: text || undefined, recovery: undefined }
}

function normalizeForFingerprint(message, cwd) {
  let text = String(message ?? '')
  if (cwd) text = text.split(cwd).join('.')
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<addr>')
    .replace(/:\d+:\d+\b/g, ':<pos>')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

// Deterministic identity for an incident. Derived from the classified code and
// sanitized locators rather than raw stack text so retries of the same failure
// collapse into one entry.
export function fingerprintRuntimeIssue({ source, code, path: issuePath, digest, message, cwd } = {}) {
  const parts = [
    String(source ?? 'log'),
    String(code ?? 'runtime_error'),
    String(issuePath ?? ''),
    String(digest ?? ''),
    digest ? '' : normalizeForFingerprint(message, cwd),
  ]
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

function sanitizePath(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(trimmed, 'http://localhost')
    return `${parsed.pathname}`.slice(0, 200)
  } catch {
    return trimmed.slice(0, 200)
  }
}

function sanitizeDigest(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) return undefined
  return trimmed
}

function normalizeFailureLines(lines) {
  if (!Array.isArray(lines)) return []
  return lines
    .map((line) => redactSensitiveText(line, 500))
    .filter((line) => typeof line === 'string' && line.length > 0)
    .slice(-MAX_LEGACY_FAILURE_LINES)
}

// A blocking incident prevents the runtime from serving at all; a non-blocking
// one degrades an otherwise usable runtime.
function resolveBlocking(signal, readySeen) {
  if (typeof signal.blocking === 'boolean') return signal.blocking
  if (signal.source === 'process' || signal.source === 'warmup') return true
  if (signal.source === 'log') return !readySeen
  return false
}

export function projectLegacyReadyFailed(health) {
  switch (health) {
    case 'ready':
      return { ready: true, failed: false }
    case 'degraded':
      return { ready: true, failed: false }
    case 'unavailable':
      return { ready: false, failed: true }
    default:
      return { ready: false, failed: false }
  }
}

function severityRank(severity) {
  return severity === 'error' ? 2 : 1
}

export function createRuntimeStateStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const cwd = typeof options.cwd === 'string' ? options.cwd : undefined
  const maxIncidents = Number.isInteger(options.maxIncidents) ? options.maxIncidents : MAX_INCIDENTS
  const maxLines = Number.isInteger(options.maxDiagnosticLines) ? options.maxDiagnosticLines : MAX_DIAGNOSTIC_LINES

  const state = {
    generation: 0,
    readySeen: false,
    health: 'starting',
    updatedAt: now().toISOString(),
    incidents: new Map(),
    recovery: null,
    upstream: {
      configuredPort: Number.isInteger(options.configuredPort) ? options.configuredPort : 0,
      actualPort: undefined,
      publicUrl: typeof options.publicUrl === 'string' ? options.publicUrl : '',
    },
    legacy: { failureLines: [], failureCommand: undefined, failureStage: undefined },
  }

  const diagnosticLines = []
  let diagnosticSequence = 0
  let issueSequence = 0

  function touch() {
    state.updatedAt = now().toISOString()
  }

  function activeIncidents() {
    return Array.from(state.incidents.values()).filter((issue) => issue.generation === state.generation)
  }

  function deriveHealth() {
    if (state.recovery?.busy) return 'recovering'
    const active = activeIncidents()
    if (active.some((issue) => issue.blocking)) return 'unavailable'
    if (!state.readySeen) return 'starting'
    if (active.some((issue) => issue.severity === 'error')) return 'degraded'
    return 'ready'
  }

  function refreshHealth() {
    state.health = deriveHealth()
    touch()
    return state.health
  }

  function pruneIncidents() {
    if (state.incidents.size <= maxIncidents) return
    const ordered = Array.from(state.incidents.entries())
      .sort((a, b) => Date.parse(a[1].lastSeenAt) - Date.parse(b[1].lastSeenAt))
    while (state.incidents.size > maxIncidents && ordered.length > 0) {
      state.incidents.delete(ordered.shift()[0])
    }
  }

  function toPublicIssue(issue) {
    const { blocking, ...rest } = issue
    return rest
  }

  function resolveSummary() {
    const active = activeIncidents()
    if (active.length === 0) return undefined
    const sorted = [...active].sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1
      const bySeverity = severityRank(b.severity) - severityRank(a.severity)
      if (bySeverity !== 0) return bySeverity
      return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)
    })
    return toPublicIssue(sorted[0])
  }

  function getStatus() {
    const legacyFlags = projectLegacyReadyFailed(state.health)
    const incidents = activeIncidents()
      .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
      .map(toPublicIssue)
    return {
      schemaVersion: RUNTIME_STATUS_SCHEMA_VERSION,
      generation: state.generation,
      health: state.health,
      ready: legacyFlags.ready,
      failed: legacyFlags.failed,
      updatedAt: state.updatedAt,
      upstream: { ...state.upstream },
      issueSummary: resolveSummary(),
      incidents,
      recovery: state.recovery ? { ...state.recovery } : undefined,
      legacy: {
        failureLines: [...state.legacy.failureLines],
        failureCommand: state.legacy.failureCommand,
        failureStage: state.legacy.failureStage,
      },
    }
  }

  function appendDiagnosticLine(line, meta = {}) {
    const text = redactSensitiveText(line, 500)
    if (!text) return null
    diagnosticSequence += 1
    const entry = {
      seq: diagnosticSequence,
      at: now().toISOString(),
      generation: state.generation,
      source: typeof meta.source === 'string' ? meta.source : 'log',
      text,
    }
    diagnosticLines.push(entry)
    while (diagnosticLines.length > maxLines) diagnosticLines.shift()
    return entry
  }

  function recordSignal(signal = {}) {
    if (!signal || typeof signal !== 'object') return getStatus()
    if (Number.isInteger(signal.generation) && signal.generation !== state.generation) {
      return getStatus()
    }

    const source = RUNTIME_SOURCES.includes(signal.source) ? signal.source : 'log'
    const rawMessage = typeof signal.message === 'string' ? signal.message : ''
    const classified = classifyRuntimeMessage(rawMessage, source)
    const code = typeof signal.code === 'string' && signal.code.trim() ? signal.code.trim() : classified.code
    const severity = signal.severity === 'warning' ? 'warning' : 'error'
    const issuePath = sanitizePath(signal.path)
    const digest = sanitizeDigest(signal.digest)
    const title = redactSensitiveText(signal.title ?? classified.title, MAX_TITLE_LENGTH) ?? 'Runtime error detected'
    const detail = redactSensitiveText(signal.detail ?? classified.detail ?? rawMessage, MAX_DETAIL_LENGTH)
    const recovery = RUNTIME_RECOVERY_ACTIONS.includes(signal.recovery)
      ? signal.recovery
      : classified.recovery
    const blocking = resolveBlocking({ ...signal, source }, state.readySeen)
    const fingerprint = fingerprintRuntimeIssue({
      source,
      code,
      path: issuePath,
      digest,
      message: rawMessage || detail,
      cwd,
    })
    const timestamp = now().toISOString()

    const existing = state.incidents.get(fingerprint)
    if (existing && existing.generation === state.generation) {
      existing.lastSeenAt = timestamp
      existing.occurrences += 1
      existing.severity = severityRank(severity) > severityRank(existing.severity) ? severity : existing.severity
      existing.blocking = existing.blocking || blocking
      if (detail) existing.detail = detail
    } else {
      issueSequence += 1
      state.incidents.set(fingerprint, {
        id: `${state.generation}-${issueSequence}`,
        fingerprint,
        code,
        source,
        severity,
        title,
        detail,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        occurrences: 1,
        generation: state.generation,
        path: issuePath,
        digest,
        recovery,
        blocking,
      })
      pruneIncidents()
    }

    if (Array.isArray(signal.failureLines) && signal.failureLines.length > 0) {
      state.legacy.failureLines = normalizeFailureLines(signal.failureLines)
    }
    if (typeof signal.failureCommand === 'string') {
      state.legacy.failureCommand = redactSensitiveText(signal.failureCommand, 200)
    }
    if (typeof signal.failureStage === 'string') {
      state.legacy.failureStage = redactSensitiveText(signal.failureStage, 120)
    }

    appendDiagnosticLine(detail ?? rawMessage ?? title, { source })
    refreshHealth()
    return getStatus()
  }

  return {
    getStatus,
    recordSignal,
    appendDiagnosticLine,

    getGeneration() {
      return state.generation
    },

    // Each managed process launch owns a generation. Signals, probes, and
    // action completions from an older generation are ignored.
    beginGeneration(reason) {
      state.generation += 1
      state.readySeen = false
      state.incidents.clear()
      state.legacy = { failureLines: [], failureCommand: undefined, failureStage: undefined }
      state.recovery = null
      if (reason) appendDiagnosticLine(`Runtime generation ${state.generation} started (${reason})`, { source: 'process' })
      refreshHealth()
      return state.generation
    },

    setUpstream(patch = {}) {
      if (Number.isInteger(patch.configuredPort)) state.upstream.configuredPort = patch.configuredPort
      if (Number.isInteger(patch.actualPort)) state.upstream.actualPort = patch.actualPort
      if (typeof patch.publicUrl === 'string') state.upstream.publicUrl = patch.publicUrl
      touch()
      return getStatus()
    },

    // Only the full startup warmup may open the READY gate.
    markReady() {
      state.readySeen = true
      for (const [fingerprint, issue] of state.incidents) {
        if (issue.generation === state.generation && issue.blocking) {
          state.incidents.delete(fingerprint)
        }
      }
      state.legacy = { failureLines: [], failureCommand: undefined, failureStage: undefined }
      refreshHealth()
      return getStatus()
    },

    isReadySeen() {
      return state.readySeen
    },

    clearIncident(fingerprint) {
      const removed = state.incidents.delete(fingerprint)
      if (removed) refreshHealth()
      return removed
    },

    clearIncidentsBySource(source) {
      let removed = 0
      for (const [fingerprint, issue] of state.incidents) {
        if (issue.source !== source) continue
        state.incidents.delete(fingerprint)
        removed += 1
      }
      if (removed > 0) refreshHealth()
      return removed
    },

    beginRecovery(action) {
      if (!RUNTIME_RECOVERY_ACTIONS.includes(action)) return null
      state.recovery = { action, startedAt: now().toISOString(), busy: true }
      refreshHealth()
      return getStatus()
    },

    isRecoveryBusy() {
      return Boolean(state.recovery?.busy)
    },

    completeRecovery(exitCode, options = {}) {
      if (!state.recovery) return getStatus()
      if (Number.isInteger(options.generation) && options.generation !== state.generation) {
        return getStatus()
      }
      state.recovery = {
        ...state.recovery,
        busy: false,
        lastExitCode: Number.isInteger(exitCode) ? exitCode : undefined,
      }
      refreshHealth()
      return getStatus()
    },

    getDiagnosticLines(cursor) {
      const from = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0
      const lines = diagnosticLines.filter((entry) => entry.seq > from)
      return {
        lines,
        nextCursor: lines.length > 0 ? lines[lines.length - 1].seq : from,
        generation: state.generation,
      }
    },
  }
}

// Threshold policy shared by the supervisor probe and its tests. Kept separate
// from the transport so timings can be exercised without real HTTP.
export function createProbePolicy(options = {}) {
  const failureThreshold = Number.isInteger(options.failureThreshold) && options.failureThreshold > 0
    ? options.failureThreshold
    : 3
  const recoveryThreshold = Number.isInteger(options.recoveryThreshold) && options.recoveryThreshold > 0
    ? options.recoveryThreshold
    : 2

  let consecutiveFailures = 0
  let consecutiveSuccesses = 0

  return {
    reset() {
      consecutiveFailures = 0
      consecutiveSuccesses = 0
    },
    getCounters() {
      return { consecutiveFailures, consecutiveSuccesses }
    },
    // Returns 'degraded' / 'recovered' only when a threshold is newly crossed,
    // so the supervisor does not rewrite state on every tick.
    record(healthy) {
      if (healthy) {
        consecutiveFailures = 0
        consecutiveSuccesses += 1
        if (consecutiveSuccesses === recoveryThreshold) return 'recovered'
        return null
      }
      consecutiveSuccesses = 0
      consecutiveFailures += 1
      if (consecutiveFailures === failureThreshold) return 'degraded'
      return null
    },
  }
}
