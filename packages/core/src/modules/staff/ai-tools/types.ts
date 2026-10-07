import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AiToolExecutionContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { getStaffMemberByUserId } from '../lib/staffMemberResolver'

/**
 * EP-49. Shared context helpers for the time-tracking AI tool pack.
 *
 * Every tool in the pack is API-backed: it re-uses a documented
 * `/api/staff/timesheets/*` route through `createAiApiOperationRunner`, which
 * resolves the route from the generated manifest, refuses a mutation route whose
 * `requiredFeatures` are not covered by the tool's own, and invokes the handler
 * in process with the caller's identity. So the tools inherit — rather than
 * restate — the project-access intersection, the money gate, the mutation guards,
 * the interceptors and the commands' audit and undo. Nothing here writes a time
 * entry itself.
 */

export type StaffToolScope = {
  tenantId: string
  organizationId: string
  staffMemberId: string
}

export function assertTenantScope(ctx: AiToolExecutionContext): {
  tenantId: string
  organizationId: string
} {
  if (!ctx.tenantId) throw new Error('[internal] Tenant context is required for staff.* tools')
  if (!ctx.organizationId) {
    throw new Error('[internal] Organization context is required for staff.* tools')
  }
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

/**
 * The pack is written for "log MY time": every tool acts as the caller's own
 * staff member and none of them accepts a `staffMemberId` from the model. A user
 * with no staff profile is refused rather than defaulted to somebody else.
 */
export async function resolveStaffToolScope(ctx: AiToolExecutionContext): Promise<StaffToolScope> {
  const { tenantId, organizationId } = assertTenantScope(ctx)
  if (!ctx.userId) throw new Error('[internal] User context is required for staff.* tools')
  const container = ctx.container as AwilixContainer
  const em = (container.resolve('em') as EntityManager).fork()
  const member = await getStaffMemberByUserId(em, ctx.userId, tenantId, organizationId)
  if (!member) {
    throw new Error('The signed-in user has no staff profile, so time cannot be logged for them.')
  }
  return { tenantId, organizationId, staffMemberId: member.id }
}

export function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim().slice(0, 10)
  return null
}

export function toMinutes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

/** Inclusive `yyyy-mm-dd` walk; caps at a year so a bad range cannot build an unbounded array. */
export function enumerateDates(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const dates: string[] = []
  for (let cursor = start; cursor <= end && dates.length < 366; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10))
  }
  return dates
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}
