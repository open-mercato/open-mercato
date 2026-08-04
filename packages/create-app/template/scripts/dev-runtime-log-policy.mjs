// Mirrors the pretty transport format in packages/shared/src/lib/logger/transport.pretty.ts:
// `HH:MM:SS.mmm LEVEL [scope] message key=value`, with an `err` binding appended
// as the error stack on the following lines (first line e.g. `TypeError: fetch failed`).
const STRUCTURED_PRETTY_LOG_PREFIX = /^\d{2}:\d{2}:\d{2}\.\d{3}\s+(?:DEBUG|INFO|WARN|ERROR)\s+/

export function stripStructuredLogPrefix(line) {
  if (typeof line !== 'string') return ''
  return line.replace(STRUCTURED_PRETTY_LOG_PREFIX, '')
}

// Client console output forwarded by the browser log bridge. It describes the
// page, not the dev runtime, so a handled client-side warning must never latch
// the runtime failure state or force the compact view open.
const BROWSER_FORWARDED_LOG_PREFIX = '[browser]'
const STACK_FRAME_PATTERN = /^at\s+\S/
const STRUCTURED_PRETTY_NON_ERROR_PREFIX = /^\d{2}:\d{2}:\d{2}\.\d{3}\s+(?:DEBUG|INFO|WARN)\s+/

export function isBrowserForwardedLogLine(line) {
  if (typeof line !== 'string') return false
  return stripStructuredLogPrefix(line.trim()).startsWith(BROWSER_FORWARDED_LOG_PREFIX)
}

// Stack frames only ever follow a header line, and that header is what decides
// whether the block is a failure. Frames matched on their own text produce false
// positives, because module paths and function names routinely contain "failed".
export function isStackFrameLine(line) {
  if (typeof line !== 'string') return false
  return STACK_FRAME_PATTERN.test(line.trim())
}

// The structured logger already encodes severity; trust the level over a
// substring match on the message.
export function isStructuredNonErrorLogLine(line) {
  if (typeof line !== 'string') return false
  return STRUCTURED_PRETTY_NON_ERROR_PREFIX.test(line.trim())
}

export function isNonRuntimeFailureLine(line) {
  return isBrowserForwardedLogLine(line)
    || isStackFrameLine(line)
    || isStructuredNonErrorLogLine(line)
}

const KMS_VAULT_FALLBACK_MESSAGE_PATTERN = /^\[shared:kms\] (?:Vault (?:read|write) (?:error|failed)\b|Vault write CAS conflict\b|No tenant DEK found in Vault\b|Failed to store tenant DEK in Vault\b)/

export function isIgnorableDerivedKeyWarningLine(line) {
  if (typeof line !== 'string') return false

  const normalized = stripStructuredLogPrefix(line.trim())

  return normalized.startsWith('⚠️ [encryption][kms] Vault read error')
    || normalized.startsWith('⚠️ [encryption][kms] No tenant DEK found in Vault')
    || KMS_VAULT_FALLBACK_MESSAGE_PATTERN.test(normalized)
    || normalized.startsWith("path: 'secret/data/tenant_key_")
    || normalized.startsWith("error: 'fetch failed'")
    || normalized === 'TypeError: fetch failed'
    || normalized === '}'
    || normalized.startsWith('━━━━━━━━')
    || normalized.includes('Using derived tenant encryption keys')
    || normalized.startsWith('Source: TENANT_DATA_ENCRYPTION_FALLBACK_KEY')
    || normalized.startsWith('Source: TENANT_DATA_ENCRYPTION_KEY')
    || normalized.startsWith('Source: dev default secret')
    || normalized.startsWith('Secret: ')
    || normalized.startsWith('Secret fingerprint (sha256, truncated):')
    || normalized.startsWith('Persist this secret securely.')
}

