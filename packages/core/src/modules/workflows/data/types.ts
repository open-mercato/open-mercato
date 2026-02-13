import type { WorkflowDefinitionTrigger } from './entities'

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
}

// Grouped metadata state for MobileVisualEditor / MobileMetadataSheet
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
}
