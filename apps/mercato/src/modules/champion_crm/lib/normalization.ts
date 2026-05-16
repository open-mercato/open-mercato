export type NormalizedLeadIdentity = {
  emailNormalized: string | null
  phoneE164: string | null
  nameRaw: string | null
}

export type NormalizedConsent = {
  scope: 'contact_request' | 'marketing_email' | 'marketing_phone' | 'privacy_policy'
  granted: boolean
  textVersion: string | null
  capturedAt: Date | null
  evidence: Record<string, unknown>
}

export type NormalizedIntakePayload = NormalizedLeadIdentity & {
  source: string
  sourceExternalId: string | null
  apiIdempotencyKey: string | null
  formType: string | null
  sourcePayload: Record<string, unknown>
  message: string | null
  investmentId: string | null
  submittedAt: Date | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  consents: NormalizedConsent[]
}

function cleanText(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export function normalizeEmail(value: unknown): string | null {
  const cleaned = cleanText(value, 320)
  if (!cleaned) return null
  const lower = cleaned.toLowerCase()
  const at = lower.indexOf('@')
  if (at <= 0 || at === lower.length - 1) return null
  return lower
}

export function normalizePhoneE164ish(value: unknown, defaultCountryCode = '48'): string | null {
  const cleaned = cleanText(value, 64)
  if (!cleaned) return null
  const hasPlus = cleaned.startsWith('+')
  const digits = cleaned.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  if (hasPlus) return `+${digits}`
  if (digits.length === 9 && defaultCountryCode) return `+${defaultCountryCode}${digits}`
  if (digits.length > 9 && digits.length <= 15) return `+${digits}`
  return null
}

export function normalizeName(value: unknown, firstName?: unknown, lastName?: unknown): string | null {
  const direct = cleanText(value, 300)
  if (direct) return direct
  const parts = [cleanText(firstName, 120), cleanText(lastName, 120)].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(' ') : null
}

export function splitName(displayName: string | null): { firstName: string | null; lastName: string | null } {
  if (!displayName) return { firstName: null, lastName: null }
  const parts = displayName.split(' ').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return { firstName: null, lastName: null }
  if (parts.length === 1) return { firstName: parts[0], lastName: null }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

export function normalizeUtmValue(value: unknown): string | null {
  return cleanText(value, 200)
}

function normalizeDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeConsents(value: unknown): NormalizedConsent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): NormalizedConsent[] => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const scope = record.scope
    if (
      scope !== 'contact_request' &&
      scope !== 'marketing_email' &&
      scope !== 'marketing_phone' &&
      scope !== 'privacy_policy'
    ) {
      return []
    }
    return [{
      scope,
      granted: record.granted === true,
      textVersion: cleanText(record.textVersion ?? record.text_version, 200),
      capturedAt: normalizeDate(record.capturedAt ?? record.captured_at),
      evidence: record.evidence && typeof record.evidence === 'object' && !Array.isArray(record.evidence)
        ? record.evidence as Record<string, unknown>
        : {},
    }]
  })
}

export function normalizeIntakePayload(input: Record<string, unknown>): NormalizedIntakePayload {
  const utm = input.utm && typeof input.utm === 'object' && !Array.isArray(input.utm)
    ? input.utm as Record<string, unknown>
    : {}
  const source = cleanText(input.source, 200) ?? 'api'
  const sourcePayload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload as Record<string, unknown>
    : { ...input }

  return {
    source,
    sourceExternalId: cleanText(input.sourceExternalId ?? input.source_external_id, 200),
    apiIdempotencyKey: cleanText(input.apiIdempotencyKey ?? input.api_idempotency_key, 200),
    formType: cleanText(input.formType ?? input.form_type, 200),
    sourcePayload,
    message: cleanText(input.message, 5000),
    investmentId: cleanText(input.investmentId ?? input.investment_id, 80),
    submittedAt: normalizeDate(input.submittedAt ?? input.submitted_at),
    utmSource: normalizeUtmValue(input.utmSource ?? input.utm_source ?? utm.source),
    utmMedium: normalizeUtmValue(input.utmMedium ?? input.utm_medium ?? utm.medium),
    utmCampaign: normalizeUtmValue(input.utmCampaign ?? input.utm_campaign ?? utm.campaign),
    utmTerm: normalizeUtmValue(input.utmTerm ?? input.utm_term ?? utm.term),
    utmContent: normalizeUtmValue(input.utmContent ?? input.utm_content ?? utm.content),
    emailNormalized: normalizeEmail(input.email ?? input.emailNormalized ?? input.email_normalized),
    phoneE164: normalizePhoneE164ish(input.phone ?? input.phoneE164 ?? input.phone_e164),
    nameRaw: normalizeName(input.name ?? input.nameRaw ?? input.name_raw, input.firstName ?? input.first_name, input.lastName ?? input.last_name),
    consents: normalizeConsents(input.consents),
  }
}

export function hasUsableIdentifier(identity: NormalizedLeadIdentity): boolean {
  return Boolean(identity.emailNormalized || identity.phoneE164)
}
