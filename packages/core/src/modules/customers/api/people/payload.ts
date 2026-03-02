const NESTED_PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'preferredName',
  'jobTitle',
  'department',
  'seniority',
  'timezone',
  'linkedInUrl',
  'twitterUrl',
  'companyEntityId',
] as const

export function normalizePersonPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }

  const payload = { ...(raw as Record<string, unknown>) }
  const profile = payload.profile

  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return payload
  }

  const profileRecord = profile as Record<string, unknown>

  for (const field of NESTED_PROFILE_FIELDS) {
    if (payload[field] !== undefined) continue
    if (!Object.prototype.hasOwnProperty.call(profileRecord, field)) continue
    const value = profileRecord[field]
    if (value !== undefined) {
      payload[field] = value
    }
  }

  delete payload.profile
  return payload
}
