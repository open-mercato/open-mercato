import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { randomUUID } from 'node:crypto'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  ChampionActivity,
  ChampionApartment,
  ChampionAuditEvent,
  ChampionContact,
  ChampionDeal,
  type ChampionDealStage,
  ChampionInvestment,
  ChampionLead,
} from '../data/entities'

export type ChampionCrmScope = {
  tenantId: string
  organizationId: string
}

export type ChampionCrmActionContext = ChampionCrmScope & {
  actorUserId?: string | null
}

type ActivityTarget = {
  entityType: string
  entityId: string
  leadId?: string | null
  contactId?: string | null
  dealId?: string | null
}

const DEMO_STAGES: ChampionDealStage[] = ['qualified', 'offer_open', 'reservation_agreement', 'won']

export function isChampionDealStage(value: unknown): value is ChampionDealStage {
  return typeof value === 'string' && ['qualified', 'offer_open', 'reservation_agreement', 'won', 'lost'].includes(value)
}

export async function qualifyLead(em: EntityManager, leadId: string, ctx: ChampionCrmActionContext): Promise<ChampionLead> {
  const lead = await requireLead(em, leadId, ctx)
  const now = new Date()
  const previousStatus = lead.qualificationStatus
  lead.qualificationStatus = 'zakwalifikowany'
  lead.qualifiedAt = lead.qualifiedAt ?? now
  lead.qualificationStatusChangedAt = now
  lead.qualificationHistory = [
    ...(Array.isArray(lead.qualificationHistory) ? lead.qualificationHistory : []),
    { from: previousStatus, to: lead.qualificationStatus, at: now.toISOString(), actorUserId: ctx.actorUserId ?? null },
  ]
  await writeSideEffects(em, ctx, {
    target: { entityType: 'lead', entityId: lead.id, leadId: lead.id, contactId: lead.contactId ?? null },
    action: 'lead_qualified',
    title: 'Lead qualified',
    body: 'Lead marked as qualified for the Champion CRM demo flow.',
    metadata: { previousStatus, status: lead.qualificationStatus },
  })
  await em.persist(lead).flush()
  return lead
}

export async function createDealFromLead(em: EntityManager, leadId: string, ctx: ChampionCrmActionContext): Promise<ChampionDeal> {
  const lead = await requireLead(em, leadId, ctx)
  let contact = lead.contactId ? await findOneWithDecryption(
    em,
    ChampionContact,
    scopedWhere<ChampionContact>(ctx, { id: lead.contactId, deletedAt: null }),
    {},
    ctx,
  ) : null

  if (!contact) {
    contact = em.create(ChampionContact, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      displayName: lead.nameRaw || lead.emailNormalized || lead.phoneE164 || 'Champion lead',
      primaryEmail: lead.emailNormalized ?? null,
      primaryPhoneE164: lead.phoneE164 ?? null,
      emails: lead.emailNormalized ? [lead.emailNormalized] : [],
      phones: lead.phoneE164 ? [lead.phoneE164] : [],
      lifecycle: 'prospect',
      ownerUserId: lead.ownerUserId ?? ctx.actorUserId ?? null,
      firstLeadId: lead.id,
      lastLeadId: lead.id,
      lastLeadAt: lead.createdAt ?? new Date(),
      lastLeadSource: lead.source ?? null,
    })
    em.persist(contact)
    lead.contactId = contact.id
    lead.techStatus = 'created_contact'
  } else if (contact.lifecycle === 'lead') {
    contact.lifecycle = 'prospect'
  }

  const existing = await findOneWithDecryption(
    em,
    ChampionDeal,
    scopedWhere<ChampionDeal>(ctx, { sourceLeadId: lead.id, deletedAt: null }),
    { orderBy: { createdAt: 'desc' } },
    ctx,
  ) ?? await findOneWithDecryption(
    em,
    ChampionDeal,
    scopedWhere<ChampionDeal>(ctx, { leadId: lead.id, deletedAt: null }),
    { orderBy: { createdAt: 'desc' } },
    ctx,
  )
  if (existing) {
    lead.dealId = existing.id
    await writeSideEffects(em, ctx, {
      target: { entityType: 'deal', entityId: existing.id, leadId: lead.id, contactId: contact.id, dealId: existing.id },
      action: 'deal_opened_from_lead',
      title: 'Existing deal opened from lead',
      body: existing.title,
      metadata: { leadId: lead.id, dealId: existing.id },
    })
    await em.persist(lead).flush()
    return existing
  }

  const now = new Date()
  const deal = em.create(ChampionDeal, {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    contactId: contact.id,
    leadId: lead.id,
    sourceLeadId: lead.id,
    dealNumber: await nextDealNumber(em, ctx),
    investmentId: lead.investmentId ?? null,
    title: `Deal: ${contact.displayName}`,
    status: 'open',
    stage: 'qualified',
    stageChangedAt: now,
    ownerUserId: lead.ownerUserId ?? ctx.actorUserId ?? null,
    probability: 20,
    currency: 'PLN',
    budgetCurrency: 'PLN',
    metadata: { source: 'lead_conversion' },
  })
  lead.dealId = deal.id
  lead.qualificationStatus = 'zakwalifikowany'
  lead.qualifiedAt = lead.qualifiedAt ?? now
  lead.qualificationStatusChangedAt = lead.qualificationStatusChangedAt ?? now
  em.persist(deal)
  await writeSideEffects(em, ctx, {
    target: { entityType: 'deal', entityId: deal.id, leadId: lead.id, contactId: contact.id, dealId: deal.id },
    action: 'deal_created_from_lead',
    title: 'Deal created from lead',
    body: deal.title,
    metadata: { leadId: lead.id, dealNumber: deal.dealNumber },
  })
  await em.persist([lead, contact]).flush()
  return deal
}

