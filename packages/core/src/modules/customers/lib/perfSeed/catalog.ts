import { createHash } from 'node:crypto'
import { formatAnchorDate, heavyOwnerCount, planDeal, planEntity } from './generator'
import {
  COMPANY_HEADS,
  COMPANY_TAILS,
  DEPARTMENTS,
  FIRST_NAMES,
  JOB_TITLES,
  LAST_NAME_HEADS,
  NO_HIT_TERMS,
  UNIQUE_SURNAME_PREFIX,
  type InteractionBucket,
} from './profile'
import type { GeneratorContext, ManifestCounts } from './types'

export type SearchTerm = { term: string; expected: number }

export type PerfCatalog = {
  version: 1
  profile: string
  tier: string
  seed: number
  anchor: string
  tenantId: string
  organizationId: string
  people: Record<InteractionBucket, string[]>
  companies: Record<InteractionBucket, string[]>
  hotSet: { people: string[]; companies: string[] }
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string; order: number }> }>
  deals: { sample: string[]; byStage: Record<string, string[]> }
  tags: string[]
  owners: string[]
  heavyOwners: string[]
  searchTerms: {
    unique: SearchTerm[]
    common: SearchTerm[]
    prefix: SearchTerm[]
    noHit: SearchTerm[]
  }
  emailPrefixes: string[]
  dictionaries: { statuses: string[]; lifecycleStages: string[]; sources: string[] }
}

export type PerfManifest = {
  version: 1
  profile: string
  tier: string
  seed: number
  anchor: string
  tenantId: string
  organizationId: string
  counts: ManifestCounts
  checksum: string
  startedAt: string
  finishedAt: string
  durationMs: number
}

const UNIQUE_TERM_LIMIT = 50
const COMMON_FIRST_NAME_LIMIT = 15
const COMMON_LAST_NAME_LIMIT = 5
const PREFIX_TERM_LIMIT = 10
const EMAIL_PREFIX_LIMIT = 200

function emptyBuckets(): Record<InteractionBucket, string[]> {
  return { light: [], medium: [], heavy: [], extreme: [] }
}

