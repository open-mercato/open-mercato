import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  FleetFuelLog,
  FleetInsurancePolicy,
  FleetMaintenanceSchedule,
  FleetTrafficViolation,
  FleetWorkOrder,
} from '../../data/entities'
import { summarizeOperations } from '../../lib/operationsService'

const logger = createLogger('fleet_operations')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fleet.read'] },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    const tenantId = auth.tenantId ?? null
    if (!organizationId || !tenantId) {
      return NextResponse.json({ error: 'Organization and tenant context required' }, { status: 400 })
    }
    const em = container.resolve('em') as EntityManager
    const where = { tenantId, organizationId, deletedAt: null }
    const [workOrders, schedules, policies, violations, fuelLogs] = await Promise.all([
      findWithDecryption(em, FleetWorkOrder, where, { limit: 1000 }, { tenantId, organizationId }) as Promise<FleetWorkOrder[]>,
      findWithDecryption(em, FleetMaintenanceSchedule, { ...where, isActive: true }, { limit: 1000 }, { tenantId, organizationId }) as Promise<FleetMaintenanceSchedule[]>,
      findWithDecryption(em, FleetInsurancePolicy, { ...where, status: 'active' }, { limit: 1000 }, { tenantId, organizationId }) as Promise<FleetInsurancePolicy[]>,
      findWithDecryption(em, FleetTrafficViolation, where, { limit: 1000 }, { tenantId, organizationId }) as Promise<FleetTrafficViolation[]>,
      findWithDecryption(em, FleetFuelLog, where, { limit: 5000 }, { tenantId, organizationId }) as Promise<FleetFuelLog[]>,
    ])
    const summary = summarizeOperations({
      workOrders,
      schedules: schedules.map((schedule) => ({
        isActive: schedule.isActive,
        nextDueAt: schedule.nextDueAt ?? null,
        nextDueOdometer: schedule.nextDueOdometer ?? null,
      })),
      policies,
      violations,
      fuelLogs,
    })
    return NextResponse.json({ summary })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('fleet_operations.dashboard_summary failed', { err })
    return NextResponse.json({ error: 'Failed to load the operations summary' }, { status: 500 })
  }
}

export const openApi = {
  tag: 'Fleet operations',
  summary: 'Fleet operations dashboard summary',
  methods: {
    GET: {
      summary: 'Counts and 30-day costs for maintenance, fuel, insurance and violations',
      responses: [{
        status: 200,
        description: 'Summary',
        schema: z.object({
          summary: z.object({
            openWorkOrders: z.number(),
            overdueSchedules: z.number(),
            expiringPolicies: z.number(),
            openViolations: z.number(),
            fuelCost30d: z.string(),
            maintenanceCost30d: z.string(),
          }),
        }),
      }],
    },
  },
}
