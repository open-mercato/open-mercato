import {
  isProposalPayloadUnreadable,
  normalizeProposalEnvelope,
  proposalPayloadSource,
} from '../data/proposalEnvelope'

/**
 * `agent_proposals.payload` is a jsonb column encrypted at rest, and the shared
 * decryptor deliberately returns the decrypted value as a STRING without
 * parsing it (auto-parsing broke React renders for text columns whose value
 * happened to be valid JSON). A jsonb envelope therefore arrives here as JSON
 * text, and before this fix the normalizer answered a non-record with
 * `{ options: [] }` — which the caseload renders as "the agent proposed
 * nothing. There is no decision to make and nothing will run."
 *
 * That sentence is a claim about the agent's verdict. Making it from a payload
 * we failed to read told an operator a real proposal did not exist, left Reject
 * as the only enabled action, and recorded a human rejecting a decision they
 * were never shown.
 */
const ENVELOPE = {
  options: [
    { id: 'primary', label: 'deals.health_check', actions: [{ type: 'set_stage', payload: { stage: 'Negotiation' } }], confidence: 0.78 },
  ],
  rationale: 'Revised pricing sent; awaiting procurement sign-off.',
}

describe('proposal payload readability', () => {
  it('reads a decrypted jsonb payload that arrives as a JSON string', () => {
    const envelope = normalizeProposalEnvelope(JSON.stringify(ENVELOPE))

    expect(envelope.options).toHaveLength(1)
    expect(envelope.options[0]?.id).toBe('primary')
    expect(envelope.options[0]?.confidence).toBeCloseTo(0.78)
    expect(envelope.rationale).toBe(ENVELOPE.rationale)
  })

  it('reads an object payload exactly as before', () => {
    const fromObject = normalizeProposalEnvelope(ENVELOPE)
    const fromString = normalizeProposalEnvelope(JSON.stringify(ENVELOPE))
    expect(fromString).toEqual(fromObject)
  })

  it('separates a genuinely empty option set from an unreadable payload', () => {
    expect(proposalPayloadSource({ options: [] })).toEqual({ kind: 'record', record: { options: [] } })
    expect(isProposalPayloadUnreadable({ options: [] })).toBe(false)
    expect(isProposalPayloadUnreadable(null)).toBe(false)
    expect(isProposalPayloadUnreadable(undefined)).toBe(false)
  })

  it('flags ciphertext that never decrypted as unreadable, not as "proposed nothing"', () => {
    const ciphertext = 'PRf75DAx4JM9K1sG:ehuSS18pLV5OmpFzkhxb0b5/oUi0GyPapwBA7w0Qul4:VEy2HGxT6zliFZDN/ZdK6w==:v1'

    expect(isProposalPayloadUnreadable(ciphertext)).toBe(true)
    expect(proposalPayloadSource(ciphertext).kind).toBe('unreadable')
  })

  it('flags a non-object JSON scalar as unreadable', () => {
    for (const raw of ['42', '"a string"', 'true', '[1,2]']) {
      expect(isProposalPayloadUnreadable(raw)).toBe(true)
    }
  })

  it('treats an empty or whitespace payload as absent rather than a fault', () => {
    expect(proposalPayloadSource('').kind).toBe('absent')
    expect(proposalPayloadSource('   ').kind).toBe('absent')
    expect(isProposalPayloadUnreadable('')).toBe(false)
  })
})
