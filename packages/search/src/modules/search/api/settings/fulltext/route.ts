import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { fulltextSettingsOpenApi } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['search.view'] },
}

type EnvVarStatus = {
  set: boolean
  hint: string
}

type OptionalEnvVarStatus = {
  set: boolean
  value?: string | boolean
  default?: string | boolean
  hint: string
}

type FulltextConfigResponse = {
  driver: 'meilisearch' | null
  configured: boolean
  envVars: {
    MEILISEARCH_HOST: EnvVarStatus
    MEILISEARCH_API_KEY: EnvVarStatus
  }
  optionalEnvVars: {
    MEILISEARCH_INDEX_PREFIX: OptionalEnvVarStatus
    SEARCH_EXCLUDE_ENCRYPTED_FIELDS: OptionalEnvVarStatus
  }
}

const unauthorized = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  const hostSet = Boolean(process.env.MEILISEARCH_HOST?.trim())
  const apiKeySet = Boolean(process.env.MEILISEARCH_API_KEY?.trim())
  const configured = hostSet && apiKeySet

  const indexPrefix = process.env.MEILISEARCH_INDEX_PREFIX?.trim()
  const excludeEncrypted = ['1', 'true', 'yes', 'on'].includes(
    (process.env.SEARCH_EXCLUDE_ENCRYPTED_FIELDS ?? '').toLowerCase()
  )

  const response: FulltextConfigResponse = {
    driver: configured ? 'meilisearch' : null,
    configured,
    envVars: {
      MEILISEARCH_HOST: {
        set: hostSet,
        hint: 'The URL of your Meilisearch server (e.g., http://localhost:7700)',
      },
      MEILISEARCH_API_KEY: {
        set: apiKeySet,
        hint: 'API key for authentication with Meilisearch',
      },
    },
    optionalEnvVars: {
      MEILISEARCH_INDEX_PREFIX: {
        set: Boolean(indexPrefix),
        value: indexPrefix,
        default: 'om',
        hint: 'Prefix for index names to namespace indexes per tenant',
      },
      SEARCH_EXCLUDE_ENCRYPTED_FIELDS: {
        set: Boolean(process.env.SEARCH_EXCLUDE_ENCRYPTED_FIELDS),
        value: excludeEncrypted,
        default: false,
        hint: 'Exclude encrypted fields from full-text indexing for security',
      },
    },
  }

  return NextResponse.json(response)
}

export const openApi = fulltextSettingsOpenApi
