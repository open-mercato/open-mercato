import { z } from 'zod'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment } from './data/entities'
import type { StorageDriverFactory } from './lib/drivers'
import {
  ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY,
  DOCUMENT_OUTLINE_MAX_DEPTH,
  DOCUMENT_SECTIONS_MAX_PAGE_SIZE,
  DOCUMENT_SECTION_MAX_CHARS,
  type AttachmentDocumentStructureService,
  type DocumentOutlineNode,
  type DocumentSection,
} from './lib/documentStructure/service'
import { enqueueDocumentStructureExtraction } from './lib/documentStructure/queue'
import { runDocumentStructureBackfill } from './lib/documentStructure/backfill'
import { documentOcrModeSchema } from './lib/documentStructure/types'

type ParsedArgs = Record<string, string | boolean>

function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part || !part.startsWith('--')) continue
    const [rawKey, rawValue] = part.replace(/^--/, '').split('=')
    const key = rawKey.trim()
    if (!key) continue
    if (rawValue !== undefined) {
      args[key] = rawValue
      continue
    }
    const next = rest[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function coerceIdList(value?: string | boolean): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const deleteAttachments: ModuleCli = {
  command: 'delete',
  async run(rest) {
    const args = parseArgs(rest)
    const ids = new Set<string>()
    coerceIdList(args.id).forEach((id) => ids.add(id))
    coerceIdList(args.ids).forEach((id) => ids.add(id))

    if (ids.size === 0) {
      console.error('Usage: mercato attachments delete --id <attachmentId> [--ids id1,id2] [--org <organizationId>] [--tenant <tenantId>]')
      return
    }
    const organizationId =
      typeof args.org === 'string'
        ? args.org
        : typeof args.organizationId === 'string'
          ? args.organizationId
          : undefined
    const tenantId =
      typeof args.tenant === 'string'
        ? args.tenant
        : typeof args.tenantId === 'string'
          ? args.tenantId
          : undefined

    try {
      const container = await createRequestContainer()
      const em = container.resolve<EntityManager>('em')
      const storageDriverFactory = container.resolve<StorageDriverFactory>('storageDriverFactory')
      const idList = Array.from(ids)
      const where: Record<string, unknown> = { id: { $in: idList } }
      if (organizationId) where.organizationId = organizationId
      if (tenantId) where.tenantId = tenantId
      const attachments = await em.find(Attachment, where)
      if (!attachments.length) {
        console.log('No attachments matched the provided filters.')
        return
      }
      const removedIds = new Set<string>()
      for (const entry of attachments) {
        const driver = await storageDriverFactory.resolveForPartition(entry.partitionCode, {
          tenantId: entry.tenantId ?? '',
          organizationId: entry.organizationId ?? '',
        })
        await driver.delete(entry.partitionCode, entry.storagePath)
        em.remove(entry)
        removedIds.add(entry.id)
        console.log(`Deleted attachment ${entry.id}${entry.fileName ? ` (${entry.fileName})` : ''}`)
      }
      await em.flush()
      const missing = idList.filter((id) => !removedIds.has(id))
      if (missing.length > 0) {
        console.log(`Not found: ${missing.join(', ')}`)
      }
    } catch (err) {
      console.error('[attachments] delete command failed:', err)
    }
  },
}

const STRUCTURE_USAGE = [
  'Usage:',
  '  mercato attachments structure extract --attachment <id> --tenant <id> --org <id> [--force] [--ocr auto|never|force]',
  '  mercato attachments structure backfill --tenant <id> [--org <id>] [--partition <code>] [--below-engine-version <n>] [--limit <n>] [--dry-run]',
  '  mercato attachments structure dump --attachment <id> --tenant <id> --org <id> [--format outline|json] [--json] [--max-depth <n>] [--with-text]',
].join('\n')

const DUMP_FORMATS = ['outline', 'json'] as const

const structureExtractArgsSchema = z.object({
  attachmentId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  force: z.boolean(),
  ocr: documentOcrModeSchema.optional(),
})
export type StructureExtractArgs = z.infer<typeof structureExtractArgsSchema>

const structureBackfillArgsSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  partitionCode: z.string().min(1).nullable(),
  belowEngineVersion: z.coerce.number().int().min(1).nullable(),
  limit: z.coerce.number().int().min(1).nullable(),
  dryRun: z.boolean(),
})
export type StructureBackfillArgs = z.infer<typeof structureBackfillArgsSchema>

const structureDumpArgsSchema = z.object({
  attachmentId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  format: z.enum(DUMP_FORMATS),
  maxDepth: z.coerce.number().int().min(1).max(DOCUMENT_OUTLINE_MAX_DEPTH),
  withText: z.boolean(),
})
export type StructureDumpArgs = z.infer<typeof structureDumpArgsSchema>

export type StructureArgsResult<T> = { ok: true; value: T } | { ok: false; error: string }