function pushCapped<T>(target: T[], value: T, cap: number): void {
  if (target.length < cap) target.push(value)
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function topEntries(map: Map<string, number>, limit: number): SearchTerm[] {
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .slice(0, limit)
    .map(([term, expected]) => ({ term, expected }))
}

function prefixCollides(prefix: string): boolean {
  const lowered = prefix.toLowerCase()
  if (UNIQUE_SURNAME_PREFIX.toLowerCase().startsWith(lowered) || lowered.startsWith(UNIQUE_SURNAME_PREFIX.toLowerCase())) return true
  const otherWords = [
    ...FIRST_NAMES,
    ...COMPANY_HEADS,
    ...COMPANY_TAILS,
    ...DEPARTMENTS,
    ...JOB_TITLES.flatMap((title) => title.split(' ')),
  ]
  return otherWords.some((word) => word.toLowerCase().startsWith(lowered))
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function manifestChecksum(input: { profile: string; tier: string; seed: number; anchor: string; counts: ManifestCounts }): string {
  return createHash('sha256')
    .update(canonicalJson({ profile: input.profile, tier: input.tier, seed: input.seed, anchor: input.anchor, counts: input.counts }))
    .digest('hex')
}

export function buildManifest(
  ctx: GeneratorContext,
  counts: ManifestCounts,
  timing: { startedAt: string; finishedAt: Date },
): PerfManifest {
  const anchor = formatAnchorDate(ctx.anchor)
  const startedMs = Date.parse(timing.startedAt)
  return {
    version: 1,
    profile: ctx.profile.id,
    tier: ctx.tier,
    seed: ctx.seed,
    anchor,
    tenantId: ctx.scope.tenantId,
    organizationId: ctx.scope.organizationId,
    counts,
    checksum: manifestChecksum({ profile: ctx.profile.id, tier: ctx.tier, seed: ctx.seed, anchor, counts }),
    startedAt: timing.startedAt,
    finishedAt: timing.finishedAt.toISOString(),
    durationMs: Number.isFinite(startedMs) ? Math.max(0, timing.finishedAt.getTime() - startedMs) : 0,
  }
}

export function buildCatalog(ctx: GeneratorContext): PerfCatalog {
  const cap = ctx.profile.catalogCap
  const people = emptyBuckets()
  const companies = emptyBuckets()
  const hotPeople: string[] = []
  const hotCompanies: string[] = []
  const dealSample: string[] = []
  const byStage: Record<string, string[]> = {}
  const firstNameCounts = new Map<string, number>()
  const lastNameCounts = new Map<string, number>()
  const uniqueTerms: SearchTerm[] = []
  const emailPrefixes = new Set<string>()
  for (const pipeline of ctx.refs.pipelines) {
    for (const stage of pipeline.stages) byStage[stage.id] = []
  }

  for (let index = 0; index < ctx.entityCount; index += 1) {
    const plan = planEntity(ctx, index)
    if (plan.kind === 'person') {
      pushCapped(people[plan.bucket], plan.id, cap)
      if (plan.bucket === 'medium') pushCapped(hotPeople, plan.id, ctx.profile.hotSetPeople)
      if (plan.firstName) increment(firstNameCounts, plan.firstName)
      if (plan.lastName && !plan.uniqueSurname) increment(lastNameCounts, plan.lastName)
      if (plan.uniqueSurname && plan.lastName) pushCapped(uniqueTerms, { term: plan.lastName, expected: 1 }, UNIQUE_TERM_LIMIT)
      if (!plan.uniqueSurname && emailPrefixes.size < EMAIL_PREFIX_LIMIT) {
        emailPrefixes.add(`${plan.firstName}.${plan.lastName}`.toLowerCase())
      }
    } else {
      pushCapped(companies[plan.bucket], plan.id, cap)
      if (plan.bucket === 'medium') pushCapped(hotCompanies, plan.id, ctx.profile.hotSetCompanies)
    }
    for (let ordinal = 0; ordinal < plan.dealCount; ordinal += 1) {
      const deal = planDeal(ctx, index, ordinal)
      pushCapped(dealSample, deal.id, cap)
      const stage = ctx.refs.pipelines[deal.pipelineIndex]?.stages[deal.stageIndex]
      if (stage) pushCapped(byStage[stage.id], deal.id, cap)
    }
  }

  const prefixTerms: SearchTerm[] = []
  for (const head of LAST_NAME_HEADS) {
    if (prefixTerms.length >= PREFIX_TERM_LIMIT) break
    if (prefixCollides(head)) continue
    const lowered = head.toLowerCase()
    let expected = 0
    for (const [name, count] of lastNameCounts) {
      if (name.toLowerCase().startsWith(lowered)) expected += count
    }
    for (const [name, count] of firstNameCounts) {
      if (name.toLowerCase().startsWith(lowered)) expected += count
    }
    prefixTerms.push({ term: head, expected })
  }

  const owners = ctx.refs.owners.slice(0, cap)
  return {
    version: 1,
    profile: ctx.profile.id,
    tier: ctx.tier,
    seed: ctx.seed,
    anchor: formatAnchorDate(ctx.anchor),
    tenantId: ctx.scope.tenantId,
    organizationId: ctx.scope.organizationId,
    people,
    companies,
    hotSet: { people: hotPeople, companies: hotCompanies },
    pipelines: ctx.refs.pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name, order: stage.order })),
    })),
    deals: { sample: dealSample, byStage },
    tags: ctx.refs.tagIds.slice(0, cap),
    owners,
    heavyOwners: ctx.refs.owners.slice(0, heavyOwnerCount(ctx.profile, ctx.refs.owners.length)),
    searchTerms: {
      unique: uniqueTerms,
      common: [...topEntries(firstNameCounts, COMMON_FIRST_NAME_LIMIT), ...topEntries(lastNameCounts, COMMON_LAST_NAME_LIMIT)],
      prefix: prefixTerms,
      noHit: NO_HIT_TERMS.map((term) => ({ term, expected: 0 })),
    },
    emailPrefixes: Array.from(emailPrefixes).slice(0, cap),
    dictionaries: {
      statuses: [...ctx.refs.dictionaries.status],
      lifecycleStages: [...ctx.refs.dictionaries.lifecycleStage],
      sources: [...ctx.refs.dictionaries.source],
    },
  }
}
