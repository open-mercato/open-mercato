/**
 * Artifact capture for the `external` runtime (tracker task 3.1).
 *
 * A native or OpenCode run leaves the operator files: `collectArtifacts` walks the
 * sandbox `out/` directory and records what the agent wrote. An external run has no
 * sandbox and no filesystem — everything it produced arrived as ONE normalized JSON
 * answer in a webhook body, and until now that answer lived only inside
 * `agent_external_runs.result_payload` and the run's output column. Both are
 * readable, neither is downloadable, and a call transcript is the one thing an
 * operator reviewing a voice run actually wants in their hands.
 *
 * So this module records that answer as a normal `AgentRunArtifact`, through the
 * SAME seam the file plane already uses:
 *
 *   bytes  →  `putArtifactBytes`                     (encrypted at rest in storage-s3)
 *   row    →  `agent_orchestrator.artifact.capture`  (audited command, emits captured)
 *
 * Nothing about the artifact plane is special-cased for external runs: the row is
 * keyed by `(run_id, sha256, file_name)` like every other, so the run detail lists
 * it, `/artifacts/file/:id` downloads it, and the promotion effector can attach it
 * to a domain record — all without a single line of new read-side code.
 *
 * PROVIDER-AGNOSTIC BY CONSTRUCTION. What gets stored is the connector's own
 * normalized `data` — the shape the agent DECLARED in its outcome schema — not a
 * provider payload this module would have to understand. A voice connector's
 * transcript, a chat connector's message log and a generic HTTP connector's JSON
 * body all serialise the same way, and the enterprise module never learns what
 * `post_call_transcription` is.
 *
 * BEST-EFFORT BY CONTRACT, one direction only: a run that genuinely completed must
 * never be turned into a failed run because an object store was unreachable. The
 * capture is therefore invoked AFTER the audit run is closed, and its failure is a
 * warn line — the same stance `OpenCodeAgentRunner` takes around `collectArtifacts`
 * and `NativeAgentRunner` takes around its trace capture. Note the asymmetry with
 * the file plane: there, failing to store bytes means the FILE is lost, so the
 * collector is fail-closed and refuses to record a row pointing at nothing. Here the
 * answer is already durable on the correlation row and on the run — the artifact is
 * a second, more convenient copy — so a failure costs convenience, not evidence.
 *
 * NOTHING SENSITIVE IS LOGGED. The transcript is a real person speaking, and the
 * brief that produced it carries a phone number. Every log line in this file is ids,
 * counts and byte sizes.
 */

import { createHash } from 'node:crypto'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { putArtifactBytes, resolveArtifactMaxBytes, type MinimalContainer } from './artifactFileStore'
import type { CaptureArtifactsInput } from '../../commands/artifacts'

const logger = createLogger('agent_orchestrator').child({ component: 'external-run-artifacts' })

/**
 * The stored file's name, and therefore half of the capture command's idempotency
 * key `(run_id, sha256, file_name)`. Deliberately STABLE across connectors and
 * across redeliveries: two captures of the same answer for the same run collapse
 * to one row instead of accumulating `transcript-1.json`, `transcript-2.json`.
 */
export const EXTERNAL_RUN_TRANSCRIPT_FILE_NAME = 'external-run-transcript.json'

const EXTERNAL_RUN_TRANSCRIPT_MIME_TYPE = 'application/json'

export type CaptureExternalRunArtifactsArgs = {
  container: MinimalContainer
  commandBus: CommandBus
  /** The settlement's command context — built by the caller, so the audit trail matches the run. */
  commandCtx: CommandRuntimeContext
  runId: string
  agentId: string
  connectorId: string
  /** Both tenancy columns, taken from the correlation row the caller already verified. */
  tenantId: string
  organizationId: string
  /**
   * The connector-normalized ANSWER (`result.data`), not the raw provider body and
   * not the outcome envelope. The envelope's `kind` is a platform fact already on
   * the run row; the answer is what a human reads.
   */
  answer: unknown
}