const ARG_FLAG_NAMES: Record<string, string> = {
  attachmentId: '--attachment',
  tenantId: '--tenant',
  organizationId: '--org',
  partitionCode: '--partition',
  belowEngineVersion: '--below-engine-version',
  limit: '--limit',
  ocr: '--ocr',
  format: '--format',
  maxDepth: '--max-depth',
}

function readStringArg(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

function readFlagArg(args: ParsedArgs, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return parseBooleanToken(value) ?? false
  }
  return false
}

function validateStructureArgs<T>(schema: z.ZodType<T>, input: Record<string, unknown>): StructureArgsResult<T> {
  const parsed = schema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issue = parsed.error.issues[0]
  const field = typeof issue?.path[0] === 'string' ? issue.path[0] : ''
  const flag = ARG_FLAG_NAMES[field] ?? `--${field}`
  const missing = input[field] === undefined || input[field] === null
  return { ok: false, error: missing ? `Missing required ${flag}` : `Invalid ${flag}: ${issue?.message ?? 'invalid value'}` }
}

export function parseStructureExtractArgs(rest: string[]): StructureArgsResult<StructureExtractArgs> {
  const args = parseArgs(rest)
  return validateStructureArgs(structureExtractArgsSchema, {
    attachmentId: readStringArg(args, 'attachment', 'attachmentId', 'id'),
    tenantId: readStringArg(args, 'tenant', 'tenantId'),
    organizationId: readStringArg(args, 'org', 'organizationId'),
    force: readFlagArg(args, 'force'),
    ocr: readStringArg(args, 'ocr'),
  })
}

export function parseStructureBackfillArgs(rest: string[]): StructureArgsResult<StructureBackfillArgs> {
  const args = parseArgs(rest)
  return validateStructureArgs(structureBackfillArgsSchema, {
    tenantId: readStringArg(args, 'tenant', 'tenantId'),
    organizationId: readStringArg(args, 'org', 'organizationId') ?? null,
    partitionCode: readStringArg(args, 'partition', 'partitionCode') ?? null,
    belowEngineVersion: readStringArg(args, 'below-engine-version', 'belowEngineVersion') ?? null,
    limit: readStringArg(args, 'limit') ?? null,
    dryRun: readFlagArg(args, 'dry-run', 'dryRun'),
  })
}

export function parseStructureDumpArgs(rest: string[]): StructureArgsResult<StructureDumpArgs> {
  const args = parseArgs(rest)
  const jsonFlag = readFlagArg(args, 'json')
  return validateStructureArgs(structureDumpArgsSchema, {
    attachmentId: readStringArg(args, 'attachment', 'attachmentId', 'id'),
    tenantId: readStringArg(args, 'tenant', 'tenantId'),
    organizationId: readStringArg(args, 'org', 'organizationId'),
    format: readStringArg(args, 'format') ?? (jsonFlag ? 'json' : 'outline'),
    maxDepth: readStringArg(args, 'max-depth', 'maxDepth') ?? DOCUMENT_OUTLINE_MAX_DEPTH,
    withText: readFlagArg(args, 'with-text', 'withText'),
  })
}

function reportUsageError(error: string): void {
  console.error(`[attachments] ${error}`)
  console.error(STRUCTURE_USAGE)
  process.exitCode = 2
}

function describeOutlineNode(node: DocumentOutlineNode): string {
  const title = [node.numberLabel, node.heading].filter((part) => part && part.length > 0).join(' ') || '(untitled)'
  const pages =
    node.pageStart === null
      ? ''
      : node.pageEnd !== null && node.pageEnd !== node.pageStart
        ? ` p. ${node.pageStart}-${node.pageEnd}`
        : ` p. ${node.pageStart}`
  return `${title} [${node.kind}]${pages} anchor=${node.anchorKey}`
}

export function formatDocumentOutline(outline: DocumentOutlineNode[]): string[] {
  const depthById = new Map<string, number>()
  return outline.map((node) => {
    const depth = node.parentId ? (depthById.get(node.parentId) ?? 0) + 1 : 0
    depthById.set(node.id, depth)
    return `${'  '.repeat(depth)}${describeOutlineNode(node)}`
  })
}

async function collectDocumentSections(
  service: AttachmentDocumentStructureService,
  input: StructureDumpArgs,
): Promise<DocumentSection[]> {
  const sections: DocumentSection[] = []
  let afterOrdinal: number | null = null
  for (;;) {
    const page = await service.listSections({
      attachmentId: input.attachmentId,
      scope: { tenantId: input.tenantId, organizationId: input.organizationId },
      afterOrdinal,
      limit: DOCUMENT_SECTIONS_MAX_PAGE_SIZE,
      includeText: true,
      maxCharsPerSection: DOCUMENT_SECTION_MAX_CHARS,
    })
    if (!page) break
    sections.push(...page.items)
    if (page.nextCursor === null) break
    afterOrdinal = page.nextCursor
  }
  return sections
}

