import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CHANNEL-SMTP-001 — SMTP provider registration, tenant scope and the
 * save-time safety refusals.
 *
 * `@open-mercato/channel-smtp` registers the `smtp` email `ChannelAdapter` with
 * `channelScope: 'tenant'`. That declaration is load-bearing: `sendSystemEmail`
 * only ever resolves tenant-wide rows, so a per-user SMTP channel would be
 * invisible to system email. The credential-connect routes are where both the
 * registration and the scope become observable:
 *
 *  - the **per-user** route short-circuits tenant-scoped providers with 403
 *    (`provider_is_tenant_scoped`) before touching credentials — 403 rather than
 *    404 (`no_adapter`) proves the adapter is registered, and it stops a
 *    non-admin minting a tenant-wide relay;
 *  - the **tenant** route runs the adapter's own `validateCredentials`, so the
 *    relay host is an operator-supplied SSRF surface that must be refused at
 *    save time, not merely at send time.
 *
 * Every case here fails validation, so no channel is created and there is
 * nothing to clean up. The relay round-trip (rendering, replyTo, attachments,
 * the raw-string recipient the hub test-send route passes, and partial
 * recipient rejection) is covered network-free in
 * `lib/__tests__/adapter.test.ts` and `lib/__tests__/validate-credentials.test.ts`.
 */
const TENANT_CONNECT = '/api/communication_channels/channels/connect/tenant-credentials'
const PER_USER_CONNECT = '/api/communication_channels/channels/connect/credentials'

const validRelay = {
  host: 'smtp.example.com',
  port: 587,
  tls: 'starttls',
  user: 'mailer',
  password: 'not-a-real-password',
  fromAddress: 'no-reply@example.com',
}

test.describe('TC-CHANNEL-SMTP-001: SMTP provider registration and safety refusals', () => {
  test('per-user connect with providerKey=smtp is refused (403, tenant-scoped)', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'POST', PER_USER_CONNECT, {
      token,
      data: {
        providerKey: 'smtp',
        displayName: 'SMTP — per-user (should be refused)',
        credentials: validRelay,
      },
    })

    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect(response.status(), 'authenticated request should not 401').not.toBe(401)
    expect(response.status()).toBe(403)
    const body = await readJsonSafe<{ code?: string }>(response)
    expect(body?.code).toBe('provider_is_tenant_scoped')
  })

  test('tenant connect with empty credentials reaches validateCredentials (422)', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'POST', TENANT_CONNECT, {
      token,
      data: { providerKey: 'smtp', displayName: 'SMTP — tenant connect', credentials: {} },
    })

    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    // Asserting 422 (not merely "not 404") proves the request authenticated AND
    // reached the adapter — a 401 auth misconfig would let this pass vacuously.
    expect(response.status(), 'authenticated request should not 401').not.toBe(401)
    expect(response.status(), 'registered adapter should reject empty credentials').toBe(422)
    const body = await readJsonSafe<{ fieldErrors?: Record<string, string> }>(response)
    expect(Object.keys(body?.fieldErrors ?? {})).toEqual(
      expect.arrayContaining(['host', 'user', 'password', 'fromAddress']),
    )
  })

  test('tenant connect refuses a loopback relay host before persisting anything', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'POST', TENANT_CONNECT, {
      token,
      data: {
        providerKey: 'smtp',
        displayName: 'SMTP — loopback relay (should be refused)',
        credentials: { ...validRelay, host: '127.0.0.1' },
      },
    })

    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect(response.status(), 'a loopback relay host must be refused at save time').toBe(422)
    const body = await readJsonSafe<{ fieldErrors?: Record<string, string> }>(response)
    expect(body?.fieldErrors?.host, 'the refusal must name the host field').toMatch(
      /private or loopback/i,
    )
  })

  test('tenant connect refuses cleartext transport without the operator opt-in', async ({
    request,
  }) => {
    const token = await getAuthToken(request)
    const response = await apiRequest(request, 'POST', TENANT_CONNECT, {
      token,
      data: {
        providerKey: 'smtp',
        displayName: 'SMTP — cleartext (should be refused)',
        credentials: { ...validRelay, tls: 'none', port: 25 },
      },
    })

    expect(response.status(), 'route should not 5xx').toBeLessThan(500)
    expect(response.status(), 'cleartext must be refused unless opted in').toBe(422)
    const body = await readJsonSafe<{ fieldErrors?: Record<string, string> }>(response)
    expect(body?.fieldErrors?.tls).toMatch(/OM_CHANNEL_SMTP_ALLOW_INSECURE_TRANSPORT/)
  })

  test('both connect routes reject unauthenticated callers', async ({ request }) => {
    for (const url of [PER_USER_CONNECT, TENANT_CONNECT]) {
      const response = await apiRequest(request, 'POST', url, {
        // Intentionally empty token — this asserts the 401 unauth path.
        token: '',
        data: { providerKey: 'smtp', displayName: 'SMTP', credentials: validRelay },
      })
      expect(response.status(), `${url} must require authentication`).toBe(401)
    }
  })
})
