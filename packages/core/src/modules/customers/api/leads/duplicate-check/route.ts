import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { findEntityIdsBySearchTokens } from '@open-mercato/shared/lib/search/tokenLookup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerEntity, CustomerLead } from '../../../data/entities'
import { leadDuplicateCheckSchema } from '../../../data/validators'
import { E } from '#generated/entities.ids.generated'
import { buildLeadActionContext, type LeadActionContext } from '../runLeadAction'

const logger = createLogger('customers')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.leads.view'] },
}

type DuplicateCandidate = {
  id: string
  kind: 'person' | 'company' | 'lead'
  displayName: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  vatId?: string | null
  matchedOn: string[]
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  return trimmed && trimmed.length ? trimmed : null
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/[^\d]/g, '')
  return digits && digits.length >= 6 ? digits : null
}

function normalizeVat(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase()
  return trimmed && trimmed.length ? trimmed : null
}

function matchedFields(
  candidate: { primaryEmail?: string | null; primaryPhone?: string | null; vatId?: string | null },
  target: { email: string | null; phone: string | null; vat: string | null },
): string[] {
  const matches: string[] = []
  if (target.email && normalizeEmail(candidate.primaryEmail) === target.email) matches.push('email')
  if (target.phone && normalizePhone(candidate.primaryPhone) === target.phone) matches.push('phone')
  if (target.vat && normalizeVat(candidate.vatId) === target.vat) matches.push('vat')
  return matches
}

async function findEntityCandidates(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  target: { email: string | null; phone: string | null },
): Promise<DuplicateCandidate[]> {
  const ids = new Set<string>()
  const search = async (query: string | null, field: string) => {
    if (!query) return
    const result = await findEntityIdsBySearchTokens({
      db: em.getKysely<any>(),
      entityType: E.customers.customer_entity,
      query,
      fields: [field],
      scope,
    })
    if (result.matched) result.ids.forEach((id) => ids.add(id))
  }
  await search(target.email, 'primary_email')
  await search(target.phone, 'primary_phone')

  let entities: CustomerEntity[]
  if (ids.size) {
    entities = await findWithDecryption(
      em,
      CustomerEntity,
      { id: { $in: Array.from(ids) }, ...scope, deletedAt: null },
      {},
      scope,
    )
  } else {
    entities = await findWithDecryption(
      em,
      CustomerEntity,
      { ...scope, deletedAt: null, kind: { $in: ['person', 'company'] } },
      { limit: 5000 },
      scope,
    )
  }

  const candidates: DuplicateCandidate[] = []
  for (const entity of entities) {
    const matches = matchedFields(entity, { email: target.email, phone: target.phone, vat: null })
    if (!matches.length) continue
    candidates.push({
      id: entity.id,
      kind: entity.kind === 'company' ? 'company' : 'person',
      displayName: entity.displayName ?? null,
      primaryEmail: entity.primaryEmail ?? null,
      primaryPhone: entity.primaryPhone ?? null,
      matchedOn: matches,
    })
  }
  return candidates
}

async function findLeadCandidates(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  target: { email: string | null; phone: string | null; vat: string | null },
  excludeLeadId: string | undefined,
): Promise<DuplicateCandidate[]> {
  const conditions: Record<string, unknown>[] = []
  if (target.email) conditions.push({ primaryEmail: { $ilike: target.email } })
  if (target.phone) conditions.push({ primaryPhone: { $ilike: `%${target.phone}%` } })
  if (target.vat) conditions.push({ vatId: { $ilike: target.vat } })
  if (!conditions.length) return []
  const leads = await em.find(CustomerLead, {
    ...scope,
    deletedAt: null,
    ...(excludeLeadId ? { id: { $ne: excludeLeadId } } : {}),
    $or: conditions,
  })
  const candidates: DuplicateCandidate[] = []
  for (const lead of leads) {
    const matches = matchedFields(lead, target)
    if (!matches.length) continue
    candidates.push({
      id: lead.id,
      kind: 'lead',
      displayName: lead.displayName ?? null,
      primaryEmail: lead.primaryEmail ?? null,
      primaryPhone: lead.primaryPhone ?? null,
      vatId: lead.vatId ?? null,
      matchedOn: matches,
    })
  }
  return candidates
}

export async function POST(req: Request) {
  let context: LeadActionContext | null = null
  try {
    context = await buildLeadActionContext(req)
    const body = await req.json().catch(() => ({}))
    const parsed = leadDuplicateCheckSchema.parse(body)
    const target = {
      email: normalizeEmail(parsed.primaryEmail),
      phone: normalizePhone(parsed.primaryPhone),
      vat: normalizeVat(parsed.vatId),
    }
    if (!target.email && !target.phone && !target.vat) {
      return NextResponse.json({ items: [], total: 0, checked: false })
    }
    const em = context.ctx.container.resolve('em') as EntityManager
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const [entities, leads] = await Promise.all([
      findEntityCandidates(em, scope, target),
      findLeadCandidates(em, scope, target, parsed.excludeLeadId),
    ])
    const items = [...entities, ...leads]
    return NextResponse.json({ items, total: items.length, checked: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('customers.leads.duplicate-check failed', { err })
    return NextResponse.json({ error: 'Duplicate check failed' }, { status: 400 })
  }
}

export const openApi = {
  tag: 'Customers',
  summary: 'Check a lead for possible duplicates',
  methods: {
    POST: {
      summary: 'Suggest existing people, companies and leads that match the contact data',
      requestBody: { contentType: 'application/json', schema: leadDuplicateCheckSchema },
      responses: [{
        status: 200,
        description: 'Possible duplicates',
        schema: z.object({
          items: z.array(z.object({
            id: z.string().uuid(),
            kind: z.enum(['person', 'company', 'lead']),
            displayName: z.string().nullable(),
            primaryEmail: z.string().nullable(),
            primaryPhone: z.string().nullable(),
            vatId: z.string().nullable().optional(),
            matchedOn: z.array(z.string()),
          })),
          total: z.number(),
          checked: z.boolean(),
        }),
      }],
      errors: [
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
