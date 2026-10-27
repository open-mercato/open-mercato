import {
  DEV_RUNTIME_BANNER_META_NAME,
  DEV_RUNTIME_DIAGNOSTICS_PATH,
  DEV_RUNTIME_LOGS_URL_META_NAME,
  DEV_RUNTIME_TOKEN_HEADER,
  DEV_RUNTIME_TOKEN_META_NAME,
  type DevRuntimeReport,
  type DevRuntimeReportKind,
} from './types'

const MAX_MESSAGE_LENGTH = 500
const MAX_STACK_LENGTH = 2000
const MAX_REPORTS_PER_PAGE = 20

let sentReports = 0
const seenFingerprints = new Set<string>()

function readMeta(name: string): string | null {
  if (typeof document === 'undefined') return null
  const element = document.querySelector(`meta[name="${name}"]`)
  const content = element?.getAttribute('content')?.trim()
  return content ? content : null
}

export function readDevRuntimeToken(): string | null {
  return readMeta(DEV_RUNTIME_TOKEN_META_NAME)
}

export function isDevRuntimeBannerEnabled(): boolean {
  return readMeta(DEV_RUNTIME_BANNER_META_NAME) === '1'
}

export function readDevRuntimeLogsUrl(): string | null {
  return readMeta(DEV_RUNTIME_LOGS_URL_META_NAME)
}

function truncate(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

export function describeDevRuntimeError(error: unknown): { message: string; stack?: string; digest?: string } {
  if (error instanceof Error) {
    return {
      message: `${error.name}: ${error.message}`,
      stack: truncate(error.stack, MAX_STACK_LENGTH),
      digest: truncate((error as { digest?: unknown }).digest, 64),
    }
  }
  if (typeof error === 'string') return { message: error }
  return { message: 'Unknown browser error' }
}

/**
 * Best-effort, fire-and-forget browser report. It never blocks rendering, never
 * retries, and silently gives up when the collector is unavailable — a broken
 * runtime must still show its own rendered error state.
 */
export function reportDevRuntimeError(input: {
  kind: DevRuntimeReportKind
  error?: unknown
  message?: string
  digest?: string
  stack?: string
}): void {
  if (typeof window === 'undefined') return
  if (sentReports >= MAX_REPORTS_PER_PAGE) return

  const token = readDevRuntimeToken()
  if (!token) return

  const described: Partial<ReturnType<typeof describeDevRuntimeError>> = input.error !== undefined
    ? describeDevRuntimeError(input.error)
    : {}
  const message = truncate(input.message ?? described.message, MAX_MESSAGE_LENGTH)
  if (!message) return

  const digest = truncate(input.digest ?? described.digest, 64)
  const stack = truncate(input.stack ?? described.stack, MAX_STACK_LENGTH)
  const path = truncate(window.location?.pathname, 300)

  // One report per distinct failure per page: a render loop must not turn into
  // a request loop.
  const fingerprint = `${input.kind}|${digest ?? message}|${path ?? ''}`
  if (seenFingerprints.has(fingerprint)) return
  seenFingerprints.add(fingerprint)
  sentReports += 1

  const report: DevRuntimeReport = {
    kind: input.kind,
    message,
    timestamp: new Date().toISOString(),
  }
  if (digest) report.digest = digest
  if (stack) report.stack = stack
  if (path) report.path = path

  try {
    void fetch(DEV_RUNTIME_DIAGNOSTICS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [DEV_RUNTIME_TOKEN_HEADER]: token },
      body: JSON.stringify(report),
      cache: 'no-store',
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Reporting is optional; the rendered fallback stays the source of truth.
  }
}

export function resetDevRuntimeReporterForTests(): void {
  sentReports = 0
  seenFingerprints.clear()
}
