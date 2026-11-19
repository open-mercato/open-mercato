import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { putArtifactBytesResult, type MinimalContainer } from './artifactFileStore'
import type { CaptureArtifactsInput } from '../../commands/artifacts'
import { AgentSpan } from '../../data/entities'
import { withAuditedCommand, withRuntimeAuditWrite } from '../identity/agentWriteScope'
import {
  ARTIFACT_CAPTURE_SPAN_NAME,
  artifactCaptureExternalSpanId,
  buildArtifactCaptureAttributes,
  summarizeArtifactCaptureFailures,
  type ArtifactCaptureFailure,
  type ArtifactCaptureFailureReason,
} from '../trace/artifactCaptureStatus'

const logger = createLogger('agent_orchestrator').child({ component: 'artifact-collector' })

/** Advisory artifact metadata the agent optionally declared via `submit_outcome`. */
export type AdvisoryArtifact = { path: string; caption?: string }

export type CollectArtifactsResult = {
  /** AgentRunArtifact rows created (deduped). */
  capturedCount: number
  /** Relative paths skipped over the size/count caps. */
  skipped: string[]
  /** Relative paths whose bytes could not be stored (fail-closed → not recorded). */
  failed: string[]
  /** Count + reason of the files not stored, persisted on the run trace; null when all were stored. */
  failure: ArtifactCaptureFailure | null
}

/**
 * Persist the run's not-stored count + reason as one idempotent `artifact.capture`
 * system span, so the run's Files card can say why files are missing. Best-effort:
 * a failure here is reported and never fails the run.
 */
async function recordCaptureFailure(
  container: MinimalContainer,
  scope: { runId: string; tenantId: string; organizationId: string },
  failure: ArtifactCaptureFailure,
): Promise<void> {
  try {
    const em = container.resolve<EntityManager>('em').fork()
    const spanScope = { agentRunId: scope.runId, tenantId: scope.tenantId, organizationId: scope.organizationId }
    const externalSpanId = artifactCaptureExternalSpanId(scope.runId)
    if ((await em.count(AgentSpan, { ...spanScope, externalSpanId })) > 0) return
    const sequence = await em.count(AgentSpan, spanScope)
    const now = new Date()
    em.persist(
      em.create(AgentSpan, {
        ...spanScope,
        externalSpanId,
        sequence,
        name: ARTIFACT_CAPTURE_SPAN_NAME,
        kind: 'system',
        startedAt: now,
        endedAt: now,
        durationMs: 0,
        status: 'error',
        attributes: buildArtifactCaptureAttributes(failure),
      }),
    )
    await withRuntimeAuditWrite(() => em.flush())
  } catch (error) {
    logger.warn('failed to record agent artifact capture failure', {
      runId: scope.runId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'artifact_capture_failure_record_failed',
      attributes: { runId: scope.runId },
    })
  }
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
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
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
  const failureReasons: ArtifactCaptureFailureReason[] = []
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
      logger.warn('agent artifact exceeds OM_AGENT_ARTIFACT_MAX_BYTES; skipped', { runId: args.runId, size })
      continue
    }
    let bytes: Buffer
    try {
      bytes = await readFile(abs)
    } catch {
      failed.push(rel)
      failureReasons.push('storage_unavailable')
      continue
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fileName = safeBasename(rel)
    const stored = await putArtifactBytesResult(container, scope, {
      buffer: bytes,
      fileName,
      mimeType: mimeForFile(fileName),
    })
    if (stored.status !== 'stored') {
      failed.push(rel)
      failureReasons.push(stored.status)
      continue
    }
    const storageKey = stored.key
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
    logger.warn('agent artifact capture skipped files over caps', {
      skippedCount: skipped.length,
      runId: args.runId,
    })
  }

  const failure = summarizeArtifactCaptureFailures(failureReasons)
  if (failure) {
    logger.warn('agent artifact capture did not store files', {
      runId: args.runId,
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      count: failure.count,
      reason: failure.reason,
    })
    await recordCaptureFailure(container, { runId: args.runId, ...scope }, failure)
  }

  let capturedCount = 0
  if (collected.length > 0) {
    const result = await withAuditedCommand(() =>
      args.commandBus.execute<CaptureArtifactsInput, { artifactIds: string[] }>(
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
      ),
    )
    capturedCount = result.result.artifactIds.length
  }

  return { capturedCount, skipped, failed, failure }
}
