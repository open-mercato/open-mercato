import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { ChampionActivity, ChampionAuditEvent, ChampionConsentEvent, ChampionContact, ChampionLead } from '../../../data/entities'
import { championLeadIntakeSchema } from '../../../data/validators'
import { deduplicateLead, type LeadDedupDecision, type LeadDedupRepository } from '../../../lib/dedup'
import { normalizeIntakePayload, type NormalizedIntakePayload } from '../../../lib/normalization'
import { emitChampionCrmEvent } from '../../../events'
import { resolveActorId, resolveChampionCrmRequestContext } from '../../../lib/request-context'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['champion_crm.leads.manage'] },
}

type Scope = { tenantId: string; organizationId: string }

export async function POST(req: Request) {
  try {
    const ctx = await resolveChampionCrmRequestContext(req)
    const scope: Scope = { tenantId: String(ctx.auth.tenantId), organizationId: String(ctx.selectedOrganizationId) }
    const raw = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = championLeadIntakeSchema.parse(raw ?? {})
    const normalized = normalizeIntakePayload(parsed)
    const actorUserId = resolveActorId(ctx.auth)
    const guardUserId = actorUserId ?? 'system'

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: guardUserId,
      resourceKind: 'champion_crm.lead',
      resourceId: '',
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: normalized,
    })
    if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

    const em = ctx.container.resolve('em') as EntityManager
    const lead = await createOrUpdateLead(em, normalized, scope, actorUserId)
    const dedup = await deduplicateLead(lead, createMikroOrmLeadDedupRepository(em, lead, scope, actorUserId))
    await writeIntakeSideEffects(em, lead, normalized, dedup, scope, actorUserId)

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: guardUserId,
        resourceKind: 'champion_crm.lead',
        resourceId: lead.id,
        operation: 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    await emitChampionCrmEvent('champion_crm.lead.received', {
      id: lead.id,
      leadId: lead.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      source: normalized.source,
    }, { persistent: true }).catch(() => undefined)

    return NextResponse.json({
      ok: true,
      id: lead.id,
      leadId: lead.id,
      techStatus: dedup.status,
      contactId: dedup.contactId,
    }, { status: 201 })
  } catch (err) {
    if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 })
    console.error('champion_crm intake failed', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function createOrUpdateLead(
  em: EntityManager,
  normalized: NormalizedIntakePayload,
  scope: Scope,
  actorUserId: string | null,
): Promise<ChampionLead> {
  const existing = normalized.sourceExternalId
    ? await findOneWithDecryption(
      em,
      ChampionLead,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        source: normalized.source,
        sourceExternalId: normalized.sourceExternalId,
        deletedAt: null,
      } as FilterQuery<ChampionLead>,
      {},
      scope,
    )
    : null

  const lead = existing ?? em.create(ChampionLead, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    source: normalized.source,
    sourceExternalId: normalized.sourceExternalId,
  })

  lead.sourcePayload = normalized.sourcePayload
  lead.utmSource = normalized.utmSource
  lead.utmMedium = normalized.utmMedium
  lead.utmCampaign = normalized.utmCampaign
  lead.utmTerm = normalized.utmTerm
  lead.utmContent = normalized.utmContent
  lead.emailNormalized = normalized.emailNormalized
  lead.phoneE164 = normalized.phoneE164
  lead.nameRaw = normalized.nameRaw
  lead.ownerUserId = lead.ownerUserId ?? actorUserId
  lead.techStatus = existing ? lead.techStatus : 'new'
  lead.qualificationStatus = lead.qualificationStatus ?? 'do_kwalifikacji'
  lead.updatedAt = new Date()
  await em.persist(lead).flush()
  return lead
}

