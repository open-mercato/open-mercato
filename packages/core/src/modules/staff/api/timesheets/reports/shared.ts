/**
 * Shared boilerplate for the hand-written report sub-routes (`sheet`, `close`,
 * `unlock`, `export`).
 *
 * Four routes needing the same six lines of auth, scope, id extraction and
 * granted-feature resolution is exactly the situation where one of them
 * eventually forgets the tenant filter. Resolving it in one place makes that
 * impossible rather than unlikely.
 */

import { RATES_FEATURE } from '../../../lib/time-tracking/moneyVisibility'
import { resolveFeatureAccess } from '../../../lib/time-tracking/featureAccess'
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

export type ReportRequestContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  organizationScope: Awaited<ReturnType<typeof resolveOrganizationScopeForRequest>>
  tenantId: string
  organizationId: string
  reportId: string
  translate: Translate
  /**
   * The caller's grants, for the plumbing that needs a list (mutation guards,
   * project-access). Empty when RBAC could not be consulted — read
   * `featuresResolved` before reading anything into an empty array, and never
   * gate money on this.
   */
  grantedFeatures: string[]
  /** `false` when RBAC could not be consulted; the declarative guard still applies. */
  featuresResolved: boolean
  /** Fail-closed `staff.timesheets.rates.view` decision — never re-derive it. */
  canSeeMoney: boolean
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

  // One lookup, through the module's single RBAC authority, answering both
  // questions the four routes ask: may this caller see money, and what is the
  // grant list the mutation guards want. Decided here, once, so no route
  // re-derives it and none can pick the other failure direction.
  //
  // `resolveFeatureAccess` fails closed on every path — an unresolvable service,
  // a service that cannot answer, a call that throws — so an RBAC outage hides
  // rates and costs instead of handing them to a plain report viewer. The grant
  // list is a convenience for the plumbing and must never gate money; `resolved`
  // is what says whether an empty list is RBAC's answer or its absence.
  const ratesAccess = await resolveFeatureAccess(container, auth.sub ?? null, [RATES_FEATURE], {
    tenantId,
    organizationId,
  })

  return {
    container,
    auth,
    organizationScope,
    tenantId,
    organizationId,
    reportId,
    translate,
    grantedFeatures: ratesAccess.grantedFeatures,
    featuresResolved: ratesAccess.resolved,
    canSeeMoney: ratesAccess.allowed,
  }
}