export async function assignApartmentToDeal(
  em: EntityManager,
  dealId: string,
  apartmentId: string,
  ctx: ChampionCrmActionContext,
): Promise<{ deal: ChampionDeal; apartment: ChampionApartment }> {
  const deal = await requireDeal(em, dealId, ctx)
  const apartment = await requireApartment(em, apartmentId, ctx)
  if (apartment.status === 'sold' && apartment.reservedByDealId !== deal.id) {
    throw new Error('Apartment is already sold')
  }
  if (apartment.reservedByDealId && apartment.reservedByDealId !== deal.id) {
    throw new Error('Apartment is reserved by another deal')
  }
  const now = new Date()
  deal.apartmentId = apartment.id
  deal.investmentId = apartment.investmentId
  deal.status = 'reserved'
  deal.stage = 'reservation_agreement'
  deal.stageChangedAt = now
  deal.valueGross = apartment.listPriceGross ?? apartment.priceAmount ?? deal.valueGross ?? null
  deal.currency = apartment.priceCurrency ?? deal.currency ?? 'PLN'
  deal.budgetAmount = deal.budgetAmount ?? deal.valueGross ?? null
  deal.budgetCurrency = deal.budgetCurrency ?? deal.currency ?? 'PLN'
  apartment.status = 'reserved'
  apartment.reservedByDealId = deal.id
  apartment.reservedAt = apartment.reservedAt ?? now
  await writeSideEffects(em, ctx, {
    target: { entityType: 'deal', entityId: deal.id, leadId: deal.sourceLeadId ?? deal.leadId ?? null, contactId: deal.contactId, dealId: deal.id },
    action: 'apartment_reserved',
    title: `Apartment ${apartment.unitNumber} reserved`,
    body: deal.title,
    metadata: { apartmentId: apartment.id, investmentId: apartment.investmentId },
  })
  await em.persist([deal, apartment]).flush()
  return { deal, apartment }
}

export async function advanceDealStage(
  em: EntityManager,
  dealId: string,
  nextStage: ChampionDealStage,
  ctx: ChampionCrmActionContext,
): Promise<ChampionDeal> {
  if (!isChampionDealStage(nextStage)) throw new Error('Unsupported deal stage')
  const deal = await requireDeal(em, dealId, ctx)
  const previousStage = deal.stage
  deal.stage = nextStage
  deal.stageChangedAt = new Date()
  deal.status = nextStage === 'reservation_agreement' ? 'reserved' : nextStage === 'won' ? 'won' : nextStage === 'lost' ? 'lost' : 'open'
  deal.probability = nextStage === 'qualified' ? 20 : nextStage === 'offer_open' ? 45 : nextStage === 'reservation_agreement' ? 75 : nextStage === 'won' ? 100 : 0
  if (nextStage === 'won') {
    await markDealWon(em, dealId, ctx)
    return deal
  }
  await writeSideEffects(em, ctx, {
    target: { entityType: 'deal', entityId: deal.id, leadId: deal.sourceLeadId ?? deal.leadId ?? null, contactId: deal.contactId, dealId: deal.id },
    action: 'deal_stage_changed',
    title: `Deal stage changed to ${nextStage}`,
    body: deal.title,
    metadata: { previousStage, nextStage },
  })
  await em.persist(deal).flush()
  return deal
}

