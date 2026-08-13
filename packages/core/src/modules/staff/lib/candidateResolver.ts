import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  StaffCandidatePage,
  StaffCandidateResolver,
} from '../contracts/candidateResolver'
import { StaffTeamMember } from '../data/entities'

const candidateInputSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  linkage: z.enum(['required', 'any']),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
}).strict()

type CandidateInput = z.infer<typeof candidateInputSchema>

function buildCandidateFilter(input: CandidateInput): FilterQuery<StaffTeamMember> {
  const where: FilterQuery<StaffTeamMember> = {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    deletedAt: null,
    isActive: true,
  }

  if (input.linkage === 'required') {
    where.userId = { $ne: null }
  }
  if (input.search) {
    where.displayName = { $ilike: `%${escapeLikePattern(input.search)}%` }
  }

  return where
}

export function createStaffCandidateResolver(em: EntityManager): StaffCandidateResolver {
  return {
    async listCandidates(rawInput) {
      const parsedInput = candidateInputSchema.safeParse(rawInput)
      if (!parsedInput.success) {
        throw new TypeError('Staff candidate lookup requires valid scoped pagination input')
      }

      const input = parsedInput.data
      const where = buildCandidateFilter(input)
      const total = await em.count(StaffTeamMember, where)
      const totalPages = Math.ceil(total / input.pageSize)
      if (total === 0 || input.page > totalPages) {
        return {
          items: [],
          total,
          page: input.page,
          pageSize: input.pageSize,
          totalPages,
        }
      }

      const members = await findWithDecryption(
        em,
        StaffTeamMember,
        where,
        {
          limit: input.pageSize,
          offset: (input.page - 1) * input.pageSize,
          orderBy: { displayName: 'asc', id: 'asc' },
        },
        { tenantId: input.tenantId, organizationId: input.organizationId },
      )

      const items = members.map((member) => ({
        staffMemberId: member.id,
        displayName: member.displayName,
      }))

      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages,
      } satisfies StaffCandidatePage
    },
  }
}
