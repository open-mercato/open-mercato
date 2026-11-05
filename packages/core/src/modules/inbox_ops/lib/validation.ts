import type { ZodError } from 'zod'

export function formatZodErrors(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
}

export function safeParsePayloadJson(payloadJson: string | unknown): Record<string, unknown> {
  try {
    return typeof payloadJson === 'string' ? JSON.parse(payloadJson) : {}
  } catch {
    return {}
  }
}
