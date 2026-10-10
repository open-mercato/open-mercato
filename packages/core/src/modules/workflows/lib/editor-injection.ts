import { z } from 'zod'
import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'
import type { WorkflowDefinitionTrigger } from '../data/entities'
import { startPreConditionSchema, workflowDefinitionTriggerSchema, type StartPreCondition } from '../data/validators'

/**
 * Injection spots of the workflow definition editor (`backend/definitions/visual-editor`), which is
 * not a CrudForm and so publishes its own:
 * - `workflows.definition.editor:toolbar` — actions rendered next to Save.
 * - `workflows.definition.editor:banner` — banners under the toolbar; after every successful save
 *   the editor dispatches `onAfterSave` to its widgets, and a widget's `onDataChange` may replace
 *   the editor's `triggers`, `enabled` and `version` (validated, nothing else).
 * Both receive `WorkflowDefinitionEditorInjectionContext` as `context` and the current, unsaved
 * `WorkflowDefinitionEditorInjectionData` as `data`.
 */
export const WORKFLOW_DEFINITION_EDITOR_TOOLBAR_SPOT_ID: InjectionSpotId = 'workflows.definition.editor:toolbar'

export const WORKFLOW_DEFINITION_EDITOR_BANNER_SPOT_ID: InjectionSpotId = 'workflows.definition.editor:banner'

export type WorkflowDefinitionEditorInjectionContext = {
  formId: string
  recordId: string | null
  codeOnly: boolean
}

export type WorkflowDefinitionEditorInjectionData = {
  workflowId: string
  version: number
  enabled: boolean
  triggers: WorkflowDefinitionTrigger[]
  startPreConditions: StartPreCondition[]
}

export type WorkflowDefinitionEditorDataChange = {
  version?: number
  enabled?: boolean
  triggers?: WorkflowDefinitionTrigger[]
}

/** A stable id per editor document: the saved definition's id, or `new` while it is unsaved. */
export function workflowDefinitionEditorFormId(definitionId: string | null | undefined): string {
  return `workflows.definition.editor:${definitionId && definitionId.length > 0 ? definitionId : 'new'}`
}

type StartNodeLike = { type?: string | null; data?: unknown }

/** The pre-conditions of the canvas START node, exactly as `graphToDefinition` saves them. */
export function readStartPreConditions(nodes: readonly StartNodeLike[]): StartPreCondition[] {
  const start = nodes.find((node) => node.type === 'start')
  const data = start?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const preConditions = (data as { preConditions?: unknown }).preConditions
  if (!Array.isArray(preConditions)) return []
  const parsed = z.array(startPreConditionSchema).safeParse(preConditions)
  return parsed.success ? parsed.data : []
}

const editorDataChangeSchema = z.object({
  version: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  triggers: z.array(workflowDefinitionTriggerSchema).optional(),
})

/**
 * The editor fields a banner widget may replace through `onDataChange`, validated with the
 * definition schema; anything else in the widget's data is ignored. `null` when nothing valid.
 */
export function readWorkflowDefinitionEditorDataChange(next: unknown): WorkflowDefinitionEditorDataChange | null {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return null
  const record = next as Record<string, unknown>
  const parsed = editorDataChangeSchema.safeParse({
    version: record.version,
    enabled: record.enabled,
    triggers: record.triggers,
  })
  if (!parsed.success) return null
  const change: WorkflowDefinitionEditorDataChange = {}
  if (parsed.data.version !== undefined) change.version = parsed.data.version
  if (parsed.data.enabled !== undefined) change.enabled = parsed.data.enabled
  if (parsed.data.triggers !== undefined) change.triggers = parsed.data.triggers as WorkflowDefinitionTrigger[]
  return Object.keys(change).length > 0 ? change : null
}
