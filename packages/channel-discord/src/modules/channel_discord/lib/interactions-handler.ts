import { DISCORD_MESSAGE_FLAG_EPHEMERAL } from './discord-rest'
import {
  isDispatchableInteractionType,
  readDispatchableInteraction,
  type DispatchableInteraction,
} from './interactions-dispatch'
import {
  DiscordInteractionResponseType,
  DiscordInteractionType,
  hasVerifiableSignatureHeaders,
  isSignatureTimestampFresh,
  parseInteractionBody,
  readInteractionApplicationId,
  verifyDiscordSignature,
  type TimestampFreshnessOptions,
} from './interactions-verify'

export interface InteractionCandidate {
  channelId: string
  /** Hub channel type, carried through so the dispatch job matches the gateway's. */
  channelType: string
  tenantId: string
  organizationId: string | null
  publicKey: string
  /** Discord application this channel's bot belongs to; `null` when unknown. */
  applicationId: string | null
  /**
   * Scope `integrationCredentialsService.resolve` must be called with to obtain
   * this channel's bot token. Carried instead of the token itself so no
   * credential ever reaches a queue payload.
   */
  credentialScope: { tenantId: string; organizationId: string; userId: string | null }
}

/**
 * The two user-visible strings the synchronous handler can have to emit.
 *
 * They are passed in rather than translated here so the handler stays pure and
 * synchronous — Discord gives the endpoint three seconds, and the caller already
 * knows the locale.
 */
export interface InteractionMessages {
  /** Verified, but the payload carries no channel / user / token to dispatch. */
  notDispatchable: string
  /** Verified and well-formed, but this provider does not handle the type. */
  unsupported: string
}

export const DEFAULT_INTERACTION_MESSAGES: InteractionMessages = {
  notDispatchable:
    'This interaction is missing the channel or user context Open Mercato needs, so it was not recorded.',
  unsupported: 'The Open Mercato Discord channel does not handle this interaction type.',
}

function ephemeralReply(content: string): Record<string, unknown> {
  return {
    type: DiscordInteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: DISCORD_MESSAGE_FLAG_EPHEMERAL },
  }
}

/**
 * What the candidate loader is allowed to narrow by. `applicationId` comes from
 * the unverified request body, so it may only ever shrink the candidate set —
 * see `readInteractionApplicationId`.
 */
export interface InteractionCandidateFilter {
  applicationId: string | null
}

export interface InteractionResult {
  status: number
  /** JSON body to return (Discord expects a response type for verified interactions). */
  body: Record<string, unknown>
  /** The channel the signature verified against (tenant-pinned). Null on reject. */
  matchedChannel: InteractionCandidate | null
  /**
   * Work the caller MUST hand off when the body above is a deferred
   * acknowledgement. Non-null exactly when the response promises a follow-up:
   * ignoring it is what leaves the user staring at "thinking…" forever.
   */
  dispatch?: DispatchableInteraction | null
}

/**
 * Request-only rejection gate, evaluated before anything tenant-scoped is loaded.
 *
 * WHY IT EXISTS: this endpoint is unauthenticated by design, so any caller can
 * POST to it. Everything decidable from the request alone — a missing, malformed
 * or wrong-length signature header, a missing or stale timestamp — is decided
 * here, so that traffic never reaches the candidate loader and never costs a
 * database round-trip or a credential decrypt.
 *
 * Returns the rejection to send, or `null` when the request is well-formed
 * enough that candidates must be loaded to answer it. It is deliberately
 * signature-*shape* only: whether the signature actually verifies still requires
 * a public key, and that check stays where it was.
 */
export function screenInteractionRequest(input: {
  signatureHex: string | undefined | null
  timestamp: string | undefined | null
  freshness?: TimestampFreshnessOptions
}): InteractionResult | null {
  const { signatureHex, timestamp, freshness } = input

  if (!isSignatureTimestampFresh(timestamp, freshness)) {
    return { status: 401, body: { error: 'stale_timestamp' }, matchedChannel: null }
  }
  if (!hasVerifiableSignatureHeaders(signatureHex, timestamp)) {
    return { status: 401, body: { error: 'invalid_signature' }, matchedChannel: null }
  }
  return null
}