export type CaptureExternalRunArtifactsResult = {
  /** Ids of the rows the capture command created — empty when nothing was recorded. */
  artifactIds: string[]
  /**
   * Why nothing was recorded, when nothing was. `null` means the capture ran.
   * Reported rather than thrown so the caller can log one line and move on.
   */
  skippedReason: 'not_serializable' | 'over_size_cap' | 'storage_unavailable' | null
}

/**
 * Record one external run's answer as an `AgentRunArtifact`.
 *
 * MAY THROW — deliberately, and only from the command bus. The best-effort
 * guarantee is the CALLER's to hold (there is exactly one call site, in
 * `completeExternalRun`, and it wraps this in a try/catch), because "a capture
 * failure must not fail the run" is a statement about the settlement path rather
 * than about this function. Swallowing everything here as well would make that
 * guarantee invisible at the place it actually matters and impossible to test by
 * breaking one wrapper.
 */
export async function captureExternalRunTranscript(
  args: CaptureExternalRunArtifactsArgs,
): Promise<CaptureExternalRunArtifactsResult> {
  const serialized = serializeAnswer(args.answer)
  if (serialized == null) {
    // A connector returned something `JSON.stringify` cannot represent (a cycle, a
    // BigInt). The run itself is unaffected — it already validated against the
    // agent's zod envelope — so this is a connector defect worth one warn line.
    logger.warn('external run answer could not be serialized for artifact capture', {
      runId: args.runId,
      agentId: args.agentId,
      connectorId: args.connectorId,
    })
    return { artifactIds: [], skippedReason: 'not_serializable' }
  }

  const maxBytes = resolveArtifactMaxBytes()
  if (serialized.byteLength > maxBytes) {
    logger.warn('external run answer exceeds the artifact size cap; not captured', {
      runId: args.runId,
      agentId: args.agentId,
      connectorId: args.connectorId,
      byteLength: serialized.byteLength,
      maxBytes,
    })
    return { artifactIds: [], skippedReason: 'over_size_cap' }
  }

  const scope = { tenantId: args.tenantId, organizationId: args.organizationId }
  const storageKey = await putArtifactBytes(args.container, scope, {
    buffer: serialized,
    fileName: EXTERNAL_RUN_TRANSCRIPT_FILE_NAME,
    mimeType: EXTERNAL_RUN_TRANSCRIPT_MIME_TYPE,
  })
  if (!storageKey) {
    // `storage-s3` is absent or the tenant has no credentials for it — the ordinary
    // state of a development deployment, and never a reason to disturb the run.
    logger.info('external run transcript not captured; artifact storage is unavailable', {
      runId: args.runId,
      agentId: args.agentId,
      connectorId: args.connectorId,
    })
    return { artifactIds: [], skippedReason: 'storage_unavailable' }
  }

  const input: CaptureArtifactsInput = {
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    runId: args.runId,
    artifacts: [
      {
        fileName: EXTERNAL_RUN_TRANSCRIPT_FILE_NAME,
        mimeType: EXTERNAL_RUN_TRANSCRIPT_MIME_TYPE,
        fileSize: serialized.byteLength,
        sha256: createHash('sha256').update(serialized).digest('hex'),
        storageKey,
        caption: null,
      },
    ],
  }
  const executed = await args.commandBus.execute<CaptureArtifactsInput, { artifactIds: string[] }>(
    'agent_orchestrator.artifact.capture',
    { input, ctx: args.commandCtx },
  )

  logger.info('external run transcript captured as an artifact', {
    runId: args.runId,
    agentId: args.agentId,
    connectorId: args.connectorId,
    artifactCount: executed.result.artifactIds.length,
    byteLength: serialized.byteLength,
  })
  return { artifactIds: executed.result.artifactIds, skippedReason: null }
}

/**
 * Pretty-printed so the downloaded file is readable without a formatter — an
 * operator opening a transcript in a browser is the whole point of capturing it.
 * Returns `null` rather than throwing for a value `JSON.stringify` refuses.
 */
function serializeAnswer(answer: unknown): Buffer | null {
  try {
    const json = JSON.stringify(answer ?? null, null, 2)
    if (typeof json !== 'string') return null
    return Buffer.from(json, 'utf8')
  } catch {
    return null
  }
}
