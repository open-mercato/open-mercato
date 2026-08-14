/**
 * Shared boilerplate for the hand-written report sub-routes (`sheet`, `close`,
 * `unlock`, `export`).
 *
 * Four routes needing the same six lines of auth, scope, id extraction and
 * granted-feature resolution is exactly the situation where one of them
 * eventually forgets the tenant filter. Resolving it in one place makes that
 * impossible rather than unlikely.
 */

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { reportSheetLabels } from '../../../lib/timesheets-reports/reportLabels'

export { reportSheetLabels }

/**
 * Cap on the raw rows a sheet response carries. A report covering a quarter of a
 * ten-person team can run into the thousands, and the screen paginates anyway;
 * the response says when it truncated rather than quietly serving a short list.
 */
export const MAX_SHEET_ROWS = 500

export type Translate = (key: string, fallback: string) => string

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

export type ReportRequestContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  organizationScope: Awaited<ReturnType<typeof resolveOrganizationScopeForRequest>>
  tenantId: string
  organizationId: string
  reportId: string
  translate: Translate
  /** `null` when RBAC could not be consulted; the declarative guard still applies. */
  grantedFeatures: string[] | null
}

export function extractReportIdFromUrl(url: string | undefined, segment: string): string | null {
  if (!url) return null
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(new RegExp(`/reports/([^/]+)/${segment}`))
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export async function resolveReportRequestContext(
  req: Request,
  options: { segment: string },
): Promise<ReportRequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) {
    throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
  }

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = organizationScope?.tenantId ?? auth.tenantId ?? null
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, {
      error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
    })
  }

  const reportId = extractReportIdFromUrl(req.url, options.segment)
  if (!reportId) {
    throw new CrudHttpError(400, {
      error: translate('staff.time_tracking.reports.errors.idRequired', 'Report id is required.'),
    })
  }

  let grantedFeatures: string[] | null = null
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    grantedFeatures = rbac?.getGrantedFeatures
      ? ((await rbac.getGrantedFeatures(auth.sub ?? '', { tenantId, organizationId })) ?? null)
      : null
  } catch {
    grantedFeatures = null
  }

  return {
    container,
    auth,
    organizationScope,
    tenantId,
    organizationId,
    reportId,
    translate,
    grantedFeatures,
  }
}
