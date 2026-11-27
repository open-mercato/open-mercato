import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import { E as CoreEntities } from '#generated/entities.ids.generated'
import { buildCatalog, buildManifest } from './catalog'
import { createRowEncryptor, loadCustomFieldDefIndex, type RowEncryptor } from './encryption'
import { ENCRYPTION_ENTITY_BY_TABLE, buildBatch, parseAnchorDate, resolveEntityCount, seedRecordId, type GeneratedBatch } from './generator'
import { insertRows, loadTableColumns, type PerfSeedDatabase, type PerfSeedDb } from './insert'
import { parseSeedPerfOptions, readOwnersFile, SEED_PERF_USAGE, type SeedPerfOptions } from './options'
import { PERF_PROFILES, type PerfProfile } from './profile'
import {
  defaultSeedDictionaries,
  ensurePerfPipelines,
  ensurePerfTags,
  loadSeedDictionaries,
  perfTagSlugs,
  placeholderIds,
  placeholderPipelines,
} from './setup'
import {
  advanceState,
  createInitialState,
  decideResume,
  pendingBatchRanges,
  readSeedState,
  writeJsonAtomic,
  writeSeedState,
  type SeedIdentity,
  type SeedState,
} from './state'
import { SEED_TABLES, emptyManifestCounts, type GeneratorContext, type ManifestCounts, type SeedScope } from './types'
import { captureTableCounts, verifySeed } from './verify'

export const SEED_PERF_EXIT = {
  ok: 0,
  usage: 2,
  verifyFailed: 3,
  resumable: 4,
} as const

export type PerfSeedDeps = {
  createContainer: () => Promise<AppContainer>
  seedDictionaries: (em: EntityManager, scope: SeedScope) => Promise<void>
  ensureCustomFieldDefinitions: (em: EntityManager, tenantId: string) => Promise<void>
  writeLine: (line: string) => void
  writeError: (line: string) => void
  now?: () => Date
  cwd?: string
}

const CUSTOM_FIELD_ENTITY_IDS = [
  CoreEntities.customers.customer_person_profile,
  CoreEntities.customers.customer_company_profile,
  CoreEntities.customers.customer_deal,
  CoreEntities.customers.customer_interaction,
]

const DRY_RUN_OWNER_COUNT = 200

