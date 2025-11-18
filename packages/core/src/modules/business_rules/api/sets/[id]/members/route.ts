import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { RuleSet, RuleSetMember, BusinessRule } from '../../../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  createRuleSetMemberSchema,
  updateRuleSetMemberSchema,
} from '../../../../data/validators'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid rule set id'),
})

const addMemberRequestSchema = z.object({
  ruleId: z.string().uuid(),
  sequence: z.number().int().min(0).optional().default(0),
  enabled: z.boolean().optional().default(true),
})

const updateMemberRequestSchema = z.object({
  memberId: z.string().uuid(),
  sequence: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
})

const memberResponseSchema = z.object({
  id: z.string().uuid(),
})

const okResponseSchema = z.object({
  ok: z.literal(true),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['business_rules.manage_sets'] },
  PUT: { requireAuth: true, requireFeatures: ['business_rules.manage_sets'] },
  DELETE: { requireAuth: true, requireFeatures: ['business_rules.manage_sets'] },
}

export const metadata = routeMetadata

export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid rule set id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  // Verify rule set exists
  const ruleSet = await em.findOne(RuleSet, {
    id: parse.data.id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })

  if (!ruleSet) {
    return NextResponse.json({ error: 'Rule set not found' }, { status: 404 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = addMemberRequestSchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error?.errors?.map(e => `${e.path.join('.')}: ${e.message}`) ?? ['Unknown validation error']
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  // Verify rule exists
  const rule = await em.findOne(BusinessRule, {
    id: parsed.data.ruleId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  })

  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
  }

  // Check if member already exists
  const existingMember = await em.findOne(RuleSetMember, {
    ruleSet: ruleSet.id,
    rule: rule.id,
  })

  if (existingMember) {
    return NextResponse.json({ error: 'Rule is already a member of this set' }, { status: 409 })
  }

  const payload = {
    ruleSetId: ruleSet.id,
    ruleId: rule.id,
    sequence: parsed.data.sequence,
    enabled: parsed.data.enabled,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  }

  const validatedPayload = createRuleSetMemberSchema.parse(payload)

  const member = em.create(RuleSetMember, {
    ...validatedPayload,
    ruleSet: ruleSet,
    rule: rule,
  })

  await em.persistAndFlush(member)

  return NextResponse.json({ id: member.id }, { status: 201 })
}

export async function PUT(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid rule set id' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateMemberRequestSchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error?.errors?.map(e => `${e.path.join('.')}: ${e.message}`) ?? ['Unknown validation error']
    return NextResponse.json({ error: `Validation failed: ${errors.join(', ')}` }, { status: 400 })
  }

  const member = await em.findOne(RuleSetMember, {
    id: parsed.data.memberId,
    ruleSet: parse.data.id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  if (parsed.data.sequence !== undefined) {
    member.sequence = parsed.data.sequence
  }
  if (parsed.data.enabled !== undefined) {
    member.enabled = parsed.data.enabled
  }

  await em.persistAndFlush(member)

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) {
    return NextResponse.json({ error: 'Invalid rule set id' }, { status: 400 })
  }

  const url = new URL(req.url)
  const memberId = url.searchParams.get('memberId')

  if (!memberId) {
    return NextResponse.json({ error: 'Member id is required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const member = await em.findOne(RuleSetMember, {
    id: memberId,
    ruleSet: parse.data.id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  await em.removeAndFlush(member)

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Business Rules',
  summary: 'Rule set member management',
  methods: {
    POST: {
      summary: 'Add rule to set',
      description: 'Adds a business rule to a rule set with specified sequence and enabled state.',
      params: paramsSchema,
      requestBody: {
        contentType: 'application/json',
        schema: addMemberRequestSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Member added',
          schema: memberResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Rule set or rule not found', schema: errorResponseSchema },
        { status: 409, description: 'Rule already in set', schema: errorResponseSchema },
      ],
    },
    PUT: {
      summary: 'Update set member',
      description: 'Updates sequence or enabled state of a rule set member.',
      params: paramsSchema,
      requestBody: {
        contentType: 'application/json',
        schema: updateMemberRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Member updated',
          schema: okResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Member not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Remove rule from set',
      description: 'Removes a business rule from a rule set (hard delete).',
      params: paramsSchema,
      query: z.object({ memberId: z.string().uuid().describe('Member identifier') }),
      responses: [
        { status: 200, description: 'Member removed', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid identifier', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Member not found', schema: errorResponseSchema },
      ],
    },
  },
}