function isIgnorableStructuredWarningBlockStartLine(line) {
  if (typeof line !== 'string') return false

  const normalized = line.trim()
  if (!normalized.endsWith('{')) return false

  return isIgnorableSearchWarningLine(normalized)
    || isIgnorableDerivedKeyWarningLine(normalized)
}

export function isIgnorableSearchWarningLine(line) {
  if (typeof line !== 'string') return false

  const normalized = line.trim()

  return /^\[SearchService\] Strategy \S+ failed\b/.test(normalized)
    || /^\[search\.[^\]]+\] Failed to\b/.test(normalized)
}

export function isIgnorableQueueLogLine(line) {
  if (typeof line !== 'string') return false
  return line.trim().startsWith('[queue:')
}

export function isIgnorableSchedulerLogLine(line) {
  if (typeof line !== 'string') return false
  return line.trim().startsWith('[scheduler:')
}

export function isInteractivePromptHintLine(line) {
  if (typeof line !== 'string') return false
  return line.trim() === 'Press Ctrl+C to stop.'
}

export function isIgnorableExtraCertsWarningLine(line) {
  if (typeof line !== 'string') return false
  return line.trim().startsWith('Warning: Ignoring extra certs from')
}

export function isIgnorableNextDevServerBannerLine(line) {
  if (typeof line !== 'string') return false
  const normalized = line.trim()
  return normalized.startsWith('▲ Next.js ')
    || normalized === '✓ Starting...'
    || normalized.startsWith('- Network:')
    || normalized.startsWith('- Environments:')
    || normalized.startsWith('- Experiments')
}

export function isIgnorableTurbopackQuirkLine(line) {
  if (typeof line !== 'string') return false
  const normalized = line.trim()
  return normalized.startsWith('⨯ preloadEntriesOnStart')
    || normalized.startsWith('⨯ serverMinification')
    || normalized.startsWith('⨯ turbopackMinify')
}

export function isIgnorableBootstrapNoiseLine(line) {
  if (typeof line !== 'string') return false
  const normalized = line.trim()
  return normalized.startsWith('[Bootstrap] Entity IDs re-registered')
    || normalized.startsWith('🚀 Starting scheduler')
    || normalized.startsWith('✓ Local scheduler started')
    || normalized.startsWith('[lazy-scheduler] Watching for enabled schedules')
    || normalized.startsWith('[lazy-scheduler] Schedule probe failed')
    || normalized.startsWith('[lazy-scheduler] Poll cycle failed')
    || normalized.startsWith('[lazy-scheduler] Initial poll failed')
    || normalized.startsWith('💡 Tip:')
}

export function createSplashPassthroughIgnoreMatcher() {
  let warningBlockDepth = 0

  return function shouldIgnoreLine(line, options = {}) {
    if (typeof line !== 'string') return false
    void options

    const normalized = line.trim()
    if (!normalized) return false

    if (warningBlockDepth > 0) {
      if (normalized.endsWith('{')) {
        warningBlockDepth += 1
      }
      if (normalized === '}') {
        warningBlockDepth = Math.max(0, warningBlockDepth - 1)
      }
      return true
    }

    if (!isIgnorableStructuredWarningBlockStartLine(normalized)) {
      return false
    }

    warningBlockDepth = 1

    return true
  }
}

export function shouldIgnoreSplashPassthroughLine(line, options = {}) {
  return createSplashPassthroughIgnoreMatcher()(line, options)
}

const STATELESS_RUNTIME_NOISE_PREDICATES = [
  isIgnorableQueueLogLine,
  isIgnorableSchedulerLogLine,
  isInteractivePromptHintLine,
  isIgnorableExtraCertsWarningLine,
  isIgnorableDerivedKeyWarningLine,
  isIgnorableSearchWarningLine,
  isIgnorableNextDevServerBannerLine,
  isIgnorableTurbopackQuirkLine,
  isIgnorableBootstrapNoiseLine,
]