async function runStructureExtract(rest: string[]): Promise<void> {
  const parsed = parseStructureExtractArgs(rest)
  if (!parsed.ok) return reportUsageError(parsed.error)
  const input = parsed.value
  const container = await createRequestContainer()
  const service = container.resolve<AttachmentDocumentStructureService>(ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY)
  const result = await service.requestExtraction({
    attachmentId: input.attachmentId,
    scope: { tenantId: input.tenantId, organizationId: input.organizationId },
    force: input.force,
    ...(input.ocr ? { ocr: input.ocr } : {}),
  })
  if (!result) {
    console.error(`[attachments] Attachment ${input.attachmentId} not found in the given tenant/organization.`)
    process.exitCode = 1
    return
  }
  if (result.enqueued) {
    console.log(`Enqueued document structure extraction for ${input.attachmentId} (job ${result.jobId ?? 'n/a'}).`)
    return
  }
  console.log(`Attachment ${input.attachmentId} already has a current extraction ${result.extractionId} (${result.status}); pass --force to re-extract.`)
}

async function runStructureBackfill(rest: string[]): Promise<void> {
  const parsed = parseStructureBackfillArgs(rest)
  if (!parsed.ok) return reportUsageError(parsed.error)
  const input = parsed.value
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const result = await runDocumentStructureBackfill({
    em,
    enqueue: (job) => enqueueDocumentStructureExtraction(container, job),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    partitionCode: input.partitionCode,
    belowEngineVersion: input.belowEngineVersion,
    limit: input.limit,
    dryRun: input.dryRun,
  })
  if (result.partitions.length === 0) {
    console.log('No partitions with document structure extraction enabled matched the given scope.')
    return
  }
  if (input.dryRun) {
    for (const target of result.targets) {
      console.log(`${target.attachmentId}\t${target.partitionCode}${target.force ? '\tforce' : ''}`)
    }
    console.log(`Dry run: ${result.targets.length} attachment(s) would be enqueued (scanned ${result.scanned}, partitions: ${result.partitions.join(', ')}).`)
    return
  }
  console.log(`Enqueued ${result.enqueued} document structure extraction job(s) (scanned ${result.scanned}, partitions: ${result.partitions.join(', ')}).`)
}

async function runStructureDump(rest: string[]): Promise<void> {
  const parsed = parseStructureDumpArgs(rest)
  if (!parsed.ok) return reportUsageError(parsed.error)
  const input = parsed.value
  const container = await createRequestContainer()
  const service = container.resolve<AttachmentDocumentStructureService>(ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY)
  const structure = await service.getStructure({
    attachmentId: input.attachmentId,
    scope: { tenantId: input.tenantId, organizationId: input.organizationId },
    maxDepth: input.maxDepth,
  })
  if (!structure) {
    console.error(`[attachments] Attachment ${input.attachmentId} not found in the given tenant/organization.`)
    process.exitCode = 1
    return
  }
  const sections = input.withText && structure.extraction ? await collectDocumentSections(service, input) : null
  if (input.format === 'json') {
    console.log(JSON.stringify(sections ? { ...structure, sections } : structure, null, 2))
    return
  }
  if (!structure.extraction) {
    console.log(`Attachment ${input.attachmentId} has no document structure extraction yet.`)
    return
  }
  const extraction = structure.extraction
  console.log(
    `Extraction ${extraction.id}: ${extraction.status} engine=${extraction.engine}@${extraction.engineVersion} pages=${extraction.pageCount ?? '-'} sections=${extraction.sectionCount ?? '-'}${extraction.skipReason ? ` skip=${extraction.skipReason}` : ''}`,
  )
  for (const line of formatDocumentOutline(structure.outline)) console.log(line)
  if (!sections) return
  for (const section of sections) {
    console.log(`\n# ${section.citation} (${section.locator})`)
    console.log(section.text ?? '')
  }
}

const STRUCTURE_SUBCOMMANDS: Record<string, (rest: string[]) => Promise<void>> = {
  extract: runStructureExtract,
  backfill: runStructureBackfill,
  dump: runStructureDump,
}

const documentStructure: ModuleCli = {
  command: 'structure',
  help: STRUCTURE_USAGE,
  async run(rest) {
    const [subcommand, ...subRest] = rest
    const handler = subcommand ? STRUCTURE_SUBCOMMANDS[subcommand] : undefined
    if (!handler) return reportUsageError(subcommand ? `Unknown structure subcommand: ${subcommand}` : 'Missing structure subcommand')
    try {
      await handler(subRest)
    } catch (err) {
      console.error(`[attachments] structure ${subcommand} failed:`, err instanceof Error ? err.message : err)
      process.exitCode = 1
    }
  },
}

export default [deleteAttachments, documentStructure]
