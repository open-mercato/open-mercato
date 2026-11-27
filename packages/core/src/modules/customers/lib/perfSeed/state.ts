import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { MANIFEST_COUNT_KEYS, emptyManifestCounts, type ManifestCounts } from './types'

export const STATE_FILE_NAME = 'seed-state.json'

const countsSchema = z.object(
  Object.fromEntries(MANIFEST_COUNT_KEYS.map((key) => [key, z.number().int().nonnegative()])) as Record<
    (typeof MANIFEST_COUNT_KEYS)[number],
    z.ZodNumber
  >,
)

export const seedIdentitySchema = z.object({
  profile: z.string(),
  tier: z.string(),
  seed: z.number().int(),
  anchor: z.string(),
  scale: z.number(),
  tenantId: z.string(),
  organizationId: z.string(),
  entityCount: z.number().int().positive(),
})

export type SeedIdentity = z.infer<typeof seedIdentitySchema>

export const seedStateSchema = z.object({
  version: z.literal(1),
  identity: seedIdentitySchema,
  nextEntityIndex: z.number().int().nonnegative(),
  counts: countsSchema,
  baseline: countsSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  insertFinishedAt: z.string().nullable(),
})

export type SeedState = z.infer<typeof seedStateSchema>

export type ResumeDecision =
  | { kind: 'fresh'; notice: string | null }
  | { kind: 'resume'; state: SeedState }
  | { kind: 'error'; message: string }

const IDENTITY_KEYS: Array<keyof SeedIdentity> = ['profile', 'tier', 'seed', 'anchor', 'scale', 'tenantId', 'organizationId', 'entityCount']

export function describeIdentityMismatch(saved: SeedIdentity, requested: SeedIdentity): string[] {
  return IDENTITY_KEYS.filter((key) => saved[key] !== requested[key]).map(
    (key) => `${key}: checkpoint=${String(saved[key])} requested=${String(requested[key])}`,
  )
}

export function decideResume(existing: SeedState | null, requested: SeedIdentity, resume: boolean): ResumeDecision {
  if (!existing) {
    return {
      kind: 'fresh',
      notice: resume ? 'No checkpoint found in the output directory; starting a fresh run.' : null,
    }
  }
  if (!resume) {
    return {
      kind: 'error',
      message: 'A checkpoint already exists in the output directory. Pass --resume to continue it, or use a different --out-dir.',
    }
  }
  const mismatches = describeIdentityMismatch(existing.identity, requested)
  if (mismatches.length) {
    return { kind: 'error', message: `Checkpoint does not match the requested run (${mismatches.join('; ')}).` }
  }
  return { kind: 'resume', state: existing }
}

export function createInitialState(identity: SeedIdentity, baseline: ManifestCounts, now: Date): SeedState {
  const timestamp = now.toISOString()
  return {
    version: 1,
    identity,
    nextEntityIndex: 0,
    counts: emptyManifestCounts(),
    baseline,
    startedAt: timestamp,
    updatedAt: timestamp,
    insertFinishedAt: null,
  }
}

export function advanceState(state: SeedState, nextEntityIndex: number, batchCounts: Partial<ManifestCounts>, now: Date): SeedState {
  const counts: ManifestCounts = { ...state.counts }
  for (const key of MANIFEST_COUNT_KEYS) counts[key] += batchCounts[key] ?? 0
  return { ...state, nextEntityIndex, counts, updatedAt: now.toISOString() }
}

export function pendingBatchRanges(nextEntityIndex: number, entityCount: number, batchSize: number): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  for (let start = Math.max(0, nextEntityIndex); start < entityCount; start += batchSize) {
    ranges.push({ start, end: Math.min(entityCount, start + batchSize) })
  }
  return ranges
}

export async function readSeedState(outDir: string): Promise<SeedState | null> {
  const filePath = path.join(outDir, STATE_FILE_NAME)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw error
  }
  const parsed = seedStateSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error(`[internal] Invalid seed checkpoint at ${filePath}: ${parsed.error.message}`)
  return parsed.data
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(temporary, filePath)
}

export async function writeSeedState(outDir: string, state: SeedState): Promise<void> {
  await writeJsonAtomic(path.join(outDir, STATE_FILE_NAME), state)
}
