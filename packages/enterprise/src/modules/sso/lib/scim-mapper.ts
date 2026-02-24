import type { User } from '@open-mercato/core/modules/auth/data/entities'
import type { SsoIdentity, SsoUserDeactivation } from '../data/entities'

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'

export interface ScimUserResource {
  schemas: string[]
  id: string
  externalId?: string
  userName: string
  displayName?: string
  name?: { givenName?: string; familyName?: string; formatted?: string }
  emails?: Array<{ value: string; primary: boolean; type: string }>
  active: boolean
  meta: {
    resourceType: string
    created: string
    lastModified: string
    location: string
  }
}

export function toScimUserResource(
  user: User,
  identity: SsoIdentity,
  baseUrl: string,
  deactivation?: SsoUserDeactivation | null,
): ScimUserResource {
  const isActive = !deactivation || deactivation.reactivatedAt != null

  const nameParts = (user.name ?? '').split(' ')
  const givenName = nameParts[0] || undefined
  const familyName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined

  return {
    schemas: [SCIM_USER_SCHEMA],
    id: identity.id,
    ...(identity.externalId ? { externalId: identity.externalId } : {}),
    userName: identity.idpEmail,
    displayName: user.name ?? undefined,
    name: (givenName || familyName) ? { givenName, familyName, formatted: user.name ?? undefined } : undefined,
    emails: [{ value: identity.idpEmail, primary: true, type: 'work' }],
    active: isActive,
    meta: {
      resourceType: 'User',
      created: identity.createdAt.toISOString(),
      lastModified: identity.updatedAt.toISOString(),
      location: `${baseUrl}/api/sso/scim/v2/Users/${identity.id}`,
    },
  }
}

export interface ScimUserPayload {
  userName?: string
  externalId?: string
  displayName?: string
  givenName?: string
  familyName?: string
  email?: string
  active?: boolean
}

export function fromScimUserPayload(payload: Record<string, unknown>): ScimUserPayload {
  const result: ScimUserPayload = {}

  if (typeof payload.userName === 'string') result.userName = payload.userName
  if (typeof payload.externalId === 'string') result.externalId = payload.externalId
  if (typeof payload.displayName === 'string') result.displayName = payload.displayName

  if (payload.active !== undefined) {
    result.active = coerceBoolean(payload.active)
  }

  const name = payload.name as Record<string, unknown> | undefined
  if (name && typeof name === 'object') {
    if (typeof name.givenName === 'string') result.givenName = name.givenName
    if (typeof name.familyName === 'string') result.familyName = name.familyName
  }

  const emails = payload.emails as Array<Record<string, unknown>> | undefined
  if (Array.isArray(emails) && emails.length > 0) {
    const primary = emails.find((e) => e.primary === true) ?? emails[0]
    if (typeof primary?.value === 'string') result.email = primary.value
  }

  return result
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return Boolean(value)
}
