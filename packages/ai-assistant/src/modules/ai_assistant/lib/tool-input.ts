import type { AiToolDefinition } from './types'

export type ToolInputParseResult =
  | { success: true; sanitizedInput: unknown; data: unknown }
  | { success: false; error: string }

/**
 * Strip empty strings from object values so LLM-generated `""` for optional
 * fields becomes `undefined` (passes `.optional()` Zod validators).
 */
function sanitizeEmptyStrings(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim() === '') continue
    result[key] = value
  }
  return result
}

/**
 * Sanitize model-generated tool input and validate it against the tool's
 * schema. Direct execution and staging a mutation for confirmation both go
 * through here, so the two paths accept exactly the same input.
 */
export function parseToolInput(
  inputSchema: AiToolDefinition['inputSchema'],
  input: unknown,
): ToolInputParseResult {
  const sanitizedInput = sanitizeEmptyStrings(input)
  const parseResult = inputSchema.safeParse(sanitizedInput)
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    return { success: false, error: `Invalid input: ${errorMessages || 'Validation failed'}` }
  }
  return { success: true, sanitizedInput, data: parseResult.data }
}
