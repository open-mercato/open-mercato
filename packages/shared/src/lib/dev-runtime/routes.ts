import { z } from 'zod'

import { redactDevRuntimeText } from './redaction'
import {
  appendDevRuntimeActionRequest,
  appendDevRuntimeReport,
  isMatchingDevRuntimeToken,
  readDevRuntimeLogs,
  readDevRuntimeStatus,
  resolveDevRuntimeServerConfig,
  type DevRuntimeServerConfig,
} from './server'
import {
  DEV_RUNTIME_RECOVERY_ACTIONS,
  DEV_RUNTIME_TOKEN_HEADER,
  type DevRuntimeReport,
  type RuntimeRecoveryAction,
} from './types'

export const MAX_DEV_RUNTIME_REPORT_BYTES = 8192
const MAX_REPORTS_PER_WINDOW = 30
const RATE_LIMIT_WINDOW_MS = 10_000

const reportSchema = z.object({
  kind: z.enum(['global-error', 'window-error', 'unhandled-rejection', 'chunk-load-error', 'request-error']),
  message: z.string().trim().min(1).max(2000),
  digest: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  path: z.string().max(300).optional(),
  stack: z.string().max(20_000).optional(),
  timestamp: z.string().datetime().optional(),
})

type RateLimiter = { tryConsume: () => boolean }

function createRateLimiter(now: () => number = () => Date.now()): RateLimiter {
  let windowStart = now()
  let count = 0
  return {
    tryConsume() {
      const timestamp = now()
      if (timestamp - windowStart >= RATE_LIMIT_WINDOW_MS) {
        windowStart = timestamp
        count = 0
      }
      if (count >= MAX_REPORTS_PER_WINDOW) return false
      count += 1
      return true
    },
  }
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status })
}

const NOT_FOUND = () => jsonError(404, 'not_found', 'Not found.')

function isAuthorized(request: Request, config: DevRuntimeServerConfig): boolean {
  return isMatchingDevRuntimeToken(config.token, request.headers.get(DEV_RUNTIME_TOKEN_HEADER))
}

// A browser sends `Origin` on cross-origin requests; anything that does not
// match the request's own host is rejected outright. Non-browser callers that
// omit `Origin` still have to present the token.
function isAcceptableOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

export type DevRuntimeRouteOptions = {
  resolveConfig?: () => DevRuntimeServerConfig
}

/**
 * Dev-only status bridge for the in-app banner. It exposes only the
 * supervisor's local runtime state and returns 404 whenever diagnostics are off
 * or the supervisor is not running.
 */
export function createDevRuntimeStatusRoute(options: DevRuntimeRouteOptions = {}) {
  const resolveConfig = options.resolveConfig ?? (() => resolveDevRuntimeServerConfig())

  return async function GET(request: Request): Promise<Response> {
    const config = resolveConfig()
    if (!config.enabled) return NOT_FOUND()
    if (!isAcceptableOrigin(request)) return jsonError(403, 'forbidden', 'Origin is not allowed.')
    if (!isAuthorized(request, config)) return jsonError(403, 'forbidden', 'Invalid dev runtime token.')

    const status = readDevRuntimeStatus(config)
    if (!status) return jsonError(404, 'not_found', 'Runtime status is not available.')

    return Response.json(status, { headers: { 'cache-control': 'no-store' } })
  }
}

