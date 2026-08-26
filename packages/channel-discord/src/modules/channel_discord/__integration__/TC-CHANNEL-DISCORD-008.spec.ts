import { expect, test } from '@playwright/test'
import { createDiscordSigner, freshTimestamp, interactionsUrl, pingInteractionBody } from './helpers/discordSignature'

/**
 * TC-CHANNEL-DISCORD-008 — tenant isolation on the shared interactions endpoint.
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * One unauthenticated URL serves every tenant's Discord application, so the
 * candidate fan-out is the isolation boundary: a request is pinned to the single
 * channel whose stored public key verifies it, and a request that verifies
 * against none must be indistinguishable from any other rejection.
 *
 * This spec drives the real route with two independent applications' keys and
 * asserts the endpoint is a black box: identical status, identical body, no
 * channel id, tenant id, organization id or count anywhere in the response, and
 * no timing-visible difference in shape between them. That is the observable
 * half of the isolation contract on an instance with no connected Discord
 * channel — the positive half (a signature pinning exactly its own tenant, and
 * never another's) requires two live bot tokens and is unit-tested as
 * "per-tenant public-key pinning" in `lib/__tests__/interactions-handler.test.ts`.
 */
const LEAKY_KEYS = ['channelId', 'tenantId', 'organizationId', 'candidates', 'channels']

test.describe('TC-CHANNEL-DISCORD-008: interactions endpoint leaks no tenant state', () => {
  test('two different applications get byte-identical rejections', async ({ request }) => {
    const bodies: unknown[] = []
    const statuses: number[] = []

    for (const label of ['tenant-a', 'tenant-b']) {
      const signer = createDiscordSigner()
      const timestamp = freshTimestamp()
      const body = JSON.stringify({ ...JSON.parse(pingInteractionBody()), application_id: label })
      const response = await request.post(interactionsUrl(), {
        headers: {
          'content-type': 'application/json',
          'x-signature-ed25519': signer.sign(timestamp, body),
          'x-signature-timestamp': timestamp,
        },
        data: body,
      })
      statuses.push(response.status())
      bodies.push(await response.json())
    }

    expect(statuses, 'both applications must be rejected the same way').toEqual([401, 401])
    expect(
      bodies[0],
      'the rejection body must not vary with the caller — that variance would be a tenant oracle',
    ).toEqual(bodies[1])
  })

  test('a rejection body carries no tenant-scoped identifiers', async ({ request }) => {
    const signer = createDiscordSigner()
    const timestamp = freshTimestamp()
    const body = pingInteractionBody()
    const response = await request.post(interactionsUrl(), {
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': signer.sign(timestamp, body),
        'x-signature-timestamp': timestamp,
      },
      data: body,
    })

    expect(response.status()).toBe(401)
    const raw = await response.text()
    for (const key of LEAKY_KEYS) {
      expect(raw, `an unverified caller must not learn "${key}"`).not.toContain(key)
    }
    expect(
      Object.keys((await response.json()) as Record<string, unknown>),
      'the rejection body is exactly one error code',
    ).toEqual(['error'])
  })
})
