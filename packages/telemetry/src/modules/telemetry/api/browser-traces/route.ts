import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import {
  resolveBrowserTelemetryConfig,
  resolveCollectorHeaders,
  resolveCollectorTracesUrl,
} from '../../../../browser/server'

const logger = createLogger('telemetry').child({ component: 'browser-traces' })

export const metadata = {
  // Sending a span is not a privileged action — every authenticated backoffice user may do it, so
  // no feature grant. `requireAuth: true` is what keeps an unauthenticated span-ingest endpoint off
  // a public host.
  //
  // Deliberately NO dispatcher-level `rateLimit`. That limiter keys on the client IP and falls back
  // to a single `'global'` bucket whenever `RATE_LIMIT_TRUST_PROXY_DEPTH` is 0 (the default), so one
  // flat budget would be shared by every browser in the deployment — and it answers `429`, which is
  // in the OTLP exporter's retryable set (`429 || 502 || 503 || 504`). That combination would make
  // a handful of busy tabs trigger the retry storm the handler below exists to prevent, under
  // normal load rather than during an outage. The budget is enforced per authenticated user inside
  // the handler instead, where it can answer with a non-retryable status.
  POST: {
    requireAuth: true,
  },
}

/**
 * Per-user ingest budget, sized from the export cadence rather than picked round: the
 * `BatchSpanProcessor` in `BrowserTelemetry.tsx` uses `scheduledDelayMillis: 3_000`, i.e. at most
 * 20 export requests per minute per open tab. 400/min therefore covers ~20 concurrent backoffice
 * tabs for one user before anything is shed, and a user who exceeds it can only ever starve
 * themselves — never the rest of the deployment, which the shared IP bucket could.
 */
const INGEST_BUDGET: RateLimitConfig = {
  points: 400,
  duration: 60,
  keyPrefix: 'telemetry_browser_traces',
}

export const openApi = {
  tags: ['Telemetry'],
  summary: 'Same-origin OTLP/HTTP trace ingest for browser RUM spans — forwards to the collector',
}

/** Batched browser exports are a few KB; 1 MB is a generous ceiling that still refuses abuse. */
const MAX_BODY_BYTES = 1_000_000
/** The collector is expected to be one hop away (in-cluster or a tunnel). */
const COLLECTOR_TIMEOUT_MS = 5_000

/**
 * Proxies a browser OTLP/HTTP trace payload to the environment's collector, adding the
 * credential server-side.
 *
 * Deliberately fire-and-forget: a telemetry pipeline must never be able to degrade the app it
 * measures, so every failure path returns a success-ish status and is logged instead. Dropped spans
 * are cheaper than a retry storm from every open browser tab.
 *
 * That is why a collector failure answers 202 rather than 502: 502 is in the OTLP exporter's
 * retryable set (`429 || 502 || 503 || 504`), so a collector outage would make every open tab
 * retry each batch with backoff — the exact amplification this contract rules out — and surface a
 * failed request in the user's devtools on every attempt. The outage is observable in the server
 * log instead, where it belongs.
 *
 * Raw `fetch` is correct here (the AGENTS.md rule targets app-to-own-API calls that have a framework
 * primitive) — this is a server-to-collector hop over plain OTLP/HTTP with no DI-provided client.
 */
export async function POST(req: Request, ctx?: { auth?: AuthContext | null }): Promise<Response> {
  // Refuse on the declared size BEFORE anything else: App Router route handlers have no default
  // body limit, so reading first would let an authenticated client force a large allocation. A
  // caller can lie or omit content-length, hence the second check inside the read — but the honest
  // path (the OTel exporter always sets it) never allocates. Checked even while disabled so the
  // size cap is an unconditional contract of the endpoint.
  const declaredLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 })
  }

  // Not configured / disabled for this environment: accept and drop, so a stale client that still
  // has the SDK loaded doesn't retry or surface errors.
  if (!resolveBrowserTelemetryConfig({ cookieHeader: req.headers.get('cookie') })) {
    return new Response(null, { status: 204 })
  }

  // Over the per-user budget: drop the batch with the same non-retryable accept-and-drop status a
  // disabled environment uses. A `429` here would be read as retryable by the exporter and turn a
  // single looping tab into a backoff storm.
  if (await isOverIngestBudget(ctx?.auth?.sub)) return new Response(null, { status: 204 })

  const target = resolveCollectorTracesUrl()
  if (!target) return new Response(null, { status: 204 })

  const body = await readCappedBody(req)
  if (body === null) return new Response(null, { status: 413 })
  if (body.byteLength === 0) return new Response(null, { status: 202 })

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        // Credential and operator headers first, so the forwarded content headers below always
        // win: an operator whose OTEL_EXPORTER_OTLP_HEADERS happens to carry a `content-type` must
        // not silently relabel the body the browser actually sent.
        ...resolveCollectorHeaders(),
        // The browser exporter posts JSON; keep whatever it declared so a future switch to the
        // protobuf exporter needs no change here.
        'content-type': req.headers.get('content-type') ?? 'application/json',
        // Forward compression verbatim — dropping it would hand the collector a gzip blob
        // labelled as plain JSON the moment the exporter enables compression.
        ...(req.headers.get('content-encoding')
          ? { 'content-encoding': req.headers.get('content-encoding') as string }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      logger.warn('telemetry.browser.export.rejected', {
        status: res.status,
        bytes: body.byteLength,
      })
      return new Response(null, { status: 202 })
    }
  } catch (err) {
    logger.warn('telemetry.browser.export.failed', {
      error: err instanceof Error ? err.message : String(err),
      bytes: body.byteLength,
    })
    return new Response(null, { status: 202 })
  }

  return new Response(null, { status: 202 })
}

/**
 * Consumes one point of the authenticated user's ingest budget and reports whether the batch
 * should be shed.
 *
 * Fails open in every degraded case — no user id, no limiter registered, a limiter whose backing
 * store is unreachable, or a throw on the way there. An unenforced telemetry budget is strictly
 * better than a telemetry endpoint that starts refusing traffic because its limiter is sick.
 */
async function isOverIngestBudget(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  try {
    const container = await createRequestContainer()
    const limiter = tryResolve<RateLimiterService>(container, 'rateLimiterService')
    if (!limiter) return false
    const result = await limiter.consume(userId, INGEST_BUDGET)
    if (result.allowed || result.degraded) return false
    logger.warn('telemetry.browser.export.throttled', {
      userId,
      budgetPerMinute: INGEST_BUDGET.points,
    })
    return true
  } catch {
    return false
  }
}

function tryResolve<T>(container: { resolve: (name: string) => unknown }, name: string): T | null {
  try {
    return (container.resolve(name) as T) ?? null
  } catch {
    return null
  }
}

/**
 * Reads the body but abandons it the moment it exceeds the cap, so a client that omits or
 * understates `content-length` still cannot make us buffer an arbitrary payload. Returns `null`
 * when the cap is breached.
 */
async function readCappedBody(req: Request): Promise<ArrayBuffer | null> {
  if (!req.body) return new ArrayBuffer(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  // `.buffer` is exactly the allocation above, so the cast is sound and keeps `fetch` happy
  // (a generic Uint8Array is not assignable to BodyInit under this TS lib).
  return out.buffer as ArrayBuffer
}
