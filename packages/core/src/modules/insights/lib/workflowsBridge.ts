import type { XrayContainer } from './projection/runtime'

/**
 * Soft-optional bridge to the workflows module (spec decision X10): insights resolves the
 * workflows-owned DI service `workflowDraftService` by name and only relies on the structural
 * types below, never on workflows internals. Without the workflows module the service is absent
 * and the callers answer `workflows_unavailable`.
 */
export const WORKFLOW_DRAFT_SERVICE_KEY = 'workflowDraftService'

export type XrayWorkflowScope = {
  tenantId: string
  organizationId: string
}

export type XrayWorkflowDefinitionShape = {
  id: string
  workflowId: string
  version: number
  enabled: boolean
  steps: Array<{ stepId: string; stepType: string }>
  transitions: Array<{ fromStepId: string; toStepId: string; kind: string | null }>
}

export type XrayWorkflowDraftIssue = {
  path: string
  code: string
  message: string
}

export type XrayWorkflowDraftValidation =
  | {
    ok: true
    payload: unknown
    commands: Array<{ commandId: string; requiredFeatures: string[]; enabled?: boolean }>
    workflowIdAvailable: boolean
  }
  | { ok: false; issues: XrayWorkflowDraftIssue[] }

/** One UPDATE_ENTITY an enabled workflow event trigger already runs (no values). */
export type XrayWorkflowAutomatedUpdate = {
  workflowDefinitionId: string
  workflowId: string
  eventPattern: string
  commandId: string
  inputKeys: string[]
}

export type XrayWorkflowDraftService = {
  validateDraftDefinition: (payload: unknown, scope: XrayWorkflowScope) => Promise<XrayWorkflowDraftValidation>
  getDefinitionForScope: (id: string, scope: XrayWorkflowScope) => Promise<XrayWorkflowDefinitionShape | null>
  /** Optional (added later than the other methods): an older workflows module without it is treated as automating nothing. */
  listAutomatedUpdates?: (scope: XrayWorkflowScope) => Promise<XrayWorkflowAutomatedUpdate[]>
}

function isWorkflowDraftService(value: unknown): value is XrayWorkflowDraftService {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Record<keyof XrayWorkflowDraftService, unknown>>
  return typeof candidate.validateDraftDefinition === 'function' && typeof candidate.getDefinitionForScope === 'function'
}

/** The workflows module's draft service, or `null` when the module (or the service) is absent. */
export function resolveWorkflowDraftService(container: XrayContainer): XrayWorkflowDraftService | null {
  if (typeof container.hasRegistration === 'function' && !container.hasRegistration(WORKFLOW_DRAFT_SERVICE_KEY)) return null
  try {
    const service = container.resolve(WORKFLOW_DRAFT_SERVICE_KEY)
    return isWorkflowDraftService(service) ? service : null
  } catch {
    return null
  }
}