export async function markDealWon(em: EntityManager, dealId: string, ctx: ChampionCrmActionContext): Promise<ChampionDeal> {
  const deal = await requireDeal(em, dealId, ctx)
  const now = new Date()
  deal.status = 'won'
  deal.stage = 'won'
  deal.probability = 100
  deal.stageChangedAt = now
  deal.wonAt = deal.wonAt ?? now
  deal.closedAt = deal.closedAt ?? now

  const contact = await findOneWithDecryption(
    em,
    ChampionContact,
    scopedWhere<ChampionContact>(ctx, { id: deal.contactId, deletedAt: null }),
    {},
    ctx,
  )
  if (contact) {
    contact.lifecycle = 'client'
    em.persist(contact)
  }

  const apartment = deal.apartmentId
    ? await findOneWithDecryption(
      em,
      ChampionApartment,
      scopedWhere<ChampionApartment>(ctx, { id: deal.apartmentId, deletedAt: null }),
      {},
      ctx,
    )
    : null
  if (apartment) {
    apartment.status = 'sold'
    apartment.reservedByDealId = deal.id
    apartment.reservedAt = apartment.reservedAt ?? now
    em.persist(apartment)
  }

  await writeSideEffects(em, ctx, {
    target: { entityType: 'deal', entityId: deal.id, leadId: deal.sourceLeadId ?? deal.leadId ?? null, contactId: deal.contactId, dealId: deal.id },
    action: 'deal_won',
    title: 'Deal won',
    body: deal.title,
    metadata: { apartmentId: deal.apartmentId ?? null, contactLifecycle: contact?.lifecycle ?? null },
  })
  await em.persist(deal).flush()
  return deal
}

export async function seedChampionCrmDemoData(em: EntityManager, ctx: ChampionCrmActionContext) {
  const investment = await upsertInvestment(em, ctx)
  const apartments = await upsertApartments(em, ctx, investment)
  const lead = await upsertAnnaLead(em, ctx, investment)
  await em.flush()
  return { investment, apartments, lead }
}

async function upsertInvestment(em: EntityManager, ctx: ChampionCrmActionContext): Promise<ChampionInvestment> {
  const existing = await findOneWithDecryption(
    em,
    ChampionInvestment,
    scopedWhere<ChampionInvestment>(ctx, { slug: 'hussar-loft', deletedAt: null }),
    {},
    ctx,
  )
  const investment = existing ?? em.create(ChampionInvestment, {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    name: 'Hussar Loft',
    slug: 'hussar-loft',
    status: 'selling',
  })
  investment.name = 'Hussar Loft'
  investment.slug = 'hussar-loft'
  investment.status = 'selling'
  investment.city = 'Krakow'
  investment.address = 'ul. Karmelicka 27'
  investment.addressLine1 = 'ul. Karmelicka 27'
  investment.descriptionShort = 'Boutique loft investment for the Champion CRM free-demo flow.'
  investment.description = investment.descriptionShort
  investment.priceMin = '795000.00'
  investment.priceMax = '1290000.00'
  investment.currency = 'PLN'
  investment.metadata = { ...(investment.metadata ?? {}), demo: 'anna-hussar' }
  em.persist(investment)
  return investment
}

async function upsertApartments(em: EntityManager, ctx: ChampionCrmActionContext, investment: ChampionInvestment): Promise<ChampionApartment[]> {
  const specs = [
    { unitNumber: 'A2.14', building: 'A', floor: '2', rooms: 2, areaSqm: '47.80', listPriceGross: '895000.00' },
    { unitNumber: 'A3.07', building: 'A', floor: '3', rooms: 3, areaSqm: '63.10', listPriceGross: '1185000.00' },
    { unitNumber: 'B1.03', building: 'B', floor: '1', rooms: 2, areaSqm: '52.40', listPriceGross: '965000.00' },
  ]
  const apartments: ChampionApartment[] = []
  for (const spec of specs) {
    const existing = await findOneWithDecryption(
      em,
      ChampionApartment,
      scopedWhere<ChampionApartment>(ctx, { investmentId: investment.id, unitNumber: spec.unitNumber, deletedAt: null }),
      {},
      ctx,
    )
    const apartment = existing ?? em.create(ChampionApartment, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      investmentId: investment.id,
      unitNumber: spec.unitNumber,
    })
    apartment.type = 'apartment'
    apartment.building = spec.building
    apartment.floor = spec.floor
    apartment.rooms = spec.rooms
    apartment.areaSqm = spec.areaSqm
    apartment.priceAmount = spec.listPriceGross
    apartment.listPriceGross = spec.listPriceGross
    apartment.priceCurrency = 'PLN'
    apartment.status = apartment.status === 'sold' ? 'sold' : apartment.reservedByDealId ? 'reserved' : 'available'
    apartment.metadata = { ...(apartment.metadata ?? {}), demo: 'anna-hussar' }
    em.persist(apartment)
    apartments.push(apartment)
  }
  return apartments
}

