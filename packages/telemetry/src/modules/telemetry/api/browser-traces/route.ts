import { createLogger } from '@open-mercato/shared/lib/logger'
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
  POST: {
    requireAuth: true,
    rateLimit: { points: 120, duration: 60, keyPrefix: 'telemetry_browser_traces' },
  },
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
 * Raw `fetch` is correct here (the AGENTS.md rule targets app-to-own-API calls that have a framework
 * primitive) — this is a server-to-collector hop over plain OTLP/HTTP with no DI-provided client.
 */
export async function POST(req: Request): Promise<Response> {
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
  if (!resolveBrowserTelemetryConfig()) return new Response(null, { status: 204 })

  const target = resolveCollectorTracesUrl()
  if (!target) return new Response(null, { status: 204 })

  const body = await readCappedBody(req)
  if (body === null) return new Response(null, { status: 413 })
  if (body.byteLength === 0) return new Response(null, { status: 202 })

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        // The browser exporter posts JSON; keep whatever it declared so a future switch to the
        // protobuf exporter needs no change here.
        'content-type': req.headers.get('content-type') ?? 'application/json',
        // Forward compression verbatim — dropping it would hand the collector a gzip blob
        // labelled as plain JSON the moment the exporter enables compression.
        ...(req.headers.get('content-encoding')
          ? { 'content-encoding': req.headers.get('content-encoding') as string }
          : {}),
        ...resolveCollectorHeaders(),
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
      return new Response(null, { status: 502 })
    }
  } catch (err) {
    logger.warn('telemetry.browser.export.failed', {
      error: err instanceof Error ? err.message : String(err),
      bytes: body.byteLength,
    })
    return new Response(null, { status: 502 })
  }

  return new Response(null, { status: 202 })
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
