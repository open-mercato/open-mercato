import type { AiToolDefinition } from './types'

export type ToolInputParseResult =
  | { success: true; data: unknown }
  | { success: false; error: string }

export type StagedToolInputResult =
  | { success: true; input: Record<string, unknown> }
  | { success: false; error: string }

export function readToolAttachmentIds(input: unknown): string[] {
  if (!input || typeof input !== 'object' || !('attachmentIds' in input)) return []
  const ids = input.attachmentIds
  if (!Array.isArray(ids)) return []
  return ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function stripEmptyStrings(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.trim() === '') continue
    result[key] = value
  }
  return result
}

/**
 * Strip empty strings from object values so LLM-generated `""` for optional
 * fields becomes `undefined` (passes `.optional()` Zod validators).
 */
function sanitizeEmptyStrings(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  return stripEmptyStrings(input as Record<string, unknown>)
}

/**
 * Sanitize model-generated tool input and validate it against the tool's
 * schema, the way direct tool execution does before calling the handler.
 */
export function parseToolInput(
  inputSchema: AiToolDefinition['inputSchema'],
  input: unknown,
): ToolInputParseResult {
  const parseResult = inputSchema.safeParse(sanitizeEmptyStrings(input))
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    return { success: false, error: `Invalid input: ${errorMessages || 'Validation failed'}` }
  }
  return { success: true, data: parseResult.data }
}

/**
 * Resolve the input to stage for an approval-gated mutation. Input the tool
 * schema already accepts is staged as sent, matching the confirm-time
 * re-parse. Anything else gets the same blank-string cleanup and validation
 * as direct execution, so input that could only fail after approval is
 * refused before a pending action is created.
 */
export function resolveStagedToolInput(
  inputSchema: AiToolDefinition['inputSchema'],
  input: Record<string, unknown>,
): StagedToolInputResult {
  if (inputSchema.safeParse(input).success) return { success: true, input }
  const sanitizedInput = stripEmptyStrings(input)
  const parseResult = parseToolInput(inputSchema, sanitizedInput)
  if (!parseResult.success) return parseResult
  return { success: true, input: sanitizedInput }
}
