import type { Kysely } from 'kysely'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveWidgetScope, type WidgetScopeContext } from '@open-mercato/core/modules/dashboards/lib/widgetScope'

export const incidentDashboardWidgetQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})

export type IncidentDashboardWidgetContext = WidgetScopeContext

export type IncidentDashboardDatabase = {
  incidents: {
    id: string
    organization_id: string
    tenant_id: string
    status: string
    severity_id: string
    revenue_at_risk_minor: string | number | null
    revenue_at_risk_currency: string | null
    acknowledged_at: Date | string | null
    resolved_at: Date | string | null
    created_at: Date | string
    deleted_at: Date | string | null
  }
  incident_severities: {
    id: string
    organization_id: string
    tenant_id: string
    key: string
    label: string
    rank: number
    deleted_at: Date | string | null
  }
}

type KyselyCapableEntityManager = {
  getKysely: () => Kysely<IncidentDashboardDatabase>
}

export const LIVE_INCIDENT_EXCLUDED_STATUSES = ['resolved', 'closed'] as const

export async function resolveIncidentDashboardWidgetContext(
  req: Request,
  translate: (key: string, fallback?: string) => string,
): Promise<IncidentDashboardWidgetContext> {
  const url = new URL(req.url)
  const rawQuery: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) rawQuery[key] = value

  const parsed = incidentDashboardWidgetQuerySchema.safeParse(rawQuery)
  if (!parsed.success) {
    throw new CrudHttpError(400, {
      error: translate('incidents.dashboard.errors.invalidQuery', 'Invalid dashboard widget query.'),
    })
  }

  return resolveWidgetScope(req, translate, {
    tenantId: parsed.data.tenantId ?? null,
    organizationId: parsed.data.organizationId ?? null,
  })
}

export function getIncidentDashboardDb(
  em: IncidentDashboardWidgetContext['em'],
): Kysely<IncidentDashboardDatabase> {
  return (em as unknown as KyselyCapableEntityManager).getKysely()
}

export function uniqueOrganizationIds(organizationIds: string[] | null): string[] | null {
  if (organizationIds === null) return null
  return Array.from(new Set(organizationIds))
}

export function readCount(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '0'), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export function readOptionalSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

export function readMinorAmount(value: string | number | bigint | null | undefined): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value).toString() : '0'
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return BigInt(value).toString()
    } catch {
      return '0'
    }
  }
  return '0'
}

export function compareMinorAmountDesc(left: string, right: string): number {
  let leftValue = 0n
  let rightValue = 0n
  try {
    leftValue = BigInt(left)
  } catch {}
  try {
    rightValue = BigInt(right)
  } catch {}
  if (leftValue === rightValue) return 0
  return leftValue > rightValue ? -1 : 1
}
