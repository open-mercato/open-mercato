import type { InteractionBucket, PerfProfile, PerfTier } from './profile'

export type SqlValue = string | number | boolean | Date | null
export type SqlRow = Record<string, SqlValue>

export type SeedScope = {
  tenantId: string
  organizationId: string
}

export type PipelineStageRef = {
  id: string
  name: string
  order: number
}

export type PipelineRef = {
  id: string
  name: string
  stages: PipelineStageRef[]
}

export type AppearanceRef = {
  icon: string | null
  color: string | null
}

export type SeedDictionaries = {
  status: string[]
  lifecycleStage: string[]
  source: string[]
  temperature: string[]
  addressType: string[]
  activityAppearance: Record<string, AppearanceRef>
}

export type SeedRefs = {
  owners: string[]
  pipelines: PipelineRef[]
  tagIds: string[]
  dictionaries: SeedDictionaries
}

export type GeneratorContext = {
  profile: PerfProfile
  tier: PerfTier
  seed: number
  anchor: Date
  scope: SeedScope
  entityCount: number
  refs: SeedRefs
}

export type EntityKind = 'person' | 'company'

export type EntityPlan = {
  index: number
  id: string
  profileId: string
  kind: EntityKind
  companyIndex: number | null
  extraCompanyIndex: number | null
  bucket: InteractionBucket
  interactionCount: number
  dealCount: number
  ownerUserId: string
  firstName: string | null
  lastName: string | null
  uniqueSurname: boolean
  companyHead: string | null
  companyTail: string | null
  displayName: string
}

export type DealPlan = {
  entityIndex: number
  ordinal: number
  id: string
  pipelineIndex: number
  stageIndex: number
}

export type CustomFieldDraft = {
  entityId: string
  recordId: string
  fieldKey: string
  value: string | number | boolean
}

export const SEED_TABLES = [
  'customer_entities',
  'customer_companies',
  'customer_people',
  'customer_person_company_links',
  'customer_addresses',
  'customer_tag_assignments',
  'customer_deals',
  'customer_deal_people',
  'customer_deal_companies',
  'customer_deal_stage_transitions',
  'customer_comments',
  'customer_interactions',
] as const

export type SeedTable = (typeof SEED_TABLES)[number]

export type TableRows = Record<SeedTable, SqlRow[]>

export type EntityBundle = {
  plan: EntityPlan
  rows: TableRows
  customFields: CustomFieldDraft[]
}

export const MANIFEST_COUNT_KEYS = [
  'customer_entities',
  'customer_people',
  'customer_companies',
  'customer_interactions',
  'customer_deals',
  'customer_deal_people',
  'customer_deal_companies',
  'customer_deal_stage_transitions',
  'customer_comments',
  'customer_addresses',
  'customer_tags',
  'customer_tag_assignments',
  'customer_person_company_links',
  'custom_field_values',
] as const

export type ManifestCountKey = (typeof MANIFEST_COUNT_KEYS)[number]
export type ManifestCounts = Record<ManifestCountKey, number>

export function emptyTableRows(): TableRows {
  return {
    customer_entities: [],
    customer_companies: [],
    customer_people: [],
    customer_person_company_links: [],
    customer_addresses: [],
    customer_tag_assignments: [],
    customer_deals: [],
    customer_deal_people: [],
    customer_deal_companies: [],
    customer_deal_stage_transitions: [],
    customer_comments: [],
    customer_interactions: [],
  }
}

export function emptyManifestCounts(): ManifestCounts {
  return {
    customer_entities: 0,
    customer_people: 0,
    customer_companies: 0,
    customer_interactions: 0,
    customer_deals: 0,
    customer_deal_people: 0,
    customer_deal_companies: 0,
    customer_deal_stage_transitions: 0,
    customer_comments: 0,
    customer_addresses: 0,
    customer_tags: 0,
    customer_tag_assignments: 0,
    customer_person_company_links: 0,
    custom_field_values: 0,
  }
}
