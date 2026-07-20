import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { putArtifactBytes, type MinimalContainer } from './artifactFileStore'
import type { CaptureArtifactsInput } from '../../commands/artifacts'

/** Advisory artifact metadata the agent optionally declared via `submit_outcome`. */
export type AdvisoryArtifact = { path: string; caption?: string }

export type CollectArtifactsResult = {
  /** AgentRunArtifact rows created (deduped). */
  capturedCount: number
  /** Relative paths skipped over the size/count caps. */
  skipped: string[]
  /** Relative paths whose bytes could not be stored (fail-closed → not recorded). */
  failed: string[]
}

const DEFAULT_MAX_BYTES = 26214400 // 25 MiB
const DEFAULT_MAX_COUNT = 20

function resolveMaxBytes(): number {
  const raw = Number.parseInt(process.env.OM_AGENT_ARTIFACT_MAX_BYTES ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES
}

function resolveMaxCount(): number {
  const raw = Number.parseInt(process.env.OM_AGENT_ARTIFACT_MAX_COUNT ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_COUNT
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
}

function mimeForFile(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream'
}

/** Sanitized, path-segment-free basename stored on the row (no directory traversal). */
function safeBasename(fileName: string): string {
  return path.basename(fileName).replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 255)
}

/** Walk `outDir` recursively, returning file paths relative to it (POSIX-style). */
async function listFiles(outDir: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), childRel)
      } else if (entry.isFile()) {
        found.push(childRel)
      }
    }
  }
  await walk(outDir, '')
  return found.sort()
}

/**
 * Scan a completed run's sandbox `out/` dir and capture every new file as an
 * encrypted `AgentRunArtifact`. The FILESYSTEM is authoritative: advisory
 * `submit_outcome.artifacts[]` only contributes captions (matched by relative
 * path) — it can never invent a file that is not on disk. Fail-closed: a file
 * whose bytes cannot be durably stored is reported in `failed` and NOT recorded.
 * Best-effort overall — never throws into the run.
 */
export async function collectArtifacts(args: {
  commandBus: CommandBus
  commandCtx: CommandRuntimeContext
  outDir: string
  runId: string
  tenantId: string
  organizationId: string
  advisory?: AdvisoryArtifact[]
}): Promise<CollectArtifactsResult> {
  const maxBytes = resolveMaxBytes()
  const maxCount = resolveMaxCount()
  const container = args.commandCtx.container as unknown as MinimalContainer
  const scope = { tenantId: args.tenantId, organizationId: args.organizationId }
  const captionByPath = new Map<string, string>()
  for (const advisory of args.advisory ?? []) {
    if (advisory.caption) captionByPath.set(advisory.path.replace(/^\.?\/+/, ''), advisory.caption)
  }

  const skipped: string[] = []
  const failed: string[] = []
  const collected: CaptureArtifactsInput['artifacts'] = []

  const relPaths = await listFiles(args.outDir)
  for (const rel of relPaths) {
    if (collected.length >= maxCount) {
      skipped.push(rel)
      continue
    }
    const abs = path.join(args.outDir, rel)
    let size: number
    try {
      size = (await stat(abs)).size
    } catch {
      continue
    }
    if (size > maxBytes) {
      skipped.push(rel)
      console.warn(`[internal] agent artifact "${rel}" (${size}B) exceeds OM_AGENT_ARTIFACT_MAX_BYTES; skipped`)
      continue
    }
    let bytes: Buffer
    try {
      bytes = await readFile(abs)
    } catch {
      failed.push(rel)
      continue
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fileName = safeBasename(rel)
    const storageKey = await putArtifactBytes(container, scope, {
      buffer: bytes,
      fileName,
      mimeType: mimeForFile(fileName),
    })
    if (!storageKey) {
      failed.push(rel)
      continue
    }
    collected.push({
      fileName,
      mimeType: mimeForFile(fileName),
      fileSize: size,
      sha256,
      storageKey,
      caption: captionByPath.get(rel) ?? null,
    })
  }

  if (skipped.length > 0) {
    console.warn(`[internal] agent artifact capture skipped ${skipped.length} file(s) over caps for run ${args.runId}`)
  }

  let capturedCount = 0
  if (collected.length > 0) {
    const result = await args.commandBus.execute<CaptureArtifactsInput, { artifactIds: string[] }>(
      'agent_orchestrator.artifact.capture',
      {
        input: {
          tenantId: args.tenantId,
          organizationId: args.organizationId,
          runId: args.runId,
          artifacts: collected,
        },
        ctx: args.commandCtx,
      },
    )
    capturedCount = result.result.artifactIds.length
  }

  return { capturedCount, skipped, failed }
}