/**
 * Screen the request, then load only the candidates that could plausibly match
 * it, then dispatch.
 *
 * This is the order the HTTP route must follow, expressed once and injectable so
 * it can be tested without a database: `loadCandidates` is not called at all for
 * a request the screening gate rejects, and when it is called it receives the
 * `application_id` narrowing so the Ed25519 fan-out runs over the channels of
 * one Discord application instead of every Discord channel in the installation.
 *
 * The narrowing is a NARROWING, never an authorization decision — the signature
 * gate below is unchanged, so a body that claims someone else's `application_id`
 * still fails unless it also carries that application's signature.
 */
export async function resolveDiscordInteraction(input: {
  rawBody: string
  signatureHex: string | undefined | null
  timestamp: string | undefined | null
  loadCandidates: (filter: InteractionCandidateFilter) => Promise<InteractionCandidate[]>
  freshness?: TimestampFreshnessOptions
  messages?: InteractionMessages
}): Promise<InteractionResult> {
  const { rawBody, signatureHex, timestamp, loadCandidates, freshness, messages } = input

  const screened = screenInteractionRequest({ signatureHex, timestamp, freshness })
  if (screened) return screened

  const candidates = await loadCandidates({ applicationId: readInteractionApplicationId(rawBody) })
  return handleDiscordInteraction({ rawBody, signatureHex, timestamp, candidates, freshness, messages })
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
 * cryptographically valid forever) is rejected without any verify work.
 *
 * COST: this function only decides what to do with candidates it is handed.
 * Callers that have to *load* those candidates first must run
 * `screenInteractionRequest` before doing so — that is what keeps an unsigned or
 * stale request genuinely constant-cost rather than merely cheap after the
 * database has already been read (`resolveDiscordInteraction` does it for them).
 *
 * On the mandatory PING (type 1) handshake it returns `{ type: 1 }` (PONG) so
 * Discord accepts the endpoint URL.
 *
 * Application commands, message components and modal submissions return a
 * deferred acknowledgement TOGETHER WITH the `dispatch` the caller must hand to
 * the interactions worker: that worker normalizes the interaction into the hub's
 * existing inbound path and replaces the deferred ack with a real message. The
 * two travel in one result on purpose — a deferred ack nobody follows up is the
 * permanent "thinking…" state this endpoint used to produce.
 *
 * Autocomplete is answered synchronously with an empty choice list, the only
 * response Discord accepts for it, and anything else gets a visible, ephemeral
 * "not handled" reply rather than a promise this provider cannot keep.
 */
export function handleDiscordInteraction(input: {
  rawBody: string
  signatureHex: string | undefined | null
  timestamp: string | undefined | null
  candidates: InteractionCandidate[]
  freshness?: TimestampFreshnessOptions
  messages?: InteractionMessages
}): InteractionResult {
  const { rawBody, signatureHex, timestamp, candidates, freshness } = input
  const messages = input.messages ?? DEFAULT_INTERACTION_MESSAGES

  const screened = screenInteractionRequest({ signatureHex, timestamp, freshness })
  if (screened) return screened

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

  if (isDispatchableInteractionType(interaction.type)) {
    const dispatch = readDispatchableInteraction(interaction)
    if (!dispatch) {
      // Deferring here would be a promise we cannot keep: without the follow-up
      // token or the channel there is nothing to edit the placeholder with.
      return {
        status: 200,
        body: ephemeralReply(messages.notDispatchable),
        matchedChannel: matched,
        dispatch: null,
      }
    }
    return {
      status: 200,
      body: { type: DiscordInteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE },
      matchedChannel: matched,
      dispatch,
    }
  }

  if (interaction.type === DiscordInteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    // Discord rejects a deferred ack for autocomplete. No command this provider
    // registers declares an autocompleting option, so an empty list is the
    // honest answer and it closes the request immediately.
    return {
      status: 200,
      body: {
        type: DiscordInteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
        data: { choices: [] },
      },
      matchedChannel: matched,
      dispatch: null,
    }
  }

  return {
    status: 200,
    body: ephemeralReply(messages.unsupported),
    matchedChannel: matched,
    dispatch: null,
  }
}
