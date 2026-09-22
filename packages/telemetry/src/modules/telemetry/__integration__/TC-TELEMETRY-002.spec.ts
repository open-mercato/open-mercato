import { expect, test, type Page, type Request as PlaywrightRequest } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

/**
 * TC-TELEMETRY-002: browser RUM in a real browser.
 *
 * TC-TELEMETRY-001 drives the proxy route with `request.post` — a useful API contract test that
 * never opens a page. This spec covers what only a browser can: that the SDK actually boots, that
 * the `__omOriginalFetch` patch dance leaves both fetch paths working (a recursion here hangs every
 * API call in the backoffice), that batches reach the proxy, and — the mirror image — that a
 * default environment ships none of it.
 *
 * Browser RUM is normally an environment-wide env switch, which a spec cannot flip for one page.
 * The integration environment therefore sets `OM_TEST_BROWSER_TELEMETRY_MODE=opt-in` on top of
 * `OM_TEST_MODE=1`, and only then does the server honour an `om_test_browser_telemetry=on` cookie.
 * Both variables are absent in production. Same escape hatch the auth rate limiter already uses.
 *
 * No collector is configured here, so the proxy answers 204 (accept-and-drop) rather than 202 —
 * which is why the span assertions read the batch the *browser posted* instead of anything a sink
 * received. That is the stronger assertion anyway: it is the browser's output under test.
 */

const TRACES_PATH = '/api/telemetry/browser-traces'
const OPT_IN_COOKIE = 'om_test_browser_telemetry'

type IngestRecord = { status: number; body: string }

/** Records every proxy call the page makes, with the payload the exporter actually produced. */
function recordIngest(page: Page): IngestRecord[] {
  const records: IngestRecord[] = []
  page.on('response', async (response) => {
    if (!response.url().includes(TRACES_PATH)) return
    const request: PlaywrightRequest = response.request()
    if (request.method() !== 'POST') return
    records.push({ status: response.status(), body: request.postData() ?? '' })
  })
  return records
}

/** The web SDK registers itself on this global symbol; its presence is the "SDK booted" signal. */
async function otelApiIsRegistered(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Object.getOwnPropertySymbols(globalThis).some((symbol) => symbol.toString().includes('opentelemetry.js.api')),
  )
}

test.describe('TC-TELEMETRY-002: browser RUM runtime', () => {
  test('exports document-load and fetch spans without breaking either fetch path', async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? 'http://localhost:3000').origin
    await page.context().addCookies([{ name: OPT_IN_COOKIE, value: 'on', url: origin }])
    const ingest = recordIngest(page)

    await login(page, 'admin')
    await page.goto('/backend')
    await expect.poll(() => otelApiIsRegistered(page), {
      message: 'the web SDK must boot once the server hands the layout a non-null config',
      timeout: 15_000,
    }).toBe(true)

    // The patch dance, asserted where it actually runs. `@open-mercato/ui`'s api utils stash the
    // pristine fetch on `__omOriginalFetch` and put a wrapper on `window.fetch`; the SDK has to
    // instrument the stash rather than the wrapper, or direct `apiFetch` callers (DataTable,
    // CrudForm, react-query) produce no spans at all.
    const patchState = await page.evaluate(() => {
      const w = window as Window & { __omOriginalFetch?: typeof window.fetch }
      return {
        hasStash: typeof w.__omOriginalFetch === 'function',
        // Identical would mean the wrapper was handed back to itself — an infinite recursion on
        // the first request through `apiFetch`.
        stashIsWrapper: w.__omOriginalFetch === window.fetch,
      }
    })
    expect(patchState.hasStash, '@open-mercato/ui installs the fetch wrapper on every backoffice page').toBe(true)
    expect(patchState.stashIsWrapper, 'instrumenting the wrapper instead of the native fetch recurses forever').toBe(false)

    // Both paths must still answer. A hang here IS the recursion bug, hence the tight budget.
    const replay = await page.evaluate(async () => {
      const w = window as Window & { __omOriginalFetch?: typeof window.fetch }
      const withTimeout = async (call: Promise<Response>) => {
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000))
        return (await Promise.race([call, timeout])).status
      }
      return {
        viaWindow: await withTimeout(window.fetch('/api/auth/me')),
        viaStash: await withTimeout(w.__omOriginalFetch!('/api/auth/me')),
      }
    })
    expect(replay.viaWindow, 'window.fetch still reaches the API through the framework wrapper').toBe(200)
    expect(replay.viaStash, 'the instrumented native fetch still reaches the API').toBe(200)

    // A DataTable page proves `apiFetch` itself survived the swap end to end.
    await page.goto('/backend/customers/people')
    await expect(page.getByRole('table').or(page.getByRole('grid')).first()).toBeVisible({ timeout: 30_000 })

    // Exports are batched on a 3s delay, and a flush is forced when the page is hidden.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => ingest.length, {
      message: 'the exporter must post its batches to the same-origin proxy',
      timeout: 20_000,
    }).toBeGreaterThan(0)

    // Every answer must be one the OTLP exporter does NOT retry (429/502/503/504 would storm).
    for (const record of ingest) {
      expect([202, 204], `unexpected ingest status ${record.status}`).toContain(record.status)
    }

    const spanNames = ingest.flatMap((record) => {
      try {
        const payload = JSON.parse(record.body) as {
          resourceSpans?: Array<{
            resource?: { attributes?: Array<{ key: string; value?: { stringValue?: string } }> }
            scopeSpans?: Array<{ spans?: Array<{ name: string }> }>
          }>
        }
        for (const resourceSpan of payload.resourceSpans ?? []) {
          const serviceName = resourceSpan.resource?.attributes?.find((a) => a.key === 'service.name')
          expect(
            serviceName?.value?.stringValue,
            'browser spans must carry their own service name so they sort apart from server spans',
          ).toMatch(/-browser$/)
        }
        return (payload.resourceSpans ?? []).flatMap((r) => (r.scopeSpans ?? []).flatMap((s) => s.spans ?? [])).map((s) => s.name)
      } catch {
        return []
      }
    })
    expect(spanNames, 'document-load instrumentation must produce the navigation span').toContain('documentLoad')
    expect(spanNames, 'document-load instrumentation must produce the document fetch span').toContain('documentFetch')
  })

  test('ships nothing at all without the opt-in — the default path must cost a disabled app zero bytes', async ({ page }) => {
    // No cookie: this is the shipped default, and the mirror image of the case above. It is the
    // assertion that protects the "zero client-bundle cost while off" promise from regressing.
    const ingest = recordIngest(page)

    await login(page, 'admin')
    await page.goto('/backend')
    await page.goto('/backend/customers/people')
    await expect(page.getByRole('table').or(page.getByRole('grid')).first()).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(5_000)

    expect(await otelApiIsRegistered(page), 'the web SDK chunk must never be requested while RUM is off').toBe(false)
    expect(ingest, 'a disabled app must not post a single batch').toHaveLength(0)
  })
})
