import {
  appendCausationFrame,
  createCausationEnvelope,
  getAmbientCausation,
  isCausationEnabled,
  reportCausationDegradation,
  runWithCausation,
  toIdentifierOnlyCausation,
  type CausationEnvelope,
  type CausationFrame,
} from '@open-mercato/shared/lib/causation/server'
import type { WorkflowInstanceMetadata } from '../data/entities'

export type WorkflowCausationInstance = {
  id?: string | null
  workflowId?: string | null
}

export type WorkflowCausationTarget = {
  instance: WorkflowCausationInstance | null | undefined
  stepInstanceId?: string | null
}

export function resolveWorkflowStartCausation(options: { initiatedByUserId: string | null }): CausationEnvelope {
  const ambient = toIdentifierOnlyCausation(getAmbientCausation())
  if (ambient) return ambient
  return createCausationEnvelope([{ kind: options.initiatedByUserId ? 'user' : 'system' }])
}

export function applyServerStartCausation(
  metadata: WorkflowInstanceMetadata | null | undefined,
  options: { initiatedByUserId: string | null },
): WorkflowInstanceMetadata | undefined {
  const serverOwned: WorkflowInstanceMetadata = { ...(metadata ?? {}) }
  delete serverOwned.causation
  if (!isCausationEnabled()) return metadata ? serverOwned : undefined
  return { ...serverOwned, causation: resolveWorkflowStartCausation(options) }
}

export function buildWorkflowCausationFrame(
  instance: WorkflowCausationInstance,
  stepInstanceId?: string | null,
): CausationFrame {
  const frame: CausationFrame = {
    kind: 'workflow',
    id: instance.id ?? null,
    ref: stepInstanceId ?? null,
  }
  if (typeof instance.workflowId === 'string' && instance.workflowId) {
    frame.meta = { workflowId: instance.workflowId }
  }
  return frame
}

function isSameWorkflowFrame(candidate: CausationFrame | undefined, frame: CausationFrame): boolean {
  if (!candidate || candidate.kind !== 'workflow') return false
  return (candidate.id ?? null) === (frame.id ?? null) && (candidate.ref ?? null) === (frame.ref ?? null)
}

export function resolveWorkflowFrameEnvelope(target: WorkflowCausationTarget): CausationEnvelope | null {
  const instanceId = target.instance?.id
  if (typeof instanceId !== 'string' || !instanceId) return null
  const frame = buildWorkflowCausationFrame(
    { id: instanceId, workflowId: target.instance?.workflowId ?? null },
    target.stepInstanceId,
  )
  const ambient = getAmbientCausation()
  if (!ambient) return createCausationEnvelope([{ kind: 'system' }, frame])
  const innermost = ambient.frames[ambient.frames.length - 1]
  if (isSameWorkflowFrame(innermost, frame)) return ambient
  return appendCausationFrame(ambient, frame)
}

export function runInWorkflowCausationFrame<T>(target: WorkflowCausationTarget, fn: () => T): T {
  if (!isCausationEnabled()) return fn()
  const envelope = resolveWorkflowFrameEnvelope(target)
  if (!envelope) {
    reportCausationDegradation('workflow_frame_no_instance', {})
    return fn()
  }
  return runWithCausation(envelope, fn)
}
