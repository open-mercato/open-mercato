type OutboundDeliveryIntentInput = {
  message: {
    visibility?: 'public' | 'internal' | null
  }
  /**
   * `forwardedFrom` as carried by the `messages.message.sent` payload — the id of
   * the message a `messages.messages.forward` was built from, absent on every
   * other compose path.
   */
  forwardedFromMessageId?: string | null
}

/**
 * Whether a platform message in a channel-linked thread was meant to leave the
 * platform, i.e. to be delivered to the external correspondent.
 *
 * The outbound bridge's origin test (`isIngestedInboundMessage`) answers a
 * narrower question — "did the ingest command compose this?" — and every
 * *internal* message sharing the channel thread falls between the two. This
 * predicate is the intent half, and it fails closed: only a message that is
 * neither internal nor a forward is delivered.
 *
 * Two signals:
 *
 *   1. **`visibility === 'internal'`** — an internal note, or an internal
 *      compose filed against the conversation with an explicit
 *      `parentMessageId`. `api/route.ts` deliberately leaves such a compose on
 *      its own thread, and it must not be delivered either.
 *   2. **`forwardedFromMessageId`** — a forward. `forwardMessageCommand` copies
 *      `visibility` from the message it forwards, so forwarding a *public*
 *      inbound message produces a public forward whose body is the quoted
 *      conversation plus the operator's own commentary about the correspondent.
 *      Signal 1 cannot see it.
 *
 * Signal 2 reads the event payload rather than the `messages` row on purpose:
 * nothing persisted distinguishes a forward from a reply — both set
 * `parentMessageId` to the message they answer, and a `replyAll` reply carries
 * platform recipient rows just like a forward does — so the recorded intent in
 * the `messages.message.sent` payload is the only precise discriminator. Its
 * absence reads as "not a forward", which is why signal 1 is checked
 * independently rather than as a fallback.
 */
export function isOutboundDeliveryIntended({
  message,
  forwardedFromMessageId,
}: OutboundDeliveryIntentInput): boolean {
  if (message.visibility === 'internal') return false
  if (typeof forwardedFromMessageId === 'string' && forwardedFromMessageId.length > 0) return false
  return true
}