async function upsertAnnaLead(em: EntityManager, ctx: ChampionCrmActionContext, investment: ChampionInvestment): Promise<ChampionLead> {
  const sourceExternalId = 'demo-anna-kowalska-hussar-loft'
  const existing = await findOneWithDecryption(
    em,
    ChampionLead,
    scopedWhere<ChampionLead>(ctx, { source: 'demo_seed', sourceExternalId, deletedAt: null }),
    {},
    ctx,
  )
  const lead = existing ?? em.create(ChampionLead, {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    source: 'demo_seed',
    sourceExternalId,
  })
  lead.nameRaw = 'Anna Kowalska'
  lead.emailNormalized = 'anna.kowalska@example.test'
  lead.phoneE164 = '+48500100200'
  lead.formType = 'investment_landing_page'
  lead.message = 'I am interested in apartment A2.14 in Hussar Loft. Please contact me with reservation details.'
  lead.investmentId = investment.id
  lead.sourcePayload = { demo: 'anna-hussar', preferredUnit: 'A2.14' }
  lead.receivedAt = lead.receivedAt ?? new Date()
  lead.submittedAt = lead.submittedAt ?? lead.receivedAt
  lead.qualificationStatus = lead.qualificationStatus ?? 'do_kwalifikacji'
  lead.techStatus = lead.techStatus ?? 'new'
  em.persist(lead)
  await writeSideEffects(em, ctx, {
    target: { entityType: 'lead', entityId: lead.id, leadId: lead.id, contactId: lead.contactId ?? null },
    action: 'demo_seeded',
    title: 'Anna Kowalska demo lead seeded',
    body: lead.message,
    metadata: { demo: 'anna-hussar', investmentId: investment.id },
  })
  return lead
}

async function requireLead(em: EntityManager, id: string, ctx: ChampionCrmScope): Promise<ChampionLead> {
  const lead = await findOneWithDecryption(em, ChampionLead, scopedWhere<ChampionLead>(ctx, { id, deletedAt: null }), {}, ctx)
  if (!lead) throw new Error('Lead not found')
  return lead
}

async function requireDeal(em: EntityManager, id: string, ctx: ChampionCrmScope): Promise<ChampionDeal> {
  const deal = await findOneWithDecryption(em, ChampionDeal, scopedWhere<ChampionDeal>(ctx, { id, deletedAt: null }), {}, ctx)
  if (!deal) throw new Error('Deal not found')
  return deal
}

async function requireApartment(em: EntityManager, id: string, ctx: ChampionCrmScope): Promise<ChampionApartment> {
  const apartment = await findOneWithDecryption(em, ChampionApartment, scopedWhere<ChampionApartment>(ctx, { id, deletedAt: null }), {}, ctx)
  if (!apartment) throw new Error('Apartment not found')
  return apartment
}

async function nextDealNumber(em: EntityManager, ctx: ChampionCrmScope): Promise<string> {
  const count = await em.count(ChampionDeal, scopedWhere<ChampionDeal>(ctx, { deletedAt: null }))
  const next = count + 1
  return `CH-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`
}

async function writeSideEffects(
  em: EntityManager,
  ctx: ChampionCrmActionContext,
  input: {
    target: ActivityTarget
    action: string
    title: string
    body?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const metadata = input.metadata ?? {}
  em.persist(em.create(ChampionActivity, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    entityType: input.target.entityType,
    entityId: input.target.entityId,
    leadId: input.target.leadId ?? null,
    contactId: input.target.contactId ?? null,
    dealId: input.target.dealId ?? null,
    type: 'system',
    title: input.title,
    body: input.body ?? null,
    occurredAt: new Date(),
    createdByUserId: ctx.actorUserId ?? null,
    ownerUserId: ctx.actorUserId ?? null,
    metadata,
  }))
  em.persist(em.create(ChampionAuditEvent, {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    entityType: input.target.entityType,
    entityId: input.target.entityId,
    action: input.action,
    actorUserId: ctx.actorUserId ?? null,
    message: input.title,
    metadata,
  }))
}

function scopedWhere<T>(ctx: ChampionCrmScope, where: Record<string, unknown>): FilterQuery<T> {
  return {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    ...where,
  } as FilterQuery<T>
}

export const championCrmDemoStages = DEMO_STAGES
