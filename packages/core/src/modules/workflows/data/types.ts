import type { WorkflowContextSchema, WorkflowDefinitionTrigger } from './entities'
import type { WorkflowErrorHandlerConfig } from './validators'
import type { WorkflowInterpolationMode } from '../lib/interpolation-pipeline'

// Re-export from validators (includes ESCALATED)
export type { UserTaskStatus } from './validators'

// JSON Schema types (moved from MobileTaskForm)
export interface JsonSchema {
  type?: string
  title?: string
  properties?: Record<string, JsonSchemaField>
  required?: string[]
}

export interface JsonSchemaField {
  type?: string
  title?: string
  enum?: string[]
  format?: string
  description?: string
  maxLength?: number
}

// API response shape (serialized — string dates, proper formSchema/formData types)
export type UserTaskResponse = {
  id: string
  workflowInstanceId: string
  stepInstanceId: string
  taskName: string
  description: string | null
  status: import('./validators').UserTaskStatus
  formSchema: JsonSchema | null
  formData: Record<string, string | number | boolean> | null
  assignedTo: string | null
  assignedToRoles: string[] | null
  claimedBy: string | null
  claimedAt: string | null
  dueDate: string | null
  completedBy: string | null
  completedAt: string | null
  comments: string | null
  tenantId: string
  organizationId: string
  createdAt: string
  updatedAt: string
  /**
   * Work-item projection added by `api/tasks/serialize.ts`; optional here
   * because third-party callers may still be reading a pre-Phase-4 payload.
   */
  kind?: string
  proposalId?: string | null
  priority?: string | number | null
  entityBindings?: UserTaskEntityBinding[] | null
  /** Definition step the task is parked on, when it could be resolved. */
  stepId?: string | null
  /**
   * Decision buttons, re-resolved per request from the instance's pinned
   * definition. Never stored on the task row — see `lib/task-decisions.ts`.
   */
  decisions?: UserTaskDecision[]
  /**
   * Authored external-form renderer key, re-resolved per request from the
   * instance's pinned definition alongside `decisions`. Null means the built-in
   * form; an unknown key degrades to the built-in form WITH a notice, never a
   * blank screen (`lib/task-form-registry.ts`).
   */
  formKey?: string | null
  /**
   * The §6.4 act surfaces, decided server-side (`lib/task-visibility.ts`).
   *
   * Optional because they are ADDITIVE: a payload written before they existed
   * carries none, and a consumer reading one must keep working. The detail route
   * always sends them — a page that derives `canComplete` from the status is the
   * second implementation of the rule these fields exist to remove.
   */
  canComplete?: boolean
  canClaim?: boolean
  canRelease?: boolean
  canReassign?: boolean
  actBlockedReason?: TaskActionBlockReason | null
}

/**
 * Why completion is unavailable to a caller who can read the row. Mirrors
 * `lib/task-visibility.ts`; `unavailable` is deliberately non-diagnostic,
 * because it stands for the entity-gate refusal the act routes answer as a bare
 * 404, and must stay that way.
 */
export type TaskActionBlockReason =
  | 'not-workable'
  | 'owned-by-another'
  | 'not-in-your-queue'
  | 'unowned'
  | 'unavailable'

export type UserTaskEntityBinding = {
  entityType: string
  entityId: string
  label?: string | Record<string, string> | null
}

export type UserTaskDecision = {
  id: string
  label: string | Record<string, string>
  transitionId: string
  style?: 'primary' | 'secondary' | 'destructive'
}

/**
 * Grouped definition-metadata state shared by every surface that edits it
 * (the Studio's details drawer and the mobile editor).
 *
 * `contextSchema`, `interpolation` and `errorHandler` are OPTIONAL because
 * they were added after the shape shipped; a caller that omits them keeps the
 * pre-existing behaviour and the drawer simply hides the sections it cannot
 * write to. They are not "unused metadata" — omitting them from a save payload
 * silently drops the author's configuration, which is why the Studio always
 * carries them.
 */
export interface WorkflowMetadataState {
  workflowId: string
  workflowName: string
  description: string
  version: number
  enabled: boolean
  category: string
  tags: string[]
  icon: string
  effectiveFrom: string
  effectiveTo: string
  triggers: WorkflowDefinitionTrigger[]
  contextSchema?: WorkflowContextSchema | undefined
  interpolation?: WorkflowInterpolationMode | undefined
  errorHandler?: WorkflowErrorHandlerConfig | undefined
}

export interface WorkflowMetadataHandlers {
  setWorkflowId: (v: string) => void
  setWorkflowName: (v: string) => void
  setDescription: (v: string) => void
  setVersion: (v: number) => void
  setEnabled: (v: boolean) => void
  setCategory: (v: string) => void
  setTags: (v: string[]) => void
  setIcon: (v: string) => void
  setEffectiveFrom: (v: string) => void
  setEffectiveTo: (v: string) => void
  setTriggers: (v: WorkflowDefinitionTrigger[]) => void
  setContextSchema?: (v: WorkflowContextSchema | undefined) => void
  setInterpolation?: (v: WorkflowInterpolationMode) => void
  setErrorHandler?: (v: WorkflowErrorHandlerConfig | undefined) => void
}
