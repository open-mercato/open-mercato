import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerDictionaryEntry, CustomerPipeline, CustomerPipelineStage, CustomerTag } from '../../data/entities'
import {
  ACTIVITY_TYPE_DEFAULTS,
  ADDRESS_TYPE_DEFAULTS,
  ENTITY_LIFECYCLE_STAGE_DEFAULTS,
  ENTITY_SOURCE_DEFAULTS,
  ENTITY_STATUS_DEFAULTS,
  TEMPERATURE_DEFAULTS,
} from '../dictionaryDefaults'
import { deterministicUuid } from './prng'
import { TAG_COLORS, TAG_KINDS, TAG_WORDS, type PerfProfile } from './profile'
import type { AppearanceRef, PipelineRef, SeedDictionaries, SeedScope } from './types'

export function perfTagSlugs(profile: PerfProfile): string[] {
  return Array.from({ length: profile.tagCount }, (_, position) => `perf-tag-${String(position + 1).padStart(2, '0')}`)
}

export function perfTagLabel(position: number): string {
  const kind = TAG_KINDS[Math.floor(position / TAG_WORDS.length) % TAG_KINDS.length]
  const word = TAG_WORDS[position % TAG_WORDS.length]
  const cycle = Math.floor(position / (TAG_WORDS.length * TAG_KINDS.length))
  return cycle > 0 ? `${kind} ${word} ${cycle + 1}` : `${kind} ${word}`
}

export async function ensurePerfPipelines(em: EntityManager, scope: SeedScope, profile: PerfProfile): Promise<PipelineRef[]> {
  const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const refs: PipelineRef[] = []
  for (const spec of profile.pipelines) {
    let pipeline = await findOneWithDecryption(
      em,
      CustomerPipeline,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, name: spec.name },
      {},
      decryptionScope,
    )
    if (!pipeline) {
      pipeline = em.create(CustomerPipeline, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: spec.name,
        isDefault: false,
      })
      em.persist(pipeline)
      await em.flush()
    }
    let stages = await findWithDecryption(
      em,
      CustomerPipelineStage,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, pipelineId: pipeline.id },
      { orderBy: { order: 'ASC' } },
      decryptionScope,
    )
    if (!stages.length) {
      stages = spec.stages.map((stage, order) =>
        em.create(CustomerPipelineStage, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          pipelineId: pipeline.id,
          label: stage.name,
          order,
          defaultProbability: stage.probability,
        }),
      )
      em.persist(stages)
      await em.flush()
    }
    const labels = stages.map((stage) => stage.label)
    const expected = spec.stages.map((stage) => stage.name)
    if (labels.length !== expected.length || labels.some((label, position) => label !== expected[position])) {
      throw new Error(`[internal] Pipeline "${spec.name}" exists with unexpected stages (${labels.join(', ')}); expected ${expected.join(', ')}`)
    }
    refs.push({
      id: pipeline.id,
      name: pipeline.name,
      stages: stages.map((stage) => ({ id: stage.id, name: stage.label, order: stage.order })),
    })
  }
  await makeFirstPipelineDefault(em, scope, refs)
  return refs
}

async function makeFirstPipelineDefault(em: EntityManager, scope: SeedScope, refs: PipelineRef[]): Promise<void> {
  const primaryId = refs[0]?.id
  if (!primaryId) return
  const pipelines = await findWithDecryption(
    em,
    CustomerPipeline,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  let changed = false
  for (const pipeline of pipelines) {
    const shouldBeDefault = pipeline.id === primaryId
    if (pipeline.isDefault !== shouldBeDefault) {
      pipeline.isDefault = shouldBeDefault
      changed = true
    }
  }
  if (changed) await em.flush()
}

export async function ensurePerfTags(em: EntityManager, scope: SeedScope, profile: PerfProfile): Promise<string[]> {
  const slugs = perfTagSlugs(profile)
  const existing = await findWithDecryption(
    em,
    CustomerTag,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, slug: { $in: slugs } },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const bySlug = new Map(existing.map((tag) => [tag.slug, tag]))
  const created: CustomerTag[] = []
  slugs.forEach((slug, position) => {
    if (bySlug.has(slug)) return
    const tag = em.create(CustomerTag, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      slug,
      label: perfTagLabel(position),
      color: TAG_COLORS[position % TAG_COLORS.length],
      description: null,
    })
    created.push(tag)
    bySlug.set(slug, tag)
  })
  if (created.length) {
    em.persist(created)
    await em.flush()
  }
  return slugs.map((slug) => {
    const tag = bySlug.get(slug)
    if (!tag) throw new Error(`[internal] Tag ${slug} could not be resolved`)
    return tag.id
  })
}

