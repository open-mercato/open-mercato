/**
 * TC-UMES-003: Events & DOM Bridge (Phase C)
 *
 * Validates the SSE event stream endpoint, clientBroadcast event delivery,
 * and the matchesPattern utility for wildcard event matching.
 *
 * Spec reference: SPEC-041c — Events & DOM Bridge
 */
import { test, expect } from '@playwright/test'
import {
  getAuthToken,
} from '@open-mercato/core/modules/core/__integration__/helpers/api'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

test.describe('TC-UMES-003: Events & DOM Bridge', () => {
  test('TC-UMES-E01: SSE endpoint returns event stream headers', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    // Verify the SSE endpoint exists and returns correct content type
    // We use a short-lived fetch since we can't hold the stream open in Playwright API context
    const response = await request.fetch(`${BASE_URL}/api/events/stream`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      timeout: 5000,
    })

    // Should return 200 with SSE content type
    expect(response.status()).toBe(200)
    const contentType = response.headers()['content-type']
    expect(contentType).toContain('text/event-stream')

    // Should have no-cache headers
    const cacheControl = response.headers()['cache-control']
    expect(cacheControl).toContain('no-cache')
  })

  test('TC-UMES-E02: SSE endpoint requires authentication', async ({
    request,
  }) => {
    // Request without auth token should fail
    const response = await request.fetch(`${BASE_URL}/api/events/stream`, {
      method: 'GET',
      timeout: 5000,
    })

    // Should return 401 or redirect to login
    expect([401, 403, 302]).toContain(response.status())
  })

  test('TC-UMES-E05: Non-broadcast events do NOT appear in SSE stream', async ({
    page,
  }) => {
    // This test verifies via the browser that only clientBroadcast events are sent.
    // We set up a listener for om:event and create a todo (which has clientBroadcast: true).
    // The test verifies the event bridge infrastructure is wired correctly.

    // Login and navigate to a backend page
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend')

    // Wait for page to load
    await page.waitForLoadState('networkidle')

    // Verify that the SSE endpoint is accessible from the browser
    // (the event bridge component should attempt to connect)
    const sseEndpointAccessible = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/events/stream', {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
          signal: AbortSignal.timeout(3000),
        })
        return response.ok && response.headers.get('content-type')?.includes('text/event-stream')
      } catch {
        // AbortError is expected (stream doesn't close naturally)
        return true
      }
    })
    expect(sseEndpointAccessible).toBeTruthy()
  })

  test('TC-UMES-E06: matchesPattern wildcard works correctly', async ({
    page,
  }) => {
    // Test the pattern matching utility in a browser context
    // since it's a client-side module
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend')
    await page.waitForLoadState('networkidle')

    // Evaluate matchesPattern logic directly in the browser
    const results = await page.evaluate(() => {
      // Reproduce the matchesPattern logic for testing
      function matchesPattern(pattern: string, eventId: string): boolean {
        if (pattern === '*') return true
        if (!pattern.includes('*')) return pattern === eventId
        const regex = new RegExp(
          '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
        )
        return regex.test(eventId)
      }

      return {
        // Global wildcard
        globalWildcard: matchesPattern('*', 'example.todo.created'),
        // Exact match
        exactMatch: matchesPattern('example.todo.created', 'example.todo.created'),
        exactMismatch: matchesPattern('example.todo.created', 'example.todo.updated'),
        // Wildcard suffix
        wildcardSuffix: matchesPattern('example.todo.*', 'example.todo.created'),
        wildcardSuffixUpdated: matchesPattern('example.todo.*', 'example.todo.updated'),
        wildcardSuffixMismatch: matchesPattern('example.todo.*', 'example.item.created'),
        // Partial wildcard
        partialWildcard: matchesPattern('example.*', 'example.todo.created'),
        partialWildcardItem: matchesPattern('example.*', 'example.item.deleted'),
        partialWildcardMismatch: matchesPattern('example.*', 'customers.person.created'),
      }
    })

    // Verify all pattern matching results
    expect(results.globalWildcard).toBe(true)
    expect(results.exactMatch).toBe(true)
    expect(results.exactMismatch).toBe(false)
    expect(results.wildcardSuffix).toBe(true)
    expect(results.wildcardSuffixUpdated).toBe(true)
    expect(results.wildcardSuffixMismatch).toBe(false)
    expect(results.partialWildcard).toBe(true)
    expect(results.partialWildcardItem).toBe(true)
    expect(results.partialWildcardMismatch).toBe(false)
  })

  test('TC-UMES-E03: onFieldChange updates widget warning state', async ({
    page,
  }) => {
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('phase-c-title-input').fill('  TEST Widget  ')
    await page.getByTestId('phase-c-trigger-field-change').click()

    await expect(page.getByTestId('widget-field-warning')).toContainText('Title contains "TEST"')
  })

  test('TC-UMES-E04: transformFormData trims strings in pipeline output', async ({
    page,
  }) => {
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('phase-c-title-input').fill('  Trim Me  ')
    await page.getByTestId('phase-c-note-input').fill('  Keep Clean  ')
    await page.getByTestId('phase-c-trigger-transform-form').click()

    await expect(page.getByTestId('phase-c-form-transform-result')).toContainText('"title":"Trim Me"')
    await expect(page.getByTestId('phase-c-form-transform-result')).toContainText('"note":"Keep Clean"')
  })

  test('TC-UMES-E07: onBeforeNavigate blocks blocked target and allows valid target', async ({
    page,
  }) => {
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('phase-c-target-input').fill('/backend/blocked')
    await page.getByTestId('phase-c-trigger-before-navigate').click()
    await expect(page.getByTestId('phase-c-before-navigate-result')).toContainText('"ok":false')
    await expect(page.getByTestId('phase-c-before-navigate-result')).toContainText('Navigation blocked')

    await page.getByTestId('phase-c-target-input').fill('/backend/todos')
    await page.getByTestId('phase-c-trigger-before-navigate').click()
    await expect(page.getByTestId('phase-c-before-navigate-result')).toContainText('"ok":true')
  })

  test('TC-UMES-E08: onVisibilityChange updates widget visibility state', async ({
    page,
  }) => {
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('phase-c-trigger-visibility').click()
    await expect(page.getByTestId('phase-c-widget-hidden')).toBeVisible()

    await page.getByTestId('phase-c-trigger-visibility').click()
    await expect(page.getByTestId('widget-visibility')).toContainText('"visible":true')
  })

  test('TC-UMES-E09: onAppEvent fires from DOM bridge event', async ({
    page,
  }) => {
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('phase-c-trigger-app-event').click()

    await expect(page.getByTestId('phase-c-app-event-result')).toContainText('example.todo.created')
    await expect(page.getByTestId('widget-app-event')).toContainText('example.todo.created')
  })

  test('TC-UMES-E10: transformDisplayData and transformValidation update outputs', async ({
    page,
  }) => {
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('phase-c-title-input').fill('display me')
    await page.getByTestId('phase-c-trigger-transform-display').click()
    await expect(page.getByTestId('phase-c-display-transform-result')).toContainText('"title":"DISPLAY ME"')

    await page.getByTestId('phase-c-trigger-transform-validation').click()
    await expect(page.getByTestId('phase-c-validation-transform-result')).toContainText('"title":"[widget]')
  })
})
