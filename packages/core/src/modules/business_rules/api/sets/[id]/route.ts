import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { RuleSet, RuleSetMember } from '../../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid rule set id'),
})

const ruleSetDetailSchema = z.object({
  id: z.string().uuid(),
  setId: z.string(),
  setName: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  members: z.array(z.object({
    id: z.string().uuid(),
    ruleId: z.string().uuid(),
    ruleName: z.string(),
    ruleType: z.string(),
    sequence: z.number(),
    enabled: z.boolean(),
  })),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['business_rules.view'] },
}

export const metadata = routeMetadata

export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid rule set id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const ruleSet = await em.findOne(RuleSet, {
    id: parse.data.id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })

  if (!ruleSet) {
    return NextResponse.json({ error: 'Rule set not found' }, { status: 404 })
  }

  // Fetch members of this rule set
  const members = await findWithDecryption(
    em,
    RuleSetMember,
    {
      ruleSet: ruleSet.id,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    },
    {
      orderBy: { sequence: 'asc', id: 'asc' },
      populate: ['rule'],
    },
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  )

  const response = {
    id: ruleSet.id,
    setId: ruleSet.setId,
    setName: ruleSet.setName,
    description: ruleSet.description ?? null,
    enabled: ruleSet.enabled,
    tenantId: ruleSet.tenantId,
    organizationId: ruleSet.organizationId,
    createdBy: ruleSet.createdBy ?? null,
    updatedBy: ruleSet.updatedBy ?? null,
    createdAt: ruleSet.createdAt.toISOString(),
    updatedAt: ruleSet.updatedAt.toISOString(),
    members: members.map(member => ({
      id: member.id,
      ruleId: member.rule.id,
      ruleName: member.rule.ruleName,
      ruleType: member.rule.ruleType,
      sequence: member.sequence,
      enabled: member.enabled,
    })),
  }

  return NextResponse.json(response)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Business Rules',
  summary: 'Rule set detail',
  methods: {
    GET: {
      summary: 'Get rule set detail',
      description: 'Returns detailed information about a specific rule set, including all member rules.',
      responses: [
        { status: 200, description: 'Rule set details', schema: ruleSetDetailSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid rule set id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Rule set not found', schema: errorResponseSchema },
      ],
    },
  },
}