export function isStatelessRuntimeNoiseLine(line) {
  if (typeof line !== 'string') return false
  for (const predicate of STATELESS_RUNTIME_NOISE_PREDICATES) {
    if (predicate(line)) return true
  }
  return false
}

export function createRuntimeNoiseFilter() {
  const splashMatcher = createSplashPassthroughIgnoreMatcher()

  return function shouldIgnoreRuntimeLine(line, options = {}) {
    if (typeof line !== 'string') return true

    const normalized = line.trim()
    if (!normalized) return true

    // Run the splash matcher first so it can track multi-line warning block
    // depth even when the header line would also be caught by the stateless
    // search-warning predicate.
    if (splashMatcher(normalized, options)) return true

    return isStatelessRuntimeNoiseLine(normalized)
  }
}

export function formatChildExitStatus(result) {
  if (typeof result?.code === 'number') {
    return `exit code ${result.code}`
  }
  if (result?.signal) {
    return `signal ${result.signal}`
  }
  return 'an unknown status'
}

export function resolveChildExitCode(result, fallback = 1) {
  if (typeof result?.code === 'number') {
    return result.code
  }
  if (result?.signal === 'SIGINT') {
    return 130
  }
  if (result?.signal === 'SIGTERM') {
    return 143
  }
  return fallback
}

export function resolveUnexpectedExitCode(result) {
  const exitCode = resolveChildExitCode(result, 1)
  return exitCode === 0 ? 1 : exitCode
}

// Compact mode classifies unmatched child output as `ignore`, so the error that
// actually killed the runtime never reaches the terminal. Replay the buffered
// tail alongside the exit banner — without it a startup crash reports only its
// exit code. The banner is returned separately because callers print it once and
// buffer it without echoing it a second time.
export function buildUnexpectedChildExitReport({
  label,
  exitStatus,
  bufferedFailureLines = [],
  logsVisible = false,
  maxFailureLines = 10,
} = {}) {
  const banner = `❌ ${label ?? 'Child process'} exited unexpectedly with ${exitStatus ?? 'an unknown status'}`
  const buffered = Array.isArray(bufferedFailureLines) ? bufferedFailureLines : []
  // Raw logs are already streaming to the terminal, so replaying them would
  // duplicate every line the user can see.
  const replay = logsVisible ? [] : buffered
  const terminalLines = replay.length > 0
    ? [
        banner,
        `📄 Last ${replay.length} runtime log line(s) before the exit:`,
        ...replay,
        'ℹ️ Rerun with MERCATO_DEV_OUTPUT=verbose for the full runtime output.',
      ]
    : [banner]

  return {
    banner,
    terminalLines,
    failureLines: [...buffered, banner].slice(-maxFailureLines),
  }
}

// `mercato server dev` announces an in-flight restart on stdout before it respawns
// Next.js. These are the markers it prints; the compact reporter keys on them to
// leave its failure state, because the runtime it just declared failed is coming back.
const RUNTIME_RESTART_MARKERS = [
  '[server] Next.js dev server exited before becoming ready',
  '[server] Detected corrupted Turbopack dev cache.',
]

export function isRuntimeRestartMarker(line) {
  if (typeof line !== 'string') return false
  return RUNTIME_RESTART_MARKERS.some((marker) => line.startsWith(marker))
}

// The compact reporter switches to raw passthrough on the first failure-looking
// line and stops classifying everything after it. A runtime that self-heals — a
// retried cold start, a Turbopack cache reset — would then stay reported as failed
// forever: the restart and ready lines never reach `classifyServerLine`, so warmup
// never starts and the splash never leaves the error state. The latch therefore
// releases on a restart marker and re-arms on the next failure.
export function createRuntimeFailureLatch() {
  let latched = false

  return {
    isLatched: () => latched,
    latch: () => {
      latched = true
    },
    releaseOn: (line) => {
      if (!latched || !isRuntimeRestartMarker(line)) return false
      latched = false
      return true
    },
  }
}
