import type { AwilixContainer } from 'awilix'
import type { TraceIngest } from '../../data/validators'
import { offloadLlmContentEntries } from '../runtime/nativeContentOffload'
import type { ArtifactScope } from './artifactStore'
import { resolveRunCapture } from './capturePolicy'
import type { IngestTraceOptions } from './traceIngestionService'

export type IngestContentCaptureOptions = Pick<IngestTraceOptions, 'capture' | 'offloadLlmContent'>

/** Whether the payload carries anything the capture policy decides: a manifest or a span `llm` block. */
export function ingestPayloadNeedsCapture(payload: TraceIngest): boolean {
  if (payload.manifest) return true
  return (payload.spans ?? []).some((span) => span.llm !== undefined)
}

/**
 * Resolves the tenant capture policy for the ingested run's agent and, at
 * `full`, wires the llm content offload into the trace content namespace (the
 * same builders and upload path as native runs). Payloads without a manifest
 * or `llm` blocks skip the policy read entirely, so legacy ingests are
 * unchanged. Never throws.
 */
export async function resolveIngestContentCapture(
  container: AwilixContainer,
  scope: ArtifactScope,
  payload: TraceIngest,
): Promise<IngestContentCaptureOptions> {
  if (!ingestPayloadNeedsCapture(payload)) return {}
  const capture = await resolveRunCapture(container, {
    tenantId: scope.tenantId,
    agentId: payload.agentId,
    runSource: 'runtime',
  })
  if (capture.level !== 'full') return { capture }
  return {
    capture,
    offloadLlmContent: (contents) =>
      offloadLlmContentEntries(
        container,
        scope,
        contents.map((content, index) => ({ label: `${payload.externalRunId}:${index}`, content })),
        { redactPii: capture.redactPii },
      ),
  }
}
