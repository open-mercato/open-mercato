import { E as CoreEntities } from '#generated/entities.ids.generated'
import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import {
  CUSTOMER_ACTIVITY_CUSTOM_FIELDS,
  CUSTOMER_COMPANY_CUSTOM_FIELDS,
  CUSTOMER_DEAL_CUSTOM_FIELDS,
  CUSTOMER_PERSON_CUSTOM_FIELDS,
} from '../../customFieldDefaults'
import { createRng, deterministicUuid, zipfWeights, type Rng } from './prng'
import {
  ACTION_WORDS,
  CITY_HEADS,
  CITY_TAILS,
  COMPANY_HEADS,
  COMPANY_SUFFIXES,
  COMPANY_TAILS,
  DEAL_ROLES,
  DEPARTMENTS,
  FILLER_WORDS,
  FIRST_NAMES,
  INDUSTRIES,
  JOB_TITLES,
  LAST_NAMES,
  PERF_EMAIL_FALLBACK_DOMAIN,
  REGIONS,
  RENEWAL_QUARTERS,
  SENIORITY,
  SIZE_BUCKETS,
  STREET_WORDS,
  TIMEZONES,
  TOPIC_WORDS,
  UNIQUE_SURNAME_PREFIX,
  UNIQUE_SURNAME_SYLLABLES,
  UNIQUE_SURNAME_WIDTH,
  type PerfProfile,
  type PerfTier,
} from './profile'
import {
  emptyTableRows,
  type CustomFieldDraft,
  type DealPlan,
  type EntityBundle,
  type EntityPlan,
  type GeneratorContext,
  type SqlRow,
  type TableRows,
} from './types'

const DAY_MS = 24 * 60 * 60 * 1000
const INTERACTION_DURATIONS: Record<string, number[]> = {
  call: [15, 30, 45],
  meeting: [30, 60, 90],
}
const DEAL_KINDS = ['expansion', 'renewal', 'pilot', 'upgrade', 'rollout']
const ENTITY_ID_CUSTOMER_ENTITY = CoreEntities.customers.customer_entity

export function resolveEntityCount(profile: PerfProfile, tier: PerfTier, scale: number): number {
  return Math.max(1, Math.round(profile.tierEntities[tier] * scale))
}

export function parseAnchorDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`[internal] Invalid anchor date: ${value}`)
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`[internal] Invalid anchor date: ${value}`)
  }
  return date
}

export function formatAnchorDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function idNamespace(ctx: GeneratorContext): string {
  return `${ctx.profile.id}|${ctx.seed}|${ctx.scope.tenantId}|${ctx.scope.organizationId}`
}

export function seedRecordId(ctx: GeneratorContext, ...parts: Array<string | number>): string {
  return deterministicUuid(idNamespace(ctx), ...parts)
}

function rngFor(ctx: GeneratorContext, ...parts: Array<string | number>): Rng {
  return createRng(`${ctx.profile.id}|${ctx.seed}|${parts.join('|')}`)
}

function daysBefore(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() - days * DAY_MS)
}

function daysAfter(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() + days * DAY_MS)
}

function between(rng: Rng, from: Date, to: Date): Date {
  const start = from.getTime()
  const end = Math.max(start, to.getTime())
  return new Date(Math.floor(start + rng.next() * (end - start)))
}

