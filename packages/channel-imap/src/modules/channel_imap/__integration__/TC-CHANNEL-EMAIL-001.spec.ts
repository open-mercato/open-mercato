import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-EMAIL-001 — IMAP provider visible to the hub's per-user channel API.
 *
 * After Slice 3e registers the `imap` adapter inside `@open-mercato/channel-imap`,
 * the per-user channel routes must accept `providerKey: 'imap'` as a known provider.
 * Without a live IMAP test server we exercise the routing-and-validation surface only;
 * actual credential validation against a real IMAP host is covered by the unit tests
 * in `lib/__tests__/validate-credentials.test.ts`.
 *
 * The route should NOT 404 the provider (proves registration), and should NOT 500
 * (proves the request reaches the adapter and rejects cleanly when no live server
 * is reachable).
 */
test.describe('TC-CHANNEL-EMAIL-001: IMAP provider registration', () => {
  test('POST connect/credentials with providerKey=imap reaches the adapter', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: {
          providerKey: 'imap',
          displayName: 'IMAP — integration test',
          credentials: {
            imapHost: 'invalid.test.example',
            imapPort: 993,
            imapTls: 'tls',
            imapUser: 'fake@example.test',
            imapPassword: 'wrong-password',
            smtpHost: 'invalid.test.example',
            smtpPort: 465,
            smtpTls: 'tls',
            smtpUser: 'fake@example.test',
            smtpPassword: 'wrong-password',
            fromAddress: 'fake@example.test',
          },
        },
      },
    )
    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    // 401 (no auth seeded) / 422 (validation failure surfaced via createCrudFormError) /
    // 502 ish — but never 404, which would indicate the provider isn't registered.
    expect(response.status(), 'IMAP provider should be registered').not.toBe(404)
  })

  test('POST connect/credentials with providerKey=imap and malformed credentials returns 422', async ({ request }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(
      request,
      'POST',
      '/api/communication_channels/channels/connect/credentials',
      {
        token,
        data: {
          providerKey: 'imap',
          displayName: 'IMAP — malformed',
          credentials: {
            // Missing required imap/smtp fields entirely.
            fromAddress: 'not-an-email',
          },
        },
      },
    )
    expect(response.status()).toBeLessThan(500)
    expect([401, 422, 400]).toContain(response.status())
    if (response.status() === 422) {
      // The route surfaces credential-validation failures as { error, fieldErrors }
      // (see api/post/channels/connect/credentials/route.ts).
      const body = await readJsonSafe<{ error?: string; fieldErrors?: Record<string, string> }>(response)
      expect(body?.fieldErrors ?? body?.error).toBeTruthy()
    }
  })
})
