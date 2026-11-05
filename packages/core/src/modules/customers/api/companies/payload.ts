import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'

const SUPPORTED_COMPANY_PROFILE_KEYS = new Set([
  'legalName',
  'brandName',
  'domain',
  'websiteUrl',
  'industry',
  'sizeBucket',
  'annualRevenue',
])

const IGNORED_ROUND_TRIP_KEYS = new Set(['id', 'updatedAt'])

export function normalizeCompanyProfilePayload(
  payload: Record<string, unknown>,
  translate: TranslateWithFallbackFn,
): Record<string, unknown> {
  if (!('profile' in payload) || payload.profile === undefined) {
    return payload
  }

  const profile = payload.profile

  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new CrudHttpError(400, {
      error: translate(
        'customers.errors.profile_must_be_object',
        'profile must be an object',
      ),
    })
  }

  const profileRecord = profile as Record<string, unknown>
  const result = { ...payload }
  delete result.profile

  for (const key of Object.keys(profileRecord)) {
    if (IGNORED_ROUND_TRIP_KEYS.has(key)) {
      continue
    }

    if (!SUPPORTED_COMPANY_PROFILE_KEYS.has(key)) {
      throw new CrudHttpError(400, {
        error: translate(
          'customers.errors.profile_unsupported_field',
          'Unsupported profile field: {{field}}',
          { field: key },
        ),
      })
    }

    if (!(key in result) || result[key] === undefined) {
      result[key] = profileRecord[key]
    }
  }

  return result
}
