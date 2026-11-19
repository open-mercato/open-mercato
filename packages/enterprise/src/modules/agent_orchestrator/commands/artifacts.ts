import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  createAttachmentFromBuffer,
  type CreateAttachmentFromBufferInput,
} from '@open-mercato/core/modules/attachments/lib/createFromBuffer'
import { AgentRunArtifact } from '../data/entities'
import { getArtifactBytes, type MinimalContainer } from '../lib/runtime/artifactFileStore'
import { emitAgentOrchestratorEvent } from '../events'

/**
 * File plane (#12) capture command. The `ArtifactCollector` performs the IO
 * (scan the sandbox `out/`, hash, size-cap, encrypt + upload the bytes) and then
 * calls this audited command with the resulting per-file metadata; the command
 * persists one `AgentRunArtifact` row per file and emits `artifact.captured`.
 *
 * Idempotent (at-least-once safe): rows are keyed by `(run_id, sha256, file_name)`
 * — files already recorded for the run are skipped, so a re-capture of the same
 * run does not duplicate. Append-only; never mutates existing rows.
 */
const capturedArtifactSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(150),
  fileSize: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  storageKey: z.string().min(1).max(500),
  caption: z.string().max(2000).nullable().optional(),
})

const captureArtifactsSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  runId: z.string().uuid(),
  artifacts: z.array(capturedArtifactSchema).max(100),
})
export type CaptureArtifactsInput = z.infer<typeof captureArtifactsSchema>

const captureArtifactsCommand: CommandHandler<CaptureArtifactsInput, { artifactIds: string[] }> = {
  id: 'agent_orchestrator.artifact.capture',
  async execute(rawInput, ctx) {
    const input = captureArtifactsSchema.parse(rawInput)
    if (input.artifacts.length === 0) return { artifactIds: [] }

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Idempotency: skip files already recorded for this run (unique run+sha+name).
    const existing = await em.find(
      AgentRunArtifact,
      { runId: input.runId, organizationId: input.organizationId },
      { fields: ['sha256', 'fileName'] },
    )
    const seen = new Set(existing.map((row) => `${row.sha256}:${row.fileName}`))

    const created: AgentRunArtifact[] = []
    for (const file of input.artifacts) {
      if (seen.has(`${file.sha256}:${file.fileName}`)) continue
      seen.add(`${file.sha256}:${file.fileName}`)
      const row = em.create(AgentRunArtifact, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        runId: input.runId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        sha256: file.sha256,
        storageKey: file.storageKey,
        caption: file.caption ?? null,
        source: 'agent_output',
      })
      em.persist(row)
      created.push(row)
    }
    if (created.length === 0) return { artifactIds: [] }
    await em.flush()

    await emitAgentOrchestratorEvent('agent_orchestrator.artifact.captured', {
      runId: input.runId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      count: created.length,
      artifactIds: created.map((row) => row.id),
    }, { persistent: true })

    return { artifactIds: created.map((row) => row.id) }
  },
}

registerCommand(captureArtifactsCommand)

/**
 * Promotion effector (Phase 3). Materializes a captured artifact into a durable
 * `Attachment` linked to a domain record — invoked ONLY after an
 * `attachments.attach_artifact` proposal is approved (a workflow EFFECT step maps
 * `context.proposalPayload.actions[].payload` onto this command's input, mirroring
 * `effector_set_stage`). Preserves propose-only: the agent never self-attaches.
 * Idempotent — a re-run returns the existing attachment id and never duplicates
 * (guarded by `promotedAttachmentId`).
 */
const promoteArtifactSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  artifactId: z.string().uuid(),
  entityId: z.string().min(1),
  recordId: z.string().min(1),
  fileName: z.string().max(255).optional(),
})
export type PromoteArtifactInput = z.infer<typeof promoteArtifactSchema>

const promoteArtifactCommand: CommandHandler<PromoteArtifactInput, { attachmentId: string }> = {
  id: 'agent_orchestrator.artifact.promote',
  async execute(rawInput, ctx) {
    const input = promoteArtifactSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const artifact = await findOneWithDecryption(
      em,
      AgentRunArtifact,
      { id: input.artifactId, tenantId: input.tenantId, organizationId: input.organizationId, deletedAt: null },
      undefined,
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    if (!artifact) throw new Error(`[internal] artifact ${input.artifactId} not found in this tenant/org`)
    // Idempotent: already promoted → return the existing attachment, no duplicate.
    if (artifact.promotedAttachmentId) return { attachmentId: artifact.promotedAttachmentId }

    const bytes = await getArtifactBytes(
      ctx.container as unknown as MinimalContainer,
      { tenantId: input.tenantId, organizationId: input.organizationId },
      artifact.storageKey,
    )
    if (!bytes) throw new Error('[internal] artifact bytes unavailable; cannot promote')

    let dataEngine: CreateAttachmentFromBufferInput['dataEngine']
    try {
      dataEngine = ctx.container.resolve<CreateAttachmentFromBufferInput['dataEngine']>('dataEngine')
    } catch {
      dataEngine = undefined
    }

    const created = await createAttachmentFromBuffer({
      em,
      dataEngine,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      entityId: input.entityId,
      recordId: input.recordId,
      fileName: input.fileName ?? artifact.fileName,
      mimeType: artifact.mimeType,
      buffer: bytes,
    })

    artifact.promotedAttachmentId = created.id
    await em.flush()

    await emitAgentOrchestratorEvent('agent_orchestrator.artifact.promoted', {
      artifactId: artifact.id,
      attachmentId: created.id,
      entityId: input.entityId,
      recordId: input.recordId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }, { persistent: true })

    return { attachmentId: created.id }
  },
}

registerCommand(promoteArtifactCommand)
