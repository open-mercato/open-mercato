import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseModuleCliOptions } from '@open-mercato/shared/lib/cli/parseModuleCliOptions'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { PERF_PROFILE_IDS, PERF_TIERS, type PerfProfileId, type PerfTier } from './profile'

export const SEED_PERF_USAGE = [
  'Usage: mercato customers seed-perf --tenant <id> --org <id> --tier XS|S|M|L --owners-file <path>',
  '  [--profile perf-v1] [--seed 42] [--anchor YYYY-MM-DD] [--batch 1000] [--resume]',
  '  [--out-dir <dir>] [--dry-run] [--scale <float>]',
].join('\n')

export type SeedPerfOptions = {
  tenantId: string
  organizationId: string
  tier: PerfTier
  profile: PerfProfileId
  seed: number
  anchor: string
  ownersFile: string | null
  batch: number
  resume: boolean
  outDir: string
  dryRun: boolean
  scale: number
}

const flagSchema = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((value) => {
    if (value === undefined) return false
    if (typeof value === 'boolean') return value
    if (!value.trim()) return true
    return parseBooleanToken(value) ?? true
  })

const optionsSchema = z
  .object({
    tenant: z.string().uuid(),
    org: z.string().uuid(),
    tier: z.enum(PERF_TIERS),
    profile: z.enum(PERF_PROFILE_IDS).default('perf-v1'),
    seed: z.coerce.number().int().min(0).max(2147483647).default(42),
    anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    'owners-file': z.string().min(1).optional(),
    batch: z.coerce.number().int().min(1).max(20000).default(1000),
    resume: flagSchema,
    'out-dir': z.string().min(1).optional(),
    'dry-run': flagSchema,
    scale: z.coerce.number().positive().max(100).default(1),
  })
  .superRefine((value, refinement) => {
    if (!value['dry-run'] && !value['owners-file']) {
      refinement.addIssue({ code: 'custom', path: ['owners-file'], message: '--owners-file is required unless --dry-run is set' })
    }
  })

export type ParseOptionsResult = { ok: true; options: SeedPerfOptions } | { ok: false; message: string }

export function parseSeedPerfOptions(argv: readonly string[], now: Date, cwd: string): ParseOptionsResult {
  const raw = parseModuleCliOptions(argv, { flagValue: 'true', skipEmptyKeys: true, consumeEmptyValues: true, advancePastValue: false })
  const normalized: Record<string, string> = { ...raw }
  if (!normalized.tenant && raw.tenantId) normalized.tenant = raw.tenantId
  if (!normalized.org && (raw.organizationId || raw.orgId)) normalized.org = raw.organizationId ?? raw.orgId
  const parsed = optionsSchema.safeParse(normalized)
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `--${issue.path.join('.')}: ${issue.message}`).join('; ')
    return { ok: false, message }
  }
  const value = parsed.data
  return {
    ok: true,
    options: {
      tenantId: value.tenant.toLowerCase(),
      organizationId: value.org.toLowerCase(),
      tier: value.tier,
      profile: value.profile,
      seed: value.seed,
      anchor: value.anchor ?? now.toISOString().slice(0, 10),
      ownersFile: value['owners-file'] ? path.resolve(cwd, value['owners-file']) : null,
      batch: value.batch,
      resume: value.resume,
      outDir: path.resolve(cwd, value['out-dir'] ?? path.join('.mercato', 'perf-seed', value.tier)),
      dryRun: value['dry-run'],
      scale: value.scale,
    },
  }
}

const ownersFileSchema = z.object({
  owners: z
    .array(
      z.object({
        userId: z.string().uuid(),
        staffMemberId: z.string().nullable().optional(),
      }),
    )
    .min(1),
})

export async function readOwnersFile(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, 'utf8')
  const parsed = ownersFileSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(`[internal] Invalid owners file ${filePath}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`)
  }
  return Array.from(new Set(parsed.data.owners.map((owner) => owner.userId.toLowerCase())))
}