function createMikroOrmLeadDedupRepository(
  em: EntityManager,
  lead: ChampionLead,
  scope: Scope,
  actorUserId: string | null,
): LeadDedupRepository<ChampionContact> {
  return {
    async findContactByEmail(email) {
      return await findOneWithDecryption(
        em,
        ChampionContact,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, primaryEmail: email, deletedAt: null } as FilterQuery<ChampionContact>,
        {},
        scope,
      )
    },
    async findContactByPhone(phone) {
      return await findOneWithDecryption(
        em,
        ChampionContact,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, primaryPhoneE164: phone, deletedAt: null } as FilterQuery<ChampionContact>,
        {},
        scope,
      )
    },
    async createContact(input) {
      const contact = em.create(ChampionContact, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: input.displayName,
        primaryEmail: input.primaryEmail,
        primaryPhoneE164: input.primaryPhoneE164,
        emails: input.primaryEmail ? [input.primaryEmail] : [],
        phones: input.primaryPhoneE164 ? [input.primaryPhoneE164] : [],
        lifecycle: 'lead',
        ownerUserId: lead.ownerUserId ?? actorUserId,
        firstLeadId: lead.id,
        lastLeadId: lead.id,
        lastLeadAt: lead.createdAt ?? new Date(),
        lastLeadSource: lead.source ?? null,
      })
      await em.persist(contact).flush()
      return contact
    },
    async linkLead(decision) {
      lead.techStatus = decision.status
      lead.contactId = decision.contactId
      lead.updatedAt = new Date()
      await em.persist(lead).flush()
      if (!decision.contactId) return
      const contact = await findOneWithDecryption(em, ChampionContact, {
        id: decision.contactId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<ChampionContact>, {}, scope)
      if (!contact) return
      contact.lastLeadId = lead.id
      contact.lastLeadAt = lead.createdAt ?? new Date()
      contact.lastLeadSource = lead.source ?? null
      if (lead.emailNormalized && !contact.emails.includes(lead.emailNormalized)) contact.emails = [...contact.emails, lead.emailNormalized]
      if (lead.phoneE164 && !contact.phones.includes(lead.phoneE164)) contact.phones = [...contact.phones, lead.phoneE164]
      await em.persist(contact).flush()
    },
    async writeAudit(decision) {
      const audit = em.create(ChampionAuditEvent, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        entityType: 'lead',
        entityId: lead.id,
        action: decision.auditAction,
        actorUserId,
        message: decision.status === 'manual_review'
          ? 'Lead requires manual review because no usable identifier was present.'
          : `Lead dedup resolved as ${decision.status}.`,
        metadata: {
          contactId: decision.contactId,
          emailNormalized: lead.emailNormalized ?? null,
          phoneE164: lead.phoneE164 ?? null,
        },
      })
      await em.persist(audit).flush()
    },
  }
}

async function writeIntakeSideEffects(
  em: EntityManager,
  lead: ChampionLead,
  normalized: NormalizedIntakePayload,
  dedup: LeadDedupDecision,
  scope: Scope,
  actorUserId: string | null,
) {
  const activity = em.create(ChampionActivity, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    entityType: 'lead',
    entityId: lead.id,
    leadId: lead.id,
    contactId: dedup.contactId,
    type: 'form_submit',
    title: 'Lead intake received',
    body: normalized.source,
    occurredAt: new Date(),
    createdByUserId: actorUserId,
    ownerUserId: lead.ownerUserId ?? actorUserId,
    metadata: {
      source: normalized.source,
      sourceExternalId: normalized.sourceExternalId,
      techStatus: dedup.status,
    },
  })
  em.persist(activity)

  for (const consent of normalized.consents) {
    em.persist(em.create(ChampionConsentEvent, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      contactId: dedup.contactId,
      leadId: lead.id,
      scope: consent.scope,
      granted: consent.granted,
      textVersion: consent.textVersion,
      source: normalized.source,
      capturedAt: consent.capturedAt ?? new Date(),
      evidence: consent.evidence,
    }))
  }

  await em.flush()
}

const intakeResponseSchema = z.object({
  ok: z.boolean(),
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  techStatus: z.string(),
  contactId: z.string().uuid().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Champion CRM',
  summary: 'Create inbound Champion CRM lead',
  methods: {
    POST: {
      summary: 'Intake a lead',
      description: 'Normalizes inbound lead identity, creates or updates a lead, deduplicates against Champion contacts, and records audit/activity/consent data.',
      requestBody: { contentType: 'application/json', schema: championLeadIntakeSchema },
      responses: [
        { status: 201, description: 'Lead accepted', schema: intakeResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: z.object({ error: z.string() }).passthrough() },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 500, description: 'Unexpected server error', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