function capitalize(value: string): string {
  return value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

function sentence(rng: Rng, minWords: number, maxWords: number): string {
  const count = rng.int(minWords, maxWords)
  const words: string[] = []
  for (let position = 0; position < count; position += 1) words.push(rng.pick(FILLER_WORDS))
  return `${capitalize(words.join(' '))}.`
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

export function isCompanyIndex(profile: PerfProfile, index: number): boolean {
  return index % profile.companyEvery === 0
}

export function encodeUniqueSurname(index: number): string {
  let remaining = index
  const syllables: string[] = []
  for (let position = 0; position < UNIQUE_SURNAME_WIDTH; position += 1) {
    syllables.push(UNIQUE_SURNAME_SYLLABLES[remaining % UNIQUE_SURNAME_SYLLABLES.length])
    remaining = Math.floor(remaining / UNIQUE_SURNAME_SYLLABLES.length)
  }
  return `${UNIQUE_SURNAME_PREFIX}${syllables.reverse().join('')}`
}

export function sampleInteractionCount(rng: Rng, profile: PerfProfile): { bucketIndex: number; count: number } {
  const bucketIndex = rng.weighted(profile.interactionBuckets.map((bucket) => bucket.weight))
  const spec = profile.interactionBuckets[bucketIndex]
  const shaped = Math.pow(rng.next(), profile.interactionSkew)
  const raw = Math.floor(spec.min * Math.pow((spec.max + 1) / spec.min, shaped))
  return { bucketIndex, count: Math.min(spec.max, Math.max(spec.min, raw)) }
}

function pickOwner(rng: Rng, ctx: GeneratorContext): string {
  const owners = ctx.refs.owners
  const heavyCount = heavyOwnerCount(ctx.profile, owners.length)
  const heavy = rng.chance(ctx.profile.heavyOwnerRecordShare)
  const position = heavy ? rng.int(0, heavyCount - 1) : rng.int(0, owners.length - 1)
  return owners[position]
}

export function heavyOwnerCount(profile: PerfProfile, ownerCount: number): number {
  return Math.max(1, Math.ceil(ownerCount * profile.heavyOwnerShare))
}

function pickDictionaryValue(rng: Rng, values: readonly string[], exponent: number): string | null {
  if (!values.length) return null
  return values[rng.weighted(zipfWeights(values.length, exponent))]
}

function chooseCompanyIndex(rng: Rng, profile: PerfProfile, index: number): number {
  const latest = Math.floor(index / profile.companyEvery)
  const earliest = Math.max(0, latest - profile.companyWindow + 1)
  return rng.int(earliest, latest) * profile.companyEvery
}

export function planEntity(ctx: GeneratorContext, index: number): EntityPlan {
  const { profile } = ctx
  const rng = rngFor(ctx, 'plan', index)
  const kind = isCompanyIndex(profile, index) ? 'company' : 'person'
  const { bucketIndex, count } = sampleInteractionCount(rng, profile)
  const dealCount = rng.weighted(profile.dealCountWeights)
  const ownerUserId = pickOwner(rng, ctx)
  const base = {
    index,
    id: seedRecordId(ctx, 'entity', index),
    profileId: seedRecordId(ctx, 'profile', index),
    bucket: profile.interactionBuckets[bucketIndex].bucket,
    interactionCount: count,
    dealCount,
    ownerUserId,
  }
  if (kind === 'company') {
    const companyHead = rng.pick(COMPANY_HEADS)
    const companyTail = rng.pick(COMPANY_TAILS)
    const suffix = rng.pick(COMPANY_SUFFIXES)
    return {
      ...base,
      kind,
      companyIndex: null,
      extraCompanyIndex: null,
      firstName: null,
      lastName: null,
      uniqueSurname: false,
      companyHead,
      companyTail,
      displayName: `${companyHead} ${companyTail} ${suffix}`,
    }
  }
  const firstName = rng.pick(FIRST_NAMES)
  const pickedLastName = rng.pick(LAST_NAMES)
  const uniqueSurname = rng.chance(profile.uniqueSurnameRate)
  const lastName = uniqueSurname ? encodeUniqueSurname(index) : pickedLastName
  const withoutCompany = rng.chance(profile.personWithoutCompanyRate)
  const primaryChoice = chooseCompanyIndex(rng, profile, index)
  const multiCompany = rng.chance(profile.multiCompanyRate)
  const extraChoice = chooseCompanyIndex(rng, profile, index)
  const companyIndex = withoutCompany ? null : primaryChoice
  const extraCompanyIndex = companyIndex !== null && multiCompany && extraChoice !== companyIndex ? extraChoice : null
  return {
    ...base,
    kind,
    companyIndex,
    extraCompanyIndex,
    firstName,
    lastName,
    uniqueSurname,
    companyHead: null,
    companyTail: null,
    displayName: `${firstName} ${lastName}`,
  }
}

export function planDeal(ctx: GeneratorContext, entityIndex: number, ordinal: number): DealPlan {
  const rng = rngFor(ctx, 'deal-plan', entityIndex, ordinal)
  const pipelineIndex = rng.weighted(ctx.profile.pipelines.map((pipeline) => pipeline.weight))
  const stageIndex = rng.weighted(ctx.profile.stageWeights)
  return {
    entityIndex,
    ordinal,
    id: seedRecordId(ctx, 'deal', entityIndex, ordinal),
    pipelineIndex,
    stageIndex,
  }
}

export function companyDomain(plan: EntityPlan): string {
  const slug = `${plan.companyHead ?? 'company'}${plan.companyTail ?? ''}`.toLowerCase()
  return `${slug}-${plan.index.toString(36)}.example`
}

export function personEmail(plan: EntityPlan, domain: string | null): string {
  const local = `${plan.firstName ?? 'contact'}.${plan.lastName ?? 'person'}.${plan.index.toString(36)}`
  return `${local}@${domain ?? PERF_EMAIL_FALLBACK_DOMAIN}`.toLowerCase()
}

function optionValues(field: CustomFieldDefinition): Array<string | number | boolean> {
  return (field.options ?? []).map((option) => (typeof option === 'object' ? option.value : option))
}

function customFieldValue(rng: Rng, field: CustomFieldDefinition): string | number | boolean {
  switch (field.kind) {
    case 'select': {
      const options = optionValues(field)
      return options.length ? rng.pick(options) : rng.pick(TOPIC_WORDS)
    }
    case 'boolean':
      return rng.chance(0.5)
    case 'integer':
      return rng.int(1, 500)
    case 'float':
      return Math.round(rng.between(1, 1000) * 100) / 100
    case 'multiline':
      return sentence(rng, 8, 20)
    default:
      return `${capitalize(rng.pick(TOPIC_WORDS))} ${rng.pick(FILLER_WORDS)}`
  }
}

function draftCustomFields(
  rng: Rng,
  ctx: GeneratorContext,
  entityId: string,
  recordId: string,
  fields: readonly CustomFieldDefinition[],
  target: CustomFieldDraft[],
): void {
  for (const field of fields) {
    const filled = rng.chance(ctx.profile.customFieldFillRate)
    const value = customFieldValue(rng, field)
    if (filled) target.push({ entityId, recordId, fieldKey: field.key, value })
  }
}

type NextInteractionCandidate = {
  row: SqlRow
  scheduledAt: Date
  priority: number | null
  createdAt: Date
  id: string
}

function compareNextInteraction(left: NextInteractionCandidate, right: NextInteractionCandidate): number {
  const byDate = left.scheduledAt.getTime() - right.scheduledAt.getTime()
  if (byDate !== 0) return byDate
  if (left.priority !== right.priority) {
    if (left.priority === null) return 1
    if (right.priority === null) return -1
    return right.priority - left.priority
  }
  const byCreated = left.createdAt.getTime() - right.createdAt.getTime()
  if (byCreated !== 0) return byCreated
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function scopeColumns(ctx: GeneratorContext): { organization_id: string; tenant_id: string } {
  return { organization_id: ctx.scope.organizationId, tenant_id: ctx.scope.tenantId }
}

function buildAddress(
  rng: Rng,
  ctx: GeneratorContext,
  plan: EntityPlan,
  createdAt: Date,
): SqlRow {
  const geocoded = rng.chance(ctx.profile.geocodedRate)
  const latitude = Math.round(rng.between(49.2, 54.7) * 1e5) / 1e5
  const longitude = Math.round(rng.between(14.3, 24.0) * 1e5) / 1e5
  const purpose = pickDictionaryValue(rng, ctx.refs.dictionaries.addressType, ctx.profile.dictionaryZipfExponent)
  const flat = rng.chance(0.3) ? String(rng.int(1, 80)) : null
  return {
    id: seedRecordId(ctx, 'address', plan.index),
    ...scopeColumns(ctx),
    entity_id: plan.id,
    name: plan.kind === 'company' ? 'Headquarters' : 'Home',
    purpose,
    company_name: plan.kind === 'company' ? plan.displayName : null,
    address_line1: `${rng.pick(STREET_WORDS)} ${rng.int(1, 250)}`,
    address_line2: flat ? `lok. ${flat}` : null,
    city: `${rng.pick(CITY_HEADS)}${rng.pick(CITY_TAILS)}`,
    region: rng.pick(REGIONS),
    postal_code: `${pad(rng.int(0, 99), 2)}-${pad(rng.int(0, 999), 3)}`,
    country: 'PL',
    building_number: String(rng.int(1, 250)),
    flat_number: flat,
    latitude: geocoded ? latitude : null,
    longitude: geocoded ? longitude : null,
    is_primary: true,
    created_at: createdAt,
    updated_at: createdAt,
  }
}

function pickDistinctTags(rng: Rng, ctx: GeneratorContext, count: number): number[] {
  const weights = zipfWeights(ctx.refs.tagIds.length, ctx.profile.tagZipfExponent)
  const picked: number[] = []
  let attempts = 0
  while (picked.length < count && attempts < count * 20) {
    const candidate = rng.weighted(weights)
    if (!picked.includes(candidate)) picked.push(candidate)
    attempts += 1
  }
  return picked
}

function buildInteractions(
  ctx: GeneratorContext,
  plan: EntityPlan,
  entityCreatedAt: Date,
  dealIds: string[],
  rows: TableRows,
  customFields: CustomFieldDraft[],
): NextInteractionCandidate | null {
  const { profile, anchor } = ctx
  const rng = rngFor(ctx, 'interactions', plan.index)
  const typeWeights = profile.interactionTypes.map((entry) => entry.weight)
  const pastFloor = new Date(Math.max(entityCreatedAt.getTime(), daysBefore(anchor, profile.interactionPastDays).getTime()))
  let next: NextInteractionCandidate | null = null
  for (let ordinal = 0; ordinal < plan.interactionCount; ordinal += 1) {
    const id = seedRecordId(ctx, 'interaction', plan.index, ordinal)
    const interactionType = profile.interactionTypes[rng.weighted(typeWeights)].value
    const done = rng.chance(profile.interactionDoneRate)
    const title = `${rng.pick(ACTION_WORDS)} ${rng.pick(TOPIC_WORDS)}`
    const withBody = rng.chance(profile.interactionBodyRate)
    const body = sentence(rng, 6, 18)
    const pastDate = between(rng, pastFloor, anchor)
    const futureDate = between(rng, daysBefore(anchor, profile.interactionOverdueDays), daysAfter(anchor, profile.interactionFutureDays))
    const plannedCreatedAt = between(rng, daysBefore(anchor, 30), anchor)
    const ownerUserId = rng.chance(0.8) ? plan.ownerUserId : rng.pick(ctx.refs.owners)
    const linkDeal = dealIds.length > 0 && rng.chance(profile.interactionDealLinkRate)
    const dealId = linkDeal ? dealIds[rng.int(0, dealIds.length - 1)] : null
    const priority = interactionType === 'task' ? rng.int(1, 3) : null
    const durations = INTERACTION_DURATIONS[interactionType]
    const durationMinutes = durations ? rng.pick(durations) : null
    const appearance = ctx.refs.dictionaries.activityAppearance[interactionType] ?? { icon: null, color: null }
    const scheduledAt = done ? (durations || interactionType === 'task' ? pastDate : null) : futureDate
    const occurredAt = done ? pastDate : null
    const createdAt = done ? pastDate : new Date(Math.min(plannedCreatedAt.getTime(), futureDate.getTime()))
    const row: SqlRow = {
      id,
      ...scopeColumns(ctx),
      entity_id: plan.id,
      interaction_type: interactionType,
      title,
      body: withBody ? body : null,
      status: done ? 'done' : 'planned',
      scheduled_at: scheduledAt,
      occurred_at: occurredAt,
      priority,
      author_user_id: ownerUserId,
      owner_user_id: ownerUserId,
      appearance_icon: appearance.icon,
      appearance_color: appearance.color,
      source: null,
      deal_id: dealId,
      duration_minutes: durationMinutes,
      pinned: false,
      created_at: createdAt,
      updated_at: createdAt,
      deleted_at: null,
    }
    rows.customer_interactions.push(row)
    draftCustomFields(rng, ctx, CoreEntities.customers.customer_interaction, id, CUSTOMER_ACTIVITY_CUSTOM_FIELDS, customFields)
    if (!done && scheduledAt) {
      const candidate: NextInteractionCandidate = { row, scheduledAt, priority, createdAt, id }
      if (!next || compareNextInteraction(candidate, next) < 0) next = candidate
    }
  }
  return next
}

function buildDeals(
  ctx: GeneratorContext,
  plan: EntityPlan,
  entityCreatedAt: Date,
  rows: TableRows,
  customFields: CustomFieldDraft[],
): string[] {
  const { profile, anchor } = ctx
  const dealIds: string[] = []
  for (let ordinal = 0; ordinal < plan.dealCount; ordinal += 1) {
    const dealPlan = planDeal(ctx, plan.index, ordinal)
    const rng = rngFor(ctx, 'deal', plan.index, ordinal)
    const pipelineSpec = profile.pipelines[dealPlan.pipelineIndex]
    const pipelineRef = ctx.refs.pipelines[dealPlan.pipelineIndex]
    const stageSpec = pipelineSpec.stages[dealPlan.stageIndex]
    const stageRef = pipelineRef.stages[dealPlan.stageIndex]
    const terminal = stageSpec.terminal
    const lastOpenStage = rng.int(1, 3)
    const path: number[] = []
    if (terminal) {
      for (let stage = 0; stage <= lastOpenStage; stage += 1) path.push(stage)
      path.push(dealPlan.stageIndex)
    } else {
      for (let stage = 0; stage <= dealPlan.stageIndex; stage += 1) path.push(stage)
    }
    const stuck = rng.chance(profile.stuckRate)
    const createdCandidate = between(rng, new Date(Math.max(entityCreatedAt.getTime(), daysBefore(anchor, 720).getTime())), daysBefore(anchor, 1))
    const stuckAt = daysBefore(anchor, rng.between(profile.stuckMinDays, profile.stuckMaxDays))
    const freshAt = daysBefore(anchor, rng.between(0, profile.freshMaxDays))
    const closedAt = between(rng, createdCandidate, anchor)
    const lastAt = terminal ? closedAt : stuck ? stuckAt : freshAt
    const createdAt = new Date(Math.min(createdCandidate.getTime(), lastAt.getTime() - path.length * DAY_MS))
    const amount = rng.int(5, 250) * 1000 + rng.int(0, 999)
    const currency = profile.dealCurrencies[rng.weighted(profile.dealCurrencies.map((entry) => entry.weight))].code
    const expectedCloseAt = terminal ? lastAt : daysAfter(anchor, rng.between(7, 180))
    const topic = rng.pick(TOPIC_WORDS)
    const dealKind = rng.pick(DEAL_KINDS)
    const description = sentence(rng, 8, 20)
    const status = terminal === 'won' ? 'win' : terminal === 'lost' ? 'lost' : 'open'
    rows.customer_deals.push({
      id: dealPlan.id,
      ...scopeColumns(ctx),
      title: `${capitalize(topic)} ${dealKind} for ${plan.displayName}`,
      description,
      status,
      pipeline_stage: stageRef.name,
      pipeline_id: pipelineRef.id,
      pipeline_stage_id: stageRef.id,
      value_amount: `${amount}.00`,
      value_currency: currency,
      probability: stageSpec.probability,
      expected_close_at: expectedCloseAt,
      owner_user_id: plan.ownerUserId,
      source: null,
      closure_outcome: terminal,
      loss_reason_id: null,
      loss_notes: null,
      created_at: createdAt,
      updated_at: lastAt,
      deleted_at: null,
    })
    const span = lastAt.getTime() - createdAt.getTime()
    path.forEach((stageIndex, step) => {
      const stage = pipelineRef.stages[stageIndex]
      const fraction = path.length === 1 ? 1 : step / (path.length - 1)
      const transitionedAt = new Date(createdAt.getTime() + Math.floor(span * fraction))
      rows.customer_deal_stage_transitions.push({
        id: seedRecordId(ctx, 'transition', plan.index, ordinal, step),
        ...scopeColumns(ctx),
        deal_id: dealPlan.id,
        pipeline_id: pipelineRef.id,
        stage_id: stage.id,
        stage_label: stage.name,
        stage_order: stage.order,
        transitioned_at: transitionedAt,
        transitioned_by_user_id: plan.ownerUserId,
        is_active: true,
        created_at: transitionedAt,
        updated_at: transitionedAt,
        deleted_at: null,
      })
    })
    const companyEntityIndex = plan.kind === 'company' ? plan.index : plan.companyIndex
    if (plan.kind === 'person') {
      rows.customer_deal_people.push({
        id: seedRecordId(ctx, 'deal-person', plan.index, ordinal),
        deal_id: dealPlan.id,
        person_entity_id: plan.id,
        role: rng.pick(DEAL_ROLES),
        is_primary: true,
        created_at: createdAt,
      })
    }
    if (companyEntityIndex !== null) {
      rows.customer_deal_companies.push({
        id: seedRecordId(ctx, 'deal-company', plan.index, ordinal),
        deal_id: dealPlan.id,
        company_entity_id: seedRecordId(ctx, 'entity', companyEntityIndex),
        created_at: createdAt,
      })
    }
    const commentCount = rng.weighted(profile.commentCountWeights)
    for (let comment = 0; comment < commentCount; comment += 1) {
      const commentAt = between(rng, createdAt, anchor)
      rows.customer_comments.push({
        id: seedRecordId(ctx, 'comment', plan.index, ordinal, comment),
        ...scopeColumns(ctx),
        entity_id: plan.id,
        deal_id: dealPlan.id,
        body: sentence(rng, 6, 24),
        author_user_id: plan.ownerUserId,
        appearance_icon: null,
        appearance_color: null,
        created_at: commentAt,
        updated_at: commentAt,
        deleted_at: null,
      })
    }
    draftCustomFields(rng, ctx, CoreEntities.customers.customer_deal, dealPlan.id, CUSTOMER_DEAL_CUSTOM_FIELDS, customFields)
    dealIds.push(dealPlan.id)
  }
  return dealIds
}

export function buildEntityBundle(ctx: GeneratorContext, index: number): EntityBundle {
  const { profile, anchor, refs } = ctx
  const plan = planEntity(ctx, index)
  const rng = rngFor(ctx, 'entity', index)
  const rows = emptyTableRows()
  const customFields: CustomFieldDraft[] = []
  const createdAt = daysBefore(anchor, rng.between(30, profile.entityHistoryDays))
  const updatedAt = between(rng, createdAt, anchor)
  const status = pickDictionaryValue(rng, refs.dictionaries.status, profile.dictionaryZipfExponent)
  const lifecycleStage = pickDictionaryValue(rng, refs.dictionaries.lifecycleStage, profile.dictionaryZipfExponent)
  const source = pickDictionaryValue(rng, refs.dictionaries.source, profile.dictionaryZipfExponent)
  const temperature = pickDictionaryValue(rng, refs.dictionaries.temperature, profile.dictionaryZipfExponent)
  const withDescription = rng.chance(0.4)
  const description = sentence(rng, 6, 14)
  const phone = `+48 ${500 + (index % 400)} ${pad(rng.int(0, 999), 3)} ${pad(rng.int(0, 999), 3)}`
  const renewalQuarter = plan.kind === 'company' && rng.chance(0.5) ? rng.pick(RENEWAL_QUARTERS) : null
  const primaryCompanyPlan = plan.companyIndex !== null ? planEntity(ctx, plan.companyIndex) : null
  const domain = plan.kind === 'company' ? companyDomain(plan) : primaryCompanyPlan ? companyDomain(primaryCompanyPlan) : null
  const email = plan.kind === 'company' ? `hello@${domain}` : personEmail(plan, domain)

  const entityRow: SqlRow = {
    id: plan.id,
    ...scopeColumns(ctx),
    kind: plan.kind,
    display_name: plan.displayName,
    description: withDescription ? description : null,
    owner_user_id: plan.ownerUserId,
    primary_email: email,
    primary_phone: phone,
    status,
    lifecycle_stage: lifecycleStage,
    source,
    temperature,
    renewal_quarter: renewalQuarter,
    next_interaction_at: null,
    next_interaction_name: null,
    next_interaction_ref_id: null,
    next_interaction_icon: null,
    next_interaction_color: null,
    is_active: true,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
  }
  rows.customer_entities.push(entityRow)

  if (plan.kind === 'company') {
    const industry = rng.pick(INDUSTRIES)
    const sizeBucket = rng.pick(SIZE_BUCKETS)
    const revenue = rng.chance(0.6) ? `${rng.int(1, 500) * 100000}.00` : null
    const taxId = rng.chance(0.7) ? `PL${pad(rng.int(0, 9999999999), 10)}` : null
    rows.customer_companies.push({
      id: plan.profileId,
      ...scopeColumns(ctx),
      entity_id: plan.id,
      legal_name: plan.displayName,
      brand_name: `${plan.companyHead} ${plan.companyTail}`,
      domain,
      website_url: `https://www.${domain}`,
      industry,
      size_bucket: sizeBucket,
      annual_revenue: revenue,
      tax_id: taxId,
      created_at: createdAt,
      updated_at: updatedAt,
    })
    draftCustomFields(rng, ctx, CoreEntities.customers.customer_company_profile, plan.profileId, CUSTOMER_COMPANY_CUSTOM_FIELDS, customFields)
  } else {
    const handle = `${plan.firstName}${plan.lastName}${plan.index.toString(36)}`.toLowerCase()
    rows.customer_people.push({
      id: plan.profileId,
      ...scopeColumns(ctx),
      entity_id: plan.id,
      company_entity_id: primaryCompanyPlan ? primaryCompanyPlan.id : null,
      first_name: plan.firstName,
      last_name: plan.lastName,
      preferred_name: plan.firstName,
      job_title: rng.pick(JOB_TITLES),
      department: rng.pick(DEPARTMENTS),
      seniority: rng.pick(SENIORITY),
      timezone: rng.pick(TIMEZONES),
      linked_in_url: `https://www.linkedin.example/in/${handle}`,
      twitter_url: null,
      created_at: createdAt,
      updated_at: updatedAt,
    })
    draftCustomFields(rng, ctx, CoreEntities.customers.customer_person_profile, plan.profileId, CUSTOMER_PERSON_CUSTOM_FIELDS, customFields)
    const companyLinks: Array<{ index: number; primary: boolean }> = []
    if (plan.companyIndex !== null) companyLinks.push({ index: plan.companyIndex, primary: true })
    if (plan.extraCompanyIndex !== null) companyLinks.push({ index: plan.extraCompanyIndex, primary: false })
    companyLinks.forEach((link, ordinal) => {
      rows.customer_person_company_links.push({
        id: seedRecordId(ctx, 'person-company', plan.index, ordinal),
        ...scopeColumns(ctx),
        person_entity_id: plan.id,
        company_entity_id: seedRecordId(ctx, 'entity', link.index),
        is_primary: link.primary,
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
      })
    })
  }

  const withAddress = plan.kind === 'company' || rng.chance(profile.personAddressRate)
  if (withAddress) rows.customer_addresses.push(buildAddress(rng, ctx, plan, createdAt))

  const tagCount = Math.min(rng.weighted(profile.tagAssignmentWeights), refs.tagIds.length)
  pickDistinctTags(rng, ctx, tagCount).forEach((tagPosition) => {
    rows.customer_tag_assignments.push({
      id: seedRecordId(ctx, 'tag-assignment', plan.index, tagPosition),
      ...scopeColumns(ctx),
      tag_id: refs.tagIds[tagPosition],
      entity_id: plan.id,
      created_at: createdAt,
    })
  })

  const dealIds = buildDeals(ctx, plan, createdAt, rows, customFields)
  const next = buildInteractions(ctx, plan, createdAt, dealIds, rows, customFields)
  if (next) {
    const title = typeof next.row.title === 'string' && next.row.title.trim() !== '' ? next.row.title : String(next.row.interaction_type)
    entityRow.next_interaction_at = next.scheduledAt
    entityRow.next_interaction_name = title
    entityRow.next_interaction_ref_id = next.id
    entityRow.next_interaction_icon = next.row.appearance_icon
    entityRow.next_interaction_color = next.row.appearance_color
  }
  return { plan, rows, customFields }
}

export type GeneratedBatch = {
  rows: TableRows
  customFields: CustomFieldDraft[]
  plans: EntityPlan[]
}

export function buildBatch(ctx: GeneratorContext, start: number, end: number): GeneratedBatch {
  const rows = emptyTableRows()
  const customFields: CustomFieldDraft[] = []
  const plans: EntityPlan[] = []
  const tables = Object.keys(rows) as Array<keyof TableRows>
  for (let index = start; index < Math.min(end, ctx.entityCount); index += 1) {
    const bundle = buildEntityBundle(ctx, index)
    for (const table of tables) {
      const target = rows[table]
      for (const row of bundle.rows[table]) target.push(row)
    }
    for (const draft of bundle.customFields) customFields.push(draft)
    plans.push(bundle.plan)
  }
  return { rows, customFields, plans }
}

export const ENCRYPTION_ENTITY_BY_TABLE: Record<keyof TableRows, string> = {
  customer_entities: ENTITY_ID_CUSTOMER_ENTITY,
  customer_companies: CoreEntities.customers.customer_company_profile,
  customer_people: CoreEntities.customers.customer_person_profile,
  customer_person_company_links: CoreEntities.customers.customer_person_company_link,
  customer_addresses: CoreEntities.customers.customer_address,
  customer_tag_assignments: CoreEntities.customers.customer_tag_assignment,
  customer_deals: CoreEntities.customers.customer_deal,
  customer_deal_people: CoreEntities.customers.customer_deal_person_link,
  customer_deal_companies: CoreEntities.customers.customer_deal_company_link,
  customer_deal_stage_transitions: CoreEntities.customers.customer_deal_stage_transition,
  customer_comments: CoreEntities.customers.customer_comment,
  customer_interactions: CoreEntities.customers.customer_interaction,
}
