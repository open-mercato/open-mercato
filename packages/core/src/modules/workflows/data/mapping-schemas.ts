import { z } from 'zod'
import { isSafeMappingPath } from '../lib/safe-mapping-path'

function isWorkflowMapping(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([targetPath, sourcePath]) =>
      typeof sourcePath === 'string' &&
      isSafeMappingPath(targetPath) &&
      isSafeMappingPath(sourcePath),
  )
}

export const workflowMappingSchema = z.custom<Record<string, string>>(isWorkflowMapping, {
  message: 'Mappings must use string paths without __proto__, constructor, or prototype segments',
})
