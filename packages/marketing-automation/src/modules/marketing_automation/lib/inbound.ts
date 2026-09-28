import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed inbound hook URLs: how something outside the platform starts a campaign.
 *
 * A hook is a signed URL that names ONE hook row, which names one campaign. Posting to it enrols the
 * identified customer, through exactly the same path a platform event takes, so re-entry policies,
 * audiences, frequency caps and duplicate guards all apply without a second code path.
 *
 * **Its own signer, not the tracking one.** A tracking claim set is run-shaped — campaign, run, step —
 * and a hook has no run. Putting a hook id in the run slot verifies perfectly and means nothing, so this
 * signs its own claim shape under its own key label. The secret is shared; the derived key is not, which
 * is what stops an inbound token being replayed as a click and the reverse.
 */

export type InboundClaims = {
  tenantId: string
  organizationId: string
  hookId: string
}

/** Bumped only if the claim shape changes; an old URL then stops working rather than being misread. */
export const INBOUND_TOKEN_VERSION = 1

const KEY_LABEL = 'marketing_automation:inbound:v1'

function signingKey(secret: string): Buffer {
  return createHash('sha256').update(`${secret}\u0000${KEY_LABEL}`).digest()
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

type WireClaims = { v: number; t: string; o: string; h: string }

export function signInboundToken(claims: InboundClaims, secret: string): string {
  const wire: WireClaims = { v: INBOUND_TOKEN_VERSION, t: claims.tenantId, o: claims.organizationId, h: claims.hookId }
  const body = base64url(JSON.stringify(wire))
  const signature = base64url(createHmac('sha256', signingKey(secret)).update(body).digest())
  return `${body}.${signature}`
}

/** Null for every reason a token can be unusable; a public endpoint must not say which. */
export function verifyInboundToken(token: string, secret: string): InboundClaims | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts
  if (!body || !signature) return null

  const expected = createHmac('sha256', signingKey(secret)).update(body).digest()
  const provided = fromBase64url(signature)
  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null

  let wire: WireClaims
  try {
    wire = JSON.parse(fromBase64url(body).toString('utf8')) as WireClaims
  } catch {
    return null
  }
  if (wire?.v !== INBOUND_TOKEN_VERSION) return null
  for (const value of [wire.t, wire.o, wire.h]) {
    if (typeof value !== 'string' || !value) return null
  }
  return { tenantId: wire.t, organizationId: wire.o, hookId: wire.h }
}

export const INBOUND_PATH = '/api/marketing_automation/inbound'
export const INBOUND_TOKEN_PARAM = 't'

export function inboundHookUrl(baseUrl: string, claims: InboundClaims, secret: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${INBOUND_PATH}?${INBOUND_TOKEN_PARAM}=${signInboundToken(claims, secret)}`
}

/**
 * The largest body accepted, in bytes.
 *
 * The payload is stored in a run's jsonb context and read back on every resume, so a caller posting their
 * whole database would make every step of that run pay for it. Generous for a hook payload, small enough
 * that nothing here becomes a place to put a file.
 */
export const MAX_INBOUND_BODY_BYTES = 16 * 1024

export type InboundPayload = {
  /** Identifies the customer: a platform id, or an address to look up. Both may be present. */
  customerId?: string
  email?: string
  /** Everything else, exposed to audiences and copy as `trigger.*`. */
  data: Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Splits a posted body into identity and data.
 *
 * `customerId` and `email` are lifted out because they are instructions to this endpoint rather than
 * facts about the event, and leaving them in `data` would put an address into a stored run context — the
 * same reason the send step resolves a recipient per send instead of caching it.
 */
export function readInboundPayload(body: unknown): InboundPayload | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const source = body as Record<string, unknown>
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'customerId' || key === 'email') continue
    data[key] = value
  }
  return {
    customerId: readString(source.customerId),
    email: readString(source.email)?.toLowerCase(),
    data,
  }
}
