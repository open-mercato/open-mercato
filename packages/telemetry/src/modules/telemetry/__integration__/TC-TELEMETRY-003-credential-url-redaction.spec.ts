import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

type ExportedSpan = {
  name: string
  attributes?: Array<{ key: string; value?: { stringValue?: string } }>
}

type TraceBatch = {
  resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: ExportedSpan[] }> }>
}

for (const locale of ['en', 'pl']) {
  test(`TC-TELEMETRY-003: ${locale} browser exports redact credential URLs and preserve UUIDs`, async ({ page, baseURL }, testInfo) => {
    test.skip(process.env.OM_TEST_BROWSER_TELEMETRY_MODE !== 'opt-in', 'Browser telemetry opt-in is not configured.')
    const origin = new URL(baseURL ?? 'http://localhost:3000').origin
    await page.context().addCookies([
      { name: 'om_test_browser_telemetry', value: 'on', url: origin },
      { name: 'om_locale', value: locale, url: origin },
    ])
    if (locale === 'pl') await page.setViewportSize({ width: 390, height: 844 })
    const batches: string[] = []
    const apiUrls: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/telemetry/browser-traces') {
        batches.push(request.postData() ?? '')
      }
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (response.status() === 200 && response.request().method() === 'GET' && url.pathname.startsWith('/api/')) {
        apiUrls.push(response.url())
      }
    })
    await login(page, 'admin')
    await page.goto('/backend')
    await expect.poll(() => apiUrls.length).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => Object.getOwnPropertySymbols(globalThis)
      .some((symbol) => symbol.toString().includes('opentelemetry.js.api')))).toBe(true)

    const sentinels = ['synthetic-user', 'synthetic-password', 'synthetic-oauth-code', 'synthetic-query-value', 's'.repeat(64)]
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    const statuses = await page.evaluate(async ({ replayUrl, sentinels, uuid }) => {
      type BrowserSpan = { setAttribute: (key: string, value: string) => void; end: () => void }
      type RuntimeRegistry = { trace?: { getTracer: (name: string) => { startSpan: (name: string) => BrowserSpan } } }
      const symbol = Object.getOwnPropertySymbols(globalThis).find((candidate) => candidate.toString().includes('opentelemetry.js.api'))
      if (!symbol) throw new Error('[internal] Browser trace runtime is unavailable')
      const registry = (globalThis as unknown as Record<symbol, RuntimeRegistry>)[symbol]
      const tracer = registry.trace?.getTracer('telemetry-url-regression')
      if (!tracer) throw new Error('[internal] Browser tracer is unavailable')
      const instrumentedFetch = (window as Window & { __omOriginalFetch?: typeof window.fetch }).__omOriginalFetch
      if (!instrumentedFetch) throw new Error('[internal] Instrumented API fetch is unavailable')
      const url = new URL(replayUrl)
      url.searchParams.set('token', sentinels[4])
      url.searchParams.set('code', sentinels[2])
      url.searchParams.set('search', sentinels[3])
      const statuses: number[] = []
      for (let attempt = 0; attempt < 10; attempt += 1) {
        statuses.push((await window.fetch(url.href)).status)
        statuses.push((await instrumentedFetch(url.href)).status)
      }
      for (const target of [
        `https://${sentinels[0]}:${sentinels[1]}@example.test/reset/${sentinels[4]}?code=${sentinels[2]}`,
        `//${sentinels[0]}:${sentinels[1]}@[2001:db8::1]/portal?token=${sentinels[4]}`,
        `/reset/${sentinels[4]}?token=${sentinels[4]}`,
        `/records/${uuid}?search=${sentinels[3]}`,
      ]) {
        const name = `fetch GET ${target}`
        const span = tracer.startSpan(name)
        span.setAttribute('http.url', target)
        span.setAttribute('url.full', target)
        span.setAttribute('next.span_name', name)
        span.end()
      }
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      return statuses
    }, { replayUrl: apiUrls[0], sentinels, uuid })
    expect(statuses).toHaveLength(20)
    expect(statuses.every((status) => status === 200)).toBe(true)
    await expect.poll(() => batches.flatMap((body) => {
      const batch = JSON.parse(body) as TraceBatch
      return (batch.resourceSpans ?? []).flatMap((resource) => (resource.scopeSpans ?? []).flatMap((scope) => scope.spans ?? []))
    }).filter((span) => span.name.startsWith('fetch GET ')).length).toBeGreaterThanOrEqual(4)
    const payload = batches.join('\n')
    for (const sentinel of sentinels) expect(payload).not.toContain(sentinel)
    expect(payload).toContain(uuid)
    expect(payload).toContain('[redacted]')
    expect(payload).toContain('next.span_name')
    await page.screenshot({ path: testInfo.outputPath(`telemetry-${locale}.png`), fullPage: true })
    await testInfo.attach(`telemetry-${locale}`, { path: testInfo.outputPath(`telemetry-${locale}.png`), contentType: 'image/png' })
  })
}
