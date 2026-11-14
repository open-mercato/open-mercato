import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { lookupQuerySchema, lookupResponseSchema } from '../../data/validators'
import { GUS_REGON_INTEGRATION_ID } from '../../lib/config'
import { isValidNip, normalizeNip } from '../../lib/nip'
import { lookupCompanyByNip } from '../../lib/lookup'

const logger = createLogger('gus_regon')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['gus_regon.lookup'] },
}

/**
 * GET /api/gus_regon/lookup?nip=<nip>
 *
 * Read-only lookup in a public statutory register; it returns no tenant data.
 * The organization is resolved exactly like the core integration credentials
 * route (`resolveActiveOrganizationId`), so the lookup uses the configuration
 * the admin sees in Settings → Integrations.
 *
 * Fail-open: an invalid NIP returns 400, everything else returns 200 with
 * `{ ok: true, company, candidates }` or `{ ok: false, reason }` so the form
 * degrades to manual entry instead of failing. An unreadable configuration
 * (e.g. a decryption failure) is reported and answered as `unavailable`.
 */
export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) throw new CrudHttpError(401, { error: translate('gus_regon.errors.unauthorized', 'Unauthorized') })

    const url = new URL(req.url)
    const parsed = lookupQuerySchema.safeParse({ nip: url.searchParams.get('nip') ?? '' })
    if (!parsed.success) throw new CrudHttpError(400, { error: translate('gus_regon.errors.nipRequired', 'A nip query parameter is required') })
    if (!isValidNip(parsed.data.nip)) {
      throw new CrudHttpError(400, { error: translate('gus_regon.errors.nipInvalid', 'The NIP is invalid (checksum failed)') })
    }

    const organizationId = resolveActiveOrganizationId(auth)
    if (!organizationId) return organizationScopeRequiredResponse()
    const integrationScope = { organizationId, tenantId: auth.tenantId }

    const container = await createRequestContainer()

    let credentials: Record<string, unknown> | null
    try {
      const stateService = container.resolve<IntegrationStateService>('integrationStateService')
      const enabled = await stateService.isEnabled(GUS_REGON_INTEGRATION_ID, integrationScope)
      if (!enabled) return NextResponse.json({ ok: false, reason: 'not_configured' })
      const credentialsService = container.resolve<CredentialsService>('integrationCredentialsService')
      credentials = await credentialsService.resolve(GUS_REGON_INTEGRATION_ID, integrationScope)
    } catch (err) {
      getTelemetryRuntime()?.reportError(err, { module: 'gus_regon', code: 'gus_regon.config_unreadable' })
      logger.error('[internal] gus_regon.lookup could not read the integration configuration', { err })
      return NextResponse.json({ ok: false, reason: 'unavailable' })
    }

    const result = await lookupCompanyByNip(credentials, normalizeNip(parsed.data.nip))
    return NextResponse.json(result)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    getTelemetryRuntime()?.reportError(err, { module: 'gus_regon', code: 'gus_regon.lookup_failed' })
    logger.error('[internal] gus_regon.lookup errored', { err })
    return NextResponse.json({ error: translate('gus_regon.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'GUS REGON',
  summary: 'Look up a Polish company by NIP in the GUS REGON registry',
  methods: {
    GET: {
      summary: 'Autofill company data from GUS REGON (BIR1) by NIP',
      query: lookupQuerySchema,
      description:
        'Validates the NIP checksum locally (400 on failure), then queries the GUS REGON BIR1.1 API server-side with the organization\'s credentials from Settings → Integrations. Fail-open: upstream errors and timeouts return 200 { ok:false, reason:"unavailable" }; a disabled or unconfigured integration returns { ok:false, reason:"not_configured" }. The API key is never exposed to the client and no tenant data is read or written.',
      responses: [
        {
          status: 200,
          description: 'Company found (ok:true) or a fail-open miss (ok:false)',
          schema: lookupResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Missing or invalid NIP, or organization scope unresolved', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 500, description: 'Unexpected server error', schema: errorSchema },
      ],
    },
  },
}
