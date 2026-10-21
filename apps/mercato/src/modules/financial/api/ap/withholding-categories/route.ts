import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readFinancialJurisdiction } from '../../../lib/jurisdiction'
import { resolveFinancialCountryPlugin } from '../../../lib/registries'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

/** The withholding catalogue of the tenant's jurisdiction, for the AP payment form. */
export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: 'Organization context is required' })
    const configService = (() => {
      try {
        return container.resolve('moduleConfigService') as ModuleConfigService
      } catch {
        return null
      }
    })()
    const jurisdiction = configService
      ? await readFinancialJurisdiction(configService, { tenantId: auth.tenantId, organizationId })
      : null
    const plugin = resolveFinancialCountryPlugin(jurisdiction)
    return NextResponse.json({
      countryCode: plugin.countryCode,
      categories: plugin.withholding?.listCategories() ?? [],
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
