import {
  DiscordInteractionResponseType,
  DiscordInteractionType,
  isSignatureTimestampFresh,
  parseInteractionBody,
  verifyDiscordSignature,
  type TimestampFreshnessOptions,
} from './interactions-verify'

export interface InteractionCandidate {
  channelId: string
  tenantId: string
  organizationId: string | null
  publicKey: string
}

export interface InteractionResult {
  status: number
  /** JSON body to return (Discord expects a response type for verified interactions). */
  body: Record<string, unknown>
  /** The channel the signature verified against (tenant-pinned). Null on reject. */
  matchedChannel: InteractionCandidate | null
}

/**
 * Core Discord Interactions dispatch — pure and testable (no HTTP/DB).
 *
 * SECURITY (fail-closed): the request is rejected (401) unless its Ed25519
 * signature verifies against exactly one candidate channel's public key. The
 * matched channel pins the tenant, so one tenant's interaction never lands in
 * another tenant's scope. A tampered / missing signature verifies against no
 * candidate → 401, and no tenant-scoped work is done.
 *
 * REPLAY GUARD: the signed timestamp must be within
 * `DISCORD_SIGNATURE_MAX_SKEW_SECONDS` of the server clock. The check runs
 * BEFORE the per-candidate Ed25519 fan-out, so a replayed capture (still
 * cryptographically valid forever) is rejected at constant cost.
 *
 * On the mandatory PING (type 1) handshake it returns `{ type: 1 }` (PONG) so
 * Discord accepts the endpoint URL. Application commands / components get a
 * deferred ack; full normalization into the hub is delegated to follow-up wiring
 * (the primary inbound path is the gateway worker).
 */
export function handleDiscordInteraction(input: {
  rawBody: string
  signatureHex: string | undefined | null
  timestamp: string | undefined | null
  candidates: InteractionCandidate[]
  freshness?: TimestampFreshnessOptions
}): InteractionResult {
  const { rawBody, signatureHex, timestamp, candidates, freshness } = input

  if (!isSignatureTimestampFresh(timestamp, freshness)) {
    return { status: 401, body: { error: 'stale_timestamp' }, matchedChannel: null }
  }

  let matched: InteractionCandidate | null = null
  for (const candidate of candidates) {
    const ok = verifyDiscordSignature({
      publicKeyHex: candidate.publicKey,
      signatureHex,
      timestamp,
      rawBody,
    })
    if (ok) {
      matched = candidate
      break
    }
  }

  if (!matched) {
    // FAIL-CLOSED — never acknowledge an unverified interaction.
    return { status: 401, body: { error: 'invalid_signature' }, matchedChannel: null }
  }

  const interaction = parseInteractionBody(rawBody)
  if (!interaction) {
    return { status: 400, body: { error: 'invalid_interaction' }, matchedChannel: matched }
  }

  if (interaction.type === DiscordInteractionType.PING) {
    return {
      status: 200,
      body: { type: DiscordInteractionResponseType.PONG },
      matchedChannel: matched,
    }
  }

  if (
    interaction.type === DiscordInteractionType.APPLICATION_COMMAND ||
    interaction.type === DiscordInteractionType.MESSAGE_COMPONENT
  ) {
    // Deferred ack — Discord shows a "thinking" state; a follow-up can edit the
    // response once the hub/agent produces output.
    return {
      status: 200,
      body: { type: DiscordInteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE },
      matchedChannel: matched,
    }
  }

  // Autocomplete / modal submit are not handled yet — ack without work.
  return {
    status: 200,
    body: { type: DiscordInteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE },
    matchedChannel: matched,
  }
}
