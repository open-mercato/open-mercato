import { z } from 'zod'
import { workflowDefinitionDataSchema } from '../data/validators'
import type { WorkflowDefinitionData } from '../data/entities'
import orderApprovalTemplate from '../examples/templates/order-approval.json'
import leadToInstallTemplate from '../examples/templates/lead-to-install.json'
import taskEscalationTemplate from '../examples/templates/task-escalation.json'
import webhookIntegrationTemplate from '../examples/templates/webhook-integration.json'

/**
 * Workflow Template Loader (spec 2026-07-26-workflows-ux-redesign.md
 * section 2.1 "Templates", Phase 1 step 7.1).
 *
 * Templates are portable workflow-definition JSON files shipped under
 * examples/templates/. Each file carries gallery metadata (id, i18n keys,
 * category, icon) plus a complete WorkflowDefinitionData. Files are imported
 * statically (never resolved via fs at runtime) so Next.js file tracing stays
 * scoped to the bundle, and each template is validated against
 * workflowDefinitionDataSchema at load time so a broken template fails loudly
 * in tests and surfaces as a 500 from the list API instead of silently
 * seeding an unloadable workflow.
 */

export const workflowTemplateMetadataSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Template id must contain only lowercase letters, numbers, and hyphens'),
  nameKey: z.string().min(1),
  descriptionKey: z.string().min(1),
  category: z.string().min(1),
  icon: z.string().min(1),
})

export const workflowTemplateFileSchema = workflowTemplateMetadataSchema.extend({
  definition: workflowDefinitionDataSchema,
})

export type WorkflowTemplateMetadata = z.infer<typeof workflowTemplateMetadataSchema>

export type WorkflowTemplate = WorkflowTemplateMetadata & {
  definition: WorkflowDefinitionData
}

export const WORKFLOW_TEMPLATE_FILES = [
  'order-approval.json',
  'lead-to-install.json',
  'task-escalation.json',
  'webhook-integration.json',
] as const

export type WorkflowTemplateFileName = typeof WORKFLOW_TEMPLATE_FILES[number]

const rawWorkflowTemplatesByFile: Record<WorkflowTemplateFileName, unknown> = {
  'order-approval.json': orderApprovalTemplate,
  'lead-to-install.json': leadToInstallTemplate,
  'task-escalation.json': taskEscalationTemplate,
  'webhook-integration.json': webhookIntegrationTemplate,
}

export function getRawWorkflowTemplate(fileName: string): unknown {
  const raw = (rawWorkflowTemplatesByFile as Record<string, unknown>)[fileName]
  if (raw === undefined) {
    throw new Error(`[internal] Missing workflow template file: ${fileName}`)
  }
  return raw
}

export function loadWorkflowTemplate(fileName: string): WorkflowTemplate {
  const result = workflowTemplateFileSchema.safeParse(getRawWorkflowTemplate(fileName))
  if (!result.success) {
    throw new Error(`[internal] Invalid workflow template "${fileName}": ${result.error.message}`)
  }
  return {
    id: result.data.id,
    nameKey: result.data.nameKey,
    descriptionKey: result.data.descriptionKey,
    category: result.data.category,
    icon: result.data.icon,
    definition: result.data.definition as WorkflowDefinitionData,
  }
}

let cachedTemplates: WorkflowTemplate[] | null = null

export function loadWorkflowTemplates(): WorkflowTemplate[] {
  if (!cachedTemplates) {
    cachedTemplates = WORKFLOW_TEMPLATE_FILES.map((fileName) => loadWorkflowTemplate(fileName))
  }
  return cachedTemplates
}

export function clearWorkflowTemplateCacheForTests(): void {
  cachedTemplates = null
}
