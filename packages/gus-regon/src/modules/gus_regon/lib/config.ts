import type { GusEnvironment } from './types'

/**
 * GUS BIR1.1 endpoints and the public test key published by GUS
 * (https://api.stat.gov.pl/Home/RegonApi). The test key is not a secret —
 * it is the same for every developer and only works against the test
 * endpoint, which serves synthetic data.
 */
export const GUS_PRODUCTION_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc'
export const GUS_TEST_URL = 'https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc'
export const GUS_PUBLIC_TEST_KEY = 'abcde12345abcde12345'

export const GUS_REGON_INTEGRATION_ID = 'gus_regon'

export type GusConfig = {
  environment: GusEnvironment
  baseUrl: string
  apiKey: string
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function resolveEnvironment(value: unknown): GusEnvironment {
  return asTrimmedString(value) === 'production' ? 'production' : 'test'
}

/**
 * Resolves the runtime config from the integration credentials stored in
 * Settings → Integrations. Returns `null` when the integration cannot be
 * used (production selected without an API key).
 *
 * - `environment = test` → test endpoint; the configured key if present,
 *   otherwise the public GUS test key.
 * - `environment = production` → production endpoint; an API key is required.
 */
export function resolveGusConfig(credentials: Record<string, unknown> | null | undefined): GusConfig | null {
  const environment = resolveEnvironment(credentials?.environment)
  const apiKey = asTrimmedString(credentials?.apiKey)

  if (environment === 'production') {
    if (!apiKey) return null
    return { environment, baseUrl: GUS_PRODUCTION_URL, apiKey }
  }

  return { environment, baseUrl: GUS_TEST_URL, apiKey: apiKey ?? GUS_PUBLIC_TEST_KEY }
}