export function createDevRuntimeDiagnosticsRoute(options: DevRuntimeRouteOptions = {}) {
  const resolveConfig = options.resolveConfig ?? (() => resolveDevRuntimeServerConfig())
  const limiter = createRateLimiter()

  return async function POST(request: Request): Promise<Response> {
    const config = resolveConfig()
    if (!config.enabled) return NOT_FOUND()
    if (!isAcceptableOrigin(request)) return jsonError(403, 'forbidden', 'Origin is not allowed.')
    if (!isAuthorized(request, config)) return jsonError(403, 'forbidden', 'Invalid dev runtime token.')

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('application/json')) {
      return jsonError(400, 'invalid_report', 'Diagnostic report must be JSON.')
    }

    const body = await request.text()
    if (Buffer.byteLength(body, 'utf8') > MAX_DEV_RUNTIME_REPORT_BYTES) {
      return jsonError(400, 'report_too_large', 'Diagnostic report exceeds the size limit.')
    }

    let parsedBody: unknown
    try {
      parsedBody = JSON.parse(body)
    } catch {
      return jsonError(400, 'invalid_report', 'Diagnostic report is not valid JSON.')
    }

    const parsed = reportSchema.safeParse(parsedBody)
    if (!parsed.success) {
      return jsonError(400, 'invalid_report', 'Diagnostic report failed validation.')
    }

    if (!limiter.tryConsume()) {
      return jsonError(429, 'rate_limited', 'Too many diagnostic reports.')
    }

    const message = redactDevRuntimeText(parsed.data.message, 500)
    if (!message) return jsonError(400, 'invalid_report', 'Diagnostic report message is empty after redaction.')

    const report: DevRuntimeReport = { kind: parsed.data.kind, message }
    if (parsed.data.digest) report.digest = parsed.data.digest
    const sanitizedPath = redactDevRuntimeText(parsed.data.path, 300)
    if (sanitizedPath) report.path = sanitizedPath.startsWith('/') ? sanitizedPath : `/${sanitizedPath}`
    const sanitizedStack = redactDevRuntimeText(parsed.data.stack, 2000)
    if (sanitizedStack) report.stack = sanitizedStack
    report.timestamp = parsed.data.timestamp ?? new Date().toISOString()

    if (!appendDevRuntimeReport(config, report)) {
      return jsonError(503, 'collector_unavailable', 'Diagnostic collector is unavailable.')
    }

    return Response.json({ accepted: true, issueId: `${report.kind}:${report.timestamp}` }, { status: 202 })
  }
}

/**
 * Dev-only recovery bridge for the in-app banner. The action is matched against
 * the fixed allowlist and queued for the supervisor, which owns the actual
 * lifecycle step — this route never spawns a process itself.
 */
export function createDevRuntimeActionsRoute(options: DevRuntimeRouteOptions = {}) {
  const resolveConfig = options.resolveConfig ?? (() => resolveDevRuntimeServerConfig())

  return async function POST(request: Request, context: { params: Promise<{ action: string }> }): Promise<Response> {
    const config = resolveConfig()
    if (!config.enabled) return NOT_FOUND()
    if (!isAcceptableOrigin(request)) return jsonError(403, 'forbidden', 'Origin is not allowed.')
    if (!isAuthorized(request, config)) return jsonError(403, 'forbidden', 'Invalid dev runtime token.')

    const { action } = await context.params
    if (!DEV_RUNTIME_RECOVERY_ACTIONS.includes(action as RuntimeRecoveryAction)) {
      return jsonError(400, 'unknown_action', 'Unknown recovery action.')
    }

    const status = readDevRuntimeStatus(config)
    if (!status) return jsonError(503, 'supervisor_unavailable', 'The supervisor is not available.')
    // Serialization is enforced again by the runner; rejecting here just gives
    // the banner an immediate, accurate answer instead of a silent queue.
    if (status.recovery?.busy) {
      return jsonError(409, 'action_busy', `The "${status.recovery.action}" action is still running.`)
    }

    const requestedAt = new Date().toISOString()
    const queued = appendDevRuntimeActionRequest(config, {
      action: action as RuntimeRecoveryAction,
      generation: status.generation,
      requestedAt,
    })
    if (!queued) return jsonError(503, 'supervisor_unavailable', 'The supervisor cannot accept recovery actions.')

    return Response.json(
      { accepted: true, actionId: `${status.generation}:${action}:${requestedAt}`, generation: status.generation },
      { status: 202 },
    )
  }
}

/**
 * Dev-only bounded log tail for the in-app logs view. Serving it from the app
 * keeps the developer on the page they are debugging instead of bouncing them
 * to the standalone splash on another port.
 */
export function createDevRuntimeLogsRoute(options: DevRuntimeRouteOptions = {}) {
  const resolveConfig = options.resolveConfig ?? (() => resolveDevRuntimeServerConfig())

  return async function GET(request: Request): Promise<Response> {
    const config = resolveConfig()
    if (!config.enabled) return NOT_FOUND()
    if (!isAcceptableOrigin(request)) return jsonError(403, 'forbidden', 'Origin is not allowed.')
    if (!isAuthorized(request, config)) return jsonError(403, 'forbidden', 'Invalid dev runtime token.')

    // A malformed cursor restarts the snapshot rather than failing the view.
    const raw = new URL(request.url).searchParams.get('cursor')
    const parsed = Number.parseInt(raw ?? '', 10)
    const snapshot = readDevRuntimeLogs(config, Number.isInteger(parsed) && parsed >= 0 ? parsed : 0)
    if (!snapshot) return jsonError(404, 'not_found', 'Runtime logs are not available.')

    return Response.json(snapshot, { headers: { 'cache-control': 'no-store' } })
  }
}
