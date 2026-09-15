import { expect, test } from '@playwright/test'
import {
  createDiscordSigner,
  freshTimestamp,
  interactionsUrl,
  pingInteractionBody,
  slashCommandInteractionBody,
  staleTimestamp,
} from './helpers/discordSignature'

/**
 * TC-CHANNEL-DISCORD-005 — Interactions endpoint security (fail-closed).
 * Source: .ai/specs/2026-06-19-discord-communication-channel-integration.md
 *
 * `POST /api/channel_discord/interactions` is deliberately unauthenticated at
 * the platform layer — the Ed25519 signature IS the auth. This spec drives the
 * REAL route (DB fan-out over candidate channels included) and asserts it is
 * fail-closed on every rejection path:
 *
 *  - no signature headers at all           → 401
 *  - a syntactically valid but wrong signature → 401
 *  - a body altered after signing          → 401
 *  - a signed timestamp outside the replay window → 401 `stale_timestamp`,
 *    which also proves the freshness guard runs BEFORE the per-candidate
 *    verify fan-out (constant cost for a replayed capture)
 *  - a fully-formed slash command signed by an unknown key → 401, never a
 *    deferred ack: since #4663 a deferred ack promises a hub write and a
 *    follow-up, so it must stay strictly behind the signature gate
 *
 * A rejection must never leak which tenants have Discord channels, so the
 * response body is asserted to carry nothing but the error code.
 *
 * The success paths — PONG (`{ type: 1 }`) and the dispatched slash command /
 * component (`{ type: 5 }` plus the hub job and the Discord follow-up) — need a
 * channel whose stored public key matches the signer; connecting one requires a
 * live bot token. That half stays unit-tested, in
 * `lib/__tests__/interactions-handler.test.ts`,
 * `lib/__tests__/interactions-dispatch.test.ts`,
 * `lib/__tests__/capabilities.test.ts` (the capability parity check) and
 * `workers/__tests__/discord-interactions.test.ts`.
 */
test.describe('TC-CHANNEL-DISCORD-005: interactions endpoint is fail-closed', () => {
  test('an unsigned interaction is rejected', async ({ request }) => {
    const bare = await request.post(interactionsUrl(), {
      headers: { 'content-type': 'application/json' },
      data: pingInteractionBody(),
    })
    expect(bare.status(), 'a request with no signature headers must be rejected').toBe(401)
    expect(
      await bare.json(),
      'with no signed timestamp the freshness guard answers first — it runs before the signature fan-out',
    ).toEqual({ error: 'stale_timestamp' })

    const timestamped = await request.post(interactionsUrl(), {
      headers: { 'content-type': 'application/json', 'x-signature-timestamp': freshTimestamp() },
      data: pingInteractionBody(),
    })
    expect(timestamped.status(), 'a fresh timestamp with no signature must still be rejected').toBe(401)
    expect(await timestamped.json(), 'the rejection must not leak candidate channels').toEqual({
      error: 'invalid_signature',
    })
  })

  test('a signature from an unknown key is rejected', async ({ request }) => {
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
    expect(
      response.status(),
      'a cryptographically valid signature from a key no channel stores must still be rejected',
    ).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_signature' })
  })

  test('a body altered after signing is rejected', async ({ request }) => {
    const signer = createDiscordSigner()
    const timestamp = freshTimestamp()
    const signed = pingInteractionBody()
    const tampered = JSON.stringify({ ...JSON.parse(signed), type: 2 })

    const response = await request.post(interactionsUrl(), {
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': signer.sign(timestamp, signed),
        'x-signature-timestamp': timestamp,
      },
      data: tampered,
    })
    expect(response.status(), 'a tampered body must be rejected').toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_signature' })
  })

  test('a replayed (stale) timestamp is rejected before the candidate fan-out', async ({
    request,
  }) => {
    const signer = createDiscordSigner()
    const timestamp = staleTimestamp()
    const body = pingInteractionBody()

    const response = await request.post(interactionsUrl(), {
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': signer.sign(timestamp, body),
        'x-signature-timestamp': timestamp,
      },
      data: body,
    })
    expect(response.status(), 'a stale signed timestamp must be rejected').toBe(401)
    expect(
      await response.json(),
      'the replay guard must answer before any per-candidate verification',
    ).toEqual({ error: 'stale_timestamp' })
  })

  test('an unverified slash command gets no deferred ack and no dispatch', async ({ request }) => {
    // The endpoint now DISPATCHES verified commands (issue #4663), which means a
    // deferred ack is a promise to write into a tenant's hub and post back to
    // Discord. That promise must stay behind the signature gate: a command
    // signed by a key no channel stores is rejected exactly like a PING, never
    // acknowledged with `{ type: 5 }`.
    const signer = createDiscordSigner()
    const timestamp = freshTimestamp()
    const body = slashCommandInteractionBody()

    const response = await request.post(interactionsUrl(), {
      headers: {
        'content-type': 'application/json',
        'x-signature-ed25519': signer.sign(timestamp, body),
        'x-signature-timestamp': timestamp,
      },
      data: body,
    })
    expect(response.status(), 'an unverified slash command must be rejected, not deferred').toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_signature' })
  })

  test('a non-JSON body cannot crash the endpoint', async ({ request }) => {
    const response = await request.post(interactionsUrl(), {
      headers: { 'content-type': 'application/json' },
      data: 'not json at all',
    })
    expect(
      response.status(),
      'an unsigned garbage body must be refused by the signature gate, never 5xx',
    ).toBe(401)
  })
})
