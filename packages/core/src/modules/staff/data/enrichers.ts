import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember } from './entities'
import { computeProjectHoursTrend } from '../lib/timesheets-projects/computeProjectHoursTrend'
import {
  listProjectMembersPreview,
  type MemberPreview,
} from '../lib/timesheets-projects/listProjectMembersPreview'

const MANAGE_FEATURE = 'staff.timesheets.projects.manage'

type EntityRecord = Record<string, unknown> & { id: string }

type StaffEnrichment = {
  _staff: {
    hoursWeek: number
    hoursTrend: number[]
    myRole: string | null
    members?: MemberPreview[]
    memberCount?: number
  }
}

const FALLBACK: StaffEnrichment = {
  _staff: {
    hoursWeek: 0,
    hoursTrend: [0, 0, 0, 0, 0, 0, 0],
    myRole: null,
  },
}

type InternalContext = EnricherContext & {
  em: EntityManager
  container: AwilixContainer
}

async function callerHasManage(ctx: InternalContext): Promise<boolean> {
  if (ctx.userFeatures?.includes(MANAGE_FEATURE)) return true
  try {
    const rbac = ctx.container.resolve('rbacService') as RbacService
    return await rbac.userHasAllFeatures(ctx.userId, [MANAGE_FEATURE], {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })
  } catch {
    return false
  }
}

async function resolveCallerStaffMemberId(ctx: InternalContext): Promise<string | null> {
  const member = await findOneWithDecryption(
    ctx.em.fork(),
    StaffTeamMember,
    {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    {},
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  return member?.id ?? null
}

const portfolioEnricher: ResponseEnricher<EntityRecord, StaffEnrichment> = {
  id: 'staff.timesheets-projects-portfolio',
  targetEntity: 'staff:staff_time_project',
  // ACL is enforced by the route (`requireFeatures: ['staff.timesheets.projects.view']`).
  // Per-field gating (e.g. `members` for manage-only) happens inline below via rbacService.
  priority: 10,
  timeout: 3000,
  critical: false,
  fallback: FALLBACK,

  async enrichOne(record, context) {
    const enriched = await this.enrichMany!([record], context)
    return enriched[0]
  },

  async enrichMany(records, context) {
    if (records.length === 0) return records as (EntityRecord & StaffEnrichment)[]

    const ctx = context as InternalContext
    const projectIds = records.map((r) => r.id)

    const [callerStaffMemberId, hasManage] = await Promise.all([
      resolveCallerStaffMemberId(ctx),
      callerHasManage(ctx),
    ])

    const [trendMap, membersMap] = await Promise.all([
      computeProjectHoursTrend({
        em: ctx.em,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        projectIds,
        staffMemberId: hasManage ? null : callerStaffMemberId,
      }),
      listProjectMembersPreview({
        em: ctx.em,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        projectIds,
        callerStaffMemberId,
      }),
    ])

    return records.map((record) => {
      const trend = trendMap.get(record.id) ?? {
        hoursWeek: 0,
        hoursTrend: [0, 0, 0, 0, 0, 0, 0],
      }
      const members = membersMap.get(record.id)
      const enrichment: StaffEnrichment['_staff'] = {
        hoursWeek: trend.hoursWeek,
        hoursTrend: trend.hoursTrend,
        myRole: members?.myRole ?? null,
      }
      if (hasManage && members) {
        enrichment.members = members.preview
        enrichment.memberCount = members.total
      }
      return { ...record, _staff: enrichment }
    })
  },
}

export const enrichers: ResponseEnricher[] = [portfolioEnricher]

export default enrichers
