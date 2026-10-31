import { z } from 'zod'
import type { XeroApiClient } from './api-client'
import { XeroApiError } from './errors'

const xeroConnectionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  tenantType: z.string(),
  tenantName: z.string().nullable().optional(),
  authEventId: z.string().nullable().optional(),
})

export type XeroConnection = {
  id: string
  tenantId: string
  tenantType: string
  tenantName: string | null
  authEventId: string | null
}

export type XeroOrganisationOption = {
  xeroOrganisationId: string
  xeroConnectionId: string
  name: string
}

export function parseXeroConnections(body: unknown): XeroConnection[] {
  const parsed = z.array(xeroConnectionSchema).safeParse(body)
  if (!parsed.success) throw new XeroApiError('transient', { cause: parsed.error })
  return parsed.data.map((connection) => ({
    id: connection.id,
    tenantId: connection.tenantId,
    tenantType: connection.tenantType,
    tenantName: connection.tenantName ?? null,
    authEventId: connection.authEventId ?? null,
  }))
}

export function toOrganisationOptions(connections: XeroConnection[]): XeroOrganisationOption[] {
  return connections
    .filter((connection) => connection.tenantType === 'ORGANISATION')
    .map((connection) => ({
      xeroOrganisationId: connection.tenantId,
      xeroConnectionId: connection.id,
      name: connection.tenantName && connection.tenantName.trim().length > 0 ? connection.tenantName.trim() : connection.tenantId,
    }))
}

export function readAuthEventIdClaim(accessToken: string): string | null {
  const segments = accessToken.split('.')
  if (segments.length !== 3) return null
  try {
    const payload: unknown = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const claim = (payload as Record<string, unknown>).authentication_event_id
    return typeof claim === 'string' && claim.trim().length > 0 ? claim.trim() : null
  } catch {
    return null
  }
}

export async function listConsentOrganisations(
  client: Pick<XeroApiClient, 'getToken' | 'listConnections'>,
): Promise<{ organisations: XeroOrganisationOption[]; filtered: boolean }> {
  const token = await client.getToken()
  const authEventId = readAuthEventIdClaim(token.accessToken)
  if (authEventId) {
    const consentRound = toOrganisationOptions((await client.listConnections({ authEventId })).body)
    if (consentRound.length > 0) return { organisations: consentRound, filtered: true }
  }
  return { organisations: await listAllOrganisations(client), filtered: false }
}

export async function listAllOrganisations(client: Pick<XeroApiClient, 'listConnections'>): Promise<XeroOrganisationOption[]> {
  return toOrganisationOptions((await client.listConnections()).body)
}
