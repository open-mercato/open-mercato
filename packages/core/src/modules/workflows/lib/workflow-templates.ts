import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { workflowDefinitionDataSchema } from '../data/validators'
import type { WorkflowDefinitionData } from '../data/entities'

/**
 * Workflow Template Loader (spec 2026-07-26-workflows-ux-redesign.md
 * section 2.1 "Templates", Phase 1 step 7.1).
 *
 * Templates are portable workflow-definition JSON files shipped under
 * examples/templates/. Each file carries gallery metadata (id, i18n keys,
 * category, icon) plus a complete WorkflowDefinitionData. Files are
 * validated against workflowDefinitionDataSchema at load time so a broken
 * template fails loudly in tests and surfaces as a 500 from the list API
 * instead of silently seeding an unloadable workflow.
 */

const __esmDirname = path.dirname(fileURLToPath(import.meta.url))

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

export function resolveWorkflowTemplatePath(fileName: string): string {
  const candidates = [
    path.join(__esmDirname, '..', 'examples', 'templates', fileName),
    path.join(process.cwd(), 'packages', 'core', 'src', 'modules', 'workflows', 'examples', 'templates', fileName),
    path.join(process.cwd(), 'src', 'modules', 'workflows', 'examples', 'templates', fileName),
  ]
  const filePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!filePath) {
    throw new Error(`[internal] Missing workflow template file: ${fileName}`)
  }
  return filePath
}

export function loadWorkflowTemplate(fileName: string): WorkflowTemplate {
  const raw: unknown = JSON.parse(fs.readFileSync(resolveWorkflowTemplatePath(fileName), 'utf8'))
  const result = workflowTemplateFileSchema.safeParse(raw)
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
