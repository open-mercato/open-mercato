'use client'

/**
 * Browser RUM. Boots the OpenTelemetry web SDK once per page load and exports
 * spans through the same-origin proxy (`/api/telemetry/browser-traces`).
 *
 * Why this exists: server traces can only prove where the time *isn't*. A page
 * can render an API answer in 50 ms yet leave the user waiting seconds before
 * the request is even sent — bundle download, hydration, or a click handler
 * stuck behind a re-render are all invisible to every server span.
 *
 * Two rules this file lives by:
 *  - **The SDK is `import()`ed, never statically imported.** RUM often
 *    diagnoses routes suspected to be bundle-bound; shipping the SDK in the
 *    critical path would be self-defeating. Document-load timings survive the
 *    late start because they are read back from the PerformanceTimeline.
 *  - **It can never break the app.** Every failure is swallowed. No
 *    user-facing surface, no retry.
 *
 * This file, `config.ts`, and `propagator.ts` are the only parts of
 * `@open-mercato/telemetry` a client bundle may reach (via the `/browser` entry).
 * None of them may import the server facade (`node:async_hooks`) or the
 * env-reading `browser/server.ts`; the two wirings are independent and meet only
 * at the collector.
 */

import * as React from 'react'
import type { BrowserTelemetryConfig } from './config'
import { createBackupHeaderPropagator } from './propagator'

/** Module-level so React StrictMode's double-invoke (and any remount) cannot start a second SDK. */
let bootstrapped = false

/**
 * Test seam. Production has exactly one bootstrap per page load, so nothing else
 * may call this — a second bootstrap would double every span.
 */
export function resetBrowserTelemetryBootstrap(): void {
  bootstrapped = false
}

async function startBrowserTelemetry(config: BrowserTelemetryConfig): Promise<void> {
  const [
    { WebTracerProvider },
    { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler },
    { OTLPTraceExporter },
    { resourceFromAttributes },
    { registerInstrumentations },
    { DocumentLoadInstrumentation },
    { FetchInstrumentation },
    { UserInteractionInstrumentation },
    { W3CTraceContextPropagator },
    { defaultTextMapSetter },
  ] = await Promise.all([
    import('@opentelemetry/sdk-trace-web'),
    import('@opentelemetry/sdk-trace-base'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/instrumentation'),
    import('@opentelemetry/instrumentation-document-load'),
    import('@opentelemetry/instrumentation-fetch'),
    import('@opentelemetry/instrumentation-user-interaction'),
    import('@opentelemetry/core'),
    import('@opentelemetry/api'),
  ])

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      'service.name': config.serviceName,
      // Plain attribute name (not the semconv `deployment.environment.name`) so browser spans sort
      // alongside the server spans, which use OTEL_RESOURCE_ATTRIBUTES.
      ...(config.environment ? { 'deployment.environment': config.environment } : {}),
      'user_agent.original': navigator.userAgent,
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.samplingRatio),
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: config.endpoint }),
        // The interesting spans arrive in bursts around a navigation; a short delay keeps them
        // close together in the trace view without one request per span.
        { scheduledDelayMillis: 3_000, maxQueueSize: 512 },
      ),
    ],
  })

  // Standard `traceparent` plus the backup copy the server continues once
  // TELEMETRY_TRUST_INBOUND_TRACE is on — see `propagator.ts` for why that flag is the supported
  // way to get one end-to-end trace, and what happens without it.
  provider.register({
    propagator: createBackupHeaderPropagator(new W3CTraceContextPropagator(), defaultTextMapSetter),
  })

  // ── The fetch-patch dance (do not simplify) ────────────────────────────────────────────────
  // `@open-mercato/ui`'s api utils install a global wrapper at module load so that stray
  // `fetch()` calls still get the 401 session-refresh / 403 banner behaviour:
  //     w.__omOriginalFetch = window.fetch            // pristine native fetch
  //     window.fetch = (i, x) => apiFetch(i, x)
  // and `apiFetch` then calls `__omOriginalFetch` to avoid recursing into itself. Since the whole
  // backoffice (DataTable, CrudForm, react-query queryFns…) imports `apiFetch` DIRECTLY, those
  // calls never touch `window.fetch` — so instrumenting `window.fetch` alone yields document-load
  // spans and almost no API spans, which is worse than none at all: it looks like it works.
  //
  // Fix: let the instrumentation patch the *native* fetch, then hand the patched version back as
  // the stash. Both paths end up instrumented exactly once:
  //     apiFetch          → __omOriginalFetch = OTel(native)         ✓
  //     window.fetch      → apiFetch wrapper → OTel(native)          ✓
  // Assigning `__omOriginalFetch = window.fetch` instead would loop forever
  // (apiFetch → wrapper → apiFetch → …). The swap is synchronous — `registerInstrumentations`
  // calls `enable()` inline — so no caller can observe the intermediate state.
  const patchTarget = window as Window & { __omOriginalFetch?: typeof window.fetch }
  const frameworkFetch = patchTarget.__omOriginalFetch ? window.fetch : null
  if (frameworkFetch && patchTarget.__omOriginalFetch) {
    window.fetch = patchTarget.__omOriginalFetch
  }

  // `finally`, not a plain sequence: the instrumentation constructors below are evaluated inside
  // this window, and a throw from any of them (SDK version skew, a browser missing an API an
  // instrumentation touches) would otherwise leave `window.fetch` as the raw native fetch stashed
  // above. `apiFetch` would keep working — it reads `__omOriginalFetch` — but every stray
  // `window.fetch(...)` would silently bypass the framework wrapper's 401 session-refresh and 403
  // banner behaviour for the rest of the page's life. This is the one path where the file's
  // "every failure is swallowed" rule would leave global state degraded.
  try {
    registerInstrumentations({
      tracerProvider: provider,
      instrumentations: [
        // Navigation + resource timings: chunk download vs. parse vs. hydrate.
        new DocumentLoadInstrumentation(),
        // The client-side START of each API call — the number the server can never see.
        new FetchInstrumentation({
          // Never instrument our own export, or each batch would generate the next one.
          ignoreUrls: [new RegExp(escapeRegExp(config.endpoint))],
          clearTimingResources: true,
        }),
        // Ties a fetch to the click that caused it (tab click vs. remount).
        new UserInteractionInstrumentation(),
      ],
    })
  } finally {
    if (frameworkFetch) {
      // On the success path `window.fetch` is OTel's patched native fetch; on the throw path it is
      // the pristine native one. Either way this restores the framework wrapper on top of whatever
      // the stash should now hold, so the pre-swap contract holds in both.
      patchTarget.__omOriginalFetch = window.fetch
      window.fetch = frameworkFetch
    }
  }

  // BatchSpanProcessor would otherwise drop whatever is still queued when the user navigates away
  // — which is exactly when a slow page gets abandoned, i.e. the spans we most want.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void provider.forceFlush().catch(() => {})
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Renders nothing. `config` is resolved server-side (`resolveBrowserTelemetryConfig()`) and is
 * `null` whenever browser telemetry is disabled for the environment — which is the default, and
 * keeps the SDK chunk from ever being requested.
 */
export function BrowserTelemetry({ config }: { config: BrowserTelemetryConfig | null }) {
  React.useEffect(() => {
    if (!config || bootstrapped) return
    bootstrapped = true
    void startBrowserTelemetry(config).catch(() => {
      // Telemetry must never degrade the app it measures: stay silent and stay down (no retry).
    })
  }, [config])

  return null
}