export function batchCounts(batch: GeneratedBatch, customFieldRows: number): Partial<ManifestCounts> {
  const { rows } = batch
  return {
    customer_entities: rows.customer_entities.length,
    customer_people: rows.customer_people.length,
    customer_companies: rows.customer_companies.length,
    customer_interactions: rows.customer_interactions.length,
    customer_deals: rows.customer_deals.length,
    customer_deal_people: rows.customer_deal_people.length,
    customer_deal_companies: rows.customer_deal_companies.length,
    customer_deal_stage_transitions: rows.customer_deal_stage_transitions.length,
    customer_comments: rows.customer_comments.length,
    customer_addresses: rows.customer_addresses.length,
    customer_tag_assignments: rows.customer_tag_assignments.length,
    customer_person_company_links: rows.customer_person_company_links.length,
    custom_field_values: customFieldRows,
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}m` : minutes > 0 ? `${minutes}m${String(rest).padStart(2, '0')}s` : `${rest}s`
}

export function formatProgressLine(input: {
  done: number
  total: number
  counts: ManifestCounts
  elapsedMs: number
  processedThisRun: number
}): string {
  const percent = input.total ? ((input.done / input.total) * 100).toFixed(1) : '100.0'
  const rate = input.elapsedMs > 0 ? (input.processedThisRun / input.elapsedMs) * 1000 : 0
  const remaining = rate > 0 ? ((input.total - input.done) / rate) * 1000 : 0
  return [
    `[seed-perf] entities ${input.done}/${input.total} (${percent}%)`,
    `interactions ${input.counts.customer_interactions}`,
    `deals ${input.counts.customer_deals}`,
    `cf ${input.counts.custom_field_values}`,
    `${rate.toFixed(0)} entities/s`,
    `eta ${formatDuration(remaining)}`,
  ].join(' | ')
}

function identityFor(options: SeedPerfOptions, entityCount: number): SeedIdentity {
  return {
    profile: options.profile,
    tier: options.tier,
    seed: options.seed,
    anchor: options.anchor,
    scale: options.scale,
    tenantId: options.tenantId,
    organizationId: options.organizationId,
    entityCount,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runDryRun(options: SeedPerfOptions, profile: PerfProfile, deps: PerfSeedDeps): Promise<number> {
  const scope = { tenantId: options.tenantId, organizationId: options.organizationId }
  const namespace = `dry-run|${options.profile}|${options.seed}`
  const owners = options.ownersFile ? await readOwnersFile(options.ownersFile) : placeholderIds(namespace, 'owner', DRY_RUN_OWNER_COUNT)
  const entityCount = resolveEntityCount(profile, options.tier, options.scale)
  const ctx: GeneratorContext = {
    profile,
    tier: options.tier,
    seed: options.seed,
    anchor: parseAnchorDate(options.anchor),
    scope,
    entityCount,
    refs: {
      owners,
      pipelines: placeholderPipelines(profile, namespace),
      tagIds: placeholderIds(namespace, 'tag', profile.tagCount),
      dictionaries: defaultSeedDictionaries(),
    },
  }
  let counts = emptyManifestCounts()
  counts.customer_tags = profile.tagCount
  for (let start = 0; start < entityCount; start += options.batch) {
    const batch = buildBatch(ctx, start, start + options.batch)
    const delta = batchCounts(batch, batch.customFields.length)
    const next = { ...counts }
    for (const [key, value] of Object.entries(delta) as Array<[keyof ManifestCounts, number]>) next[key] += value
    counts = next
  }
  deps.writeLine(`[seed-perf] dry run: profile=${options.profile} tier=${options.tier} scale=${options.scale} seed=${options.seed} anchor=${options.anchor}`)
  for (const [key, value] of Object.entries(counts)) deps.writeLine(`[seed-perf]   ${key}: ${value}`)
  return SEED_PERF_EXIT.ok
}

function resolveEncryptionService(container: AppContainer, em: EntityManager): TenantDataEncryptionService | null {
  try {
    if (container.hasRegistration('tenantEncryptionService')) {
      return container.resolve('tenantEncryptionService') as TenantDataEncryptionService
    }
  } catch {
    return resolveTenantEncryptionService(em)
  }
  return resolveTenantEncryptionService(em)
}

async function insertBatch(db: PerfSeedDb, encryptor: RowEncryptor, batch: GeneratedBatch): Promise<number> {
  const encrypted = new Map<string, Awaited<ReturnType<RowEncryptor['encryptRows']>>>()
  for (const table of SEED_TABLES) {
    encrypted.set(table, await encryptor.encryptRows(ENCRYPTION_ENTITY_BY_TABLE[table], table, batch.rows[table]))
  }
  const customFieldRows = await encryptor.buildCustomFieldRows(batch.customFields)
  await db.transaction().execute(async (trx) => {
    for (const table of SEED_TABLES) await insertRows(trx, table, encrypted.get(table) ?? [])
    await insertRows(trx, 'custom_field_values', customFieldRows)
  })
  return customFieldRows.length
}

export async function runPerfSeed(argv: readonly string[], deps: PerfSeedDeps): Promise<number> {
  const now = deps.now ?? (() => new Date())
  const parsed = parseSeedPerfOptions(argv, now(), deps.cwd ?? process.cwd())
  if (!parsed.ok) {
    deps.writeError(`[seed-perf] ${parsed.message}`)
    deps.writeError(SEED_PERF_USAGE)
    return SEED_PERF_EXIT.usage
  }
  const options = parsed.options
  const profile = PERF_PROFILES[options.profile]
  try {
    parseAnchorDate(options.anchor)
  } catch {
    deps.writeError(`[seed-perf] --anchor: invalid date ${options.anchor}`)
    return SEED_PERF_EXIT.usage
  }

  if (options.dryRun) {
    try {
      return await runDryRun(options, profile, deps)
    } catch (error) {
      deps.writeError(`[seed-perf] dry run failed: ${errorMessage(error)}`)
      return SEED_PERF_EXIT.usage
    }
  }

  let owners: string[]
  try {
    owners = await readOwnersFile(options.ownersFile ?? '')
  } catch (error) {
    deps.writeError(`[seed-perf] cannot read --owners-file: ${errorMessage(error)}`)
    return SEED_PERF_EXIT.usage
  }

  const entityCount = resolveEntityCount(profile, options.tier, options.scale)
  const identity = identityFor(options, entityCount)
  const existing = await readSeedState(options.outDir)
  const decision = decideResume(existing, identity, options.resume)
  if (decision.kind === 'error') {
    deps.writeError(`[seed-perf] ${decision.message}`)
    return SEED_PERF_EXIT.usage
  }
  if (decision.kind === 'fresh' && decision.notice) deps.writeLine(`[seed-perf] ${decision.notice}`)

  const scope: SeedScope = { tenantId: options.tenantId, organizationId: options.organizationId }
  const container = await deps.createContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const db = em.getKysely<PerfSeedDatabase>()
  const encryptionService = resolveEncryptionService(container, em)
  const encryptionActive = Boolean(isTenantDataEncryptionEnabled() && encryptionService?.isEnabled())
  deps.writeLine(
    `[seed-perf] profile=${options.profile} tier=${options.tier} scale=${options.scale} entities=${entityCount} seed=${options.seed} anchor=${options.anchor} encryption=${encryptionActive ? 'on' : 'off'} out=${options.outDir}`,
  )

  let state: SeedState
  let ctx: GeneratorContext
  let customFieldDefs: Awaited<ReturnType<typeof loadCustomFieldDefIndex>>
  let encryptor: RowEncryptor
  try {
    const baseline = decision.kind === 'resume' ? decision.state.baseline : await captureTableCounts(db, { scope })
    await em.transactional(async (transactionalEm) => {
      await deps.seedDictionaries(transactionalEm, scope)
    })
    await deps.ensureCustomFieldDefinitions(em, scope.tenantId)
    const pipelines = await ensurePerfPipelines(em, scope, profile)
    const tagIds = await ensurePerfTags(em, scope, profile)
    const dictionaries = await loadSeedDictionaries(em, scope)
    customFieldDefs = await loadCustomFieldDefIndex(em, scope, CUSTOM_FIELD_ENTITY_IDS)
    const tableColumns = await loadTableColumns(db, [...SEED_TABLES, 'custom_field_values'])
    ctx = {
      profile,
      tier: options.tier,
      seed: options.seed,
      anchor: parseAnchorDate(options.anchor),
      scope,
      entityCount,
      refs: { owners, pipelines, tagIds, dictionaries },
    }
    encryptor = createRowEncryptor({
      service: encryptionService,
      em,
      scope,
      tableColumns,
      customFieldDefs,
      customFieldRowId: (draft) => seedRecordId(ctx, 'cf', draft.entityId, draft.recordId, draft.fieldKey),
      createdAt: ctx.anchor,
    })
    if (decision.kind === 'resume') {
      state = decision.state
      deps.writeLine(`[seed-perf] resuming at entity ${state.nextEntityIndex}/${entityCount}`)
    } else {
      state = createInitialState(identity, baseline, now())
      state.counts.customer_tags = profile.tagCount
      await writeSeedState(options.outDir, state)
    }
  } catch (error) {
    deps.writeError(`[seed-perf] setup failed: ${errorMessage(error)}`)
    return SEED_PERF_EXIT.resumable
  }

  const startedAtMs = now().getTime()
  let processedThisRun = 0
  try {
    for (const { start, end } of pendingBatchRanges(state.nextEntityIndex, entityCount, options.batch)) {
      const batch = buildBatch(ctx, start, end)
      const customFieldRows = await insertBatch(db, encryptor, batch)
      state = advanceState(state, end, batchCounts(batch, customFieldRows), now())
      await writeSeedState(options.outDir, state)
      processedThisRun += end - start
      deps.writeLine(
        formatProgressLine({ done: end, total: entityCount, counts: state.counts, elapsedMs: now().getTime() - startedAtMs, processedThisRun }),
      )
    }
    if (!state.insertFinishedAt) {
      state = { ...state, insertFinishedAt: now().toISOString() }
      await writeSeedState(options.outDir, state)
    }
  } catch (error) {
    deps.writeError(`[seed-perf] insert failed at entity ${state.nextEntityIndex}: ${errorMessage(error)}`)
    deps.writeError('[seed-perf] re-run the same command with --resume to continue from the checkpoint')
    return SEED_PERF_EXIT.resumable
  }

  for (const column of encryptor.droppedColumns()) {
    deps.writeLine(`[seed-perf] warning: encryption produced column ${column} that does not exist in the table; it was not written`)
  }

  try {
    const manifest = buildManifest(ctx, state.counts, { startedAt: state.startedAt, finishedAt: now() })
    await writeJsonAtomic(path.join(options.outDir, 'manifest.json'), manifest)
    await writeJsonAtomic(path.join(options.outDir, 'catalog.json'), buildCatalog(ctx))
    deps.writeLine(`[seed-perf] wrote manifest.json and catalog.json to ${options.outDir}`)
  } catch (error) {
    deps.writeError(`[seed-perf] writing manifest/catalog failed: ${errorMessage(error)}`)
    return SEED_PERF_EXIT.resumable
  }

  let result: Awaited<ReturnType<typeof verifySeed>>
  try {
    result = await verifySeed({
      ctx,
      db,
      em: em.fork(),
      service: encryptionService,
      customFieldDefs,
      expected: state.counts,
      baseline: state.baseline,
      tagSlugs: perfTagSlugs(profile),
    })
  } catch (error) {
    deps.writeError(`[seed-perf] verification could not run: ${errorMessage(error)}`)
    return SEED_PERF_EXIT.verifyFailed
  }
  if (!result.ok) {
    deps.writeError(`[seed-perf] verification failed (${result.failures.length} problems):`)
    for (const failure of result.failures.slice(0, 50)) deps.writeError(`[seed-perf]   ${failure}`)
    return SEED_PERF_EXIT.verifyFailed
  }
  deps.writeLine(`[seed-perf] verification passed (${result.checked.counts} table counts, ${result.checked.rows} sampled rows)`)
  deps.writeLine(`[seed-perf] next: yarn mercato search reindex --tenant ${scope.tenantId} --org ${scope.organizationId} --force`)
  return SEED_PERF_EXIT.ok
}