const DICTIONARY_KINDS = ['status', 'lifecycle_stage', 'source', 'temperature', 'address_type', 'activity_type'] as const

function orderDictionaryValues(available: readonly string[], defaults: ReadonlyArray<{ value: string }>): string[] {
  const remaining = new Set(available)
  const ordered: string[] = []
  for (const entry of defaults) {
    if (remaining.delete(entry.value)) ordered.push(entry.value)
  }
  return [...ordered, ...Array.from(remaining).sort()]
}

export async function loadSeedDictionaries(em: EntityManager, scope: SeedScope): Promise<SeedDictionaries> {
  const entries = await findWithDecryption(
    em,
    CustomerDictionaryEntry,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, kind: { $in: [...DICTIONARY_KINDS] } },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const valuesByKind = new Map<string, string[]>()
  const activityAppearance: Record<string, AppearanceRef> = {}
  for (const entry of entries) {
    const list = valuesByKind.get(entry.kind) ?? []
    list.push(entry.value)
    valuesByKind.set(entry.kind, list)
    if (entry.kind === 'activity_type') activityAppearance[entry.value] = { icon: entry.icon ?? null, color: entry.color ?? null }
  }
  return {
    status: orderDictionaryValues(valuesByKind.get('status') ?? [], ENTITY_STATUS_DEFAULTS),
    lifecycleStage: orderDictionaryValues(valuesByKind.get('lifecycle_stage') ?? [], ENTITY_LIFECYCLE_STAGE_DEFAULTS),
    source: orderDictionaryValues(valuesByKind.get('source') ?? [], ENTITY_SOURCE_DEFAULTS),
    temperature: orderDictionaryValues(valuesByKind.get('temperature') ?? [], TEMPERATURE_DEFAULTS),
    addressType: orderDictionaryValues(valuesByKind.get('address_type') ?? [], ADDRESS_TYPE_DEFAULTS),
    activityAppearance,
  }
}

export function defaultSeedDictionaries(): SeedDictionaries {
  const activityAppearance: Record<string, AppearanceRef> = {}
  for (const entry of ACTIVITY_TYPE_DEFAULTS) activityAppearance[entry.value] = { icon: entry.icon ?? null, color: entry.color ?? null }
  return {
    status: ENTITY_STATUS_DEFAULTS.map((entry) => entry.value),
    lifecycleStage: ENTITY_LIFECYCLE_STAGE_DEFAULTS.map((entry) => entry.value),
    source: ENTITY_SOURCE_DEFAULTS.map((entry) => entry.value),
    temperature: TEMPERATURE_DEFAULTS.map((entry) => entry.value),
    addressType: ADDRESS_TYPE_DEFAULTS.map((entry) => entry.value),
    activityAppearance,
  }
}

export function placeholderPipelines(profile: PerfProfile, namespace: string): PipelineRef[] {
  return profile.pipelines.map((spec, pipelineIndex) => ({
    id: deterministicUuid(namespace, 'pipeline', pipelineIndex),
    name: spec.name,
    stages: spec.stages.map((stage, order) => ({
      id: deterministicUuid(namespace, 'stage', pipelineIndex, order),
      name: stage.name,
      order,
    })),
  }))
}

export function placeholderIds(namespace: string, kind: string, count: number): string[] {
  return Array.from({ length: count }, (_, position) => deterministicUuid(namespace, kind, position))
}
