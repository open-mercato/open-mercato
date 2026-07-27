import { z } from 'zod'

/**
 * Reserved runtime input envelope for staging attachment files INTO a file-agent's
 * sandbox (file plane, #12). Carried on a reserved `__files` key OUTSIDE the agent's
 * business `input` schema, so the agent's typed contract stays clean. The runner
 * extracts and strips it before building the model message — it is never forwarded
 * as business data. Inputs are attachment OBJECT IDS only (never inline bytes or raw
 * storage keys), so the attachments module's storage routing, RBAC, and OCR apply.
 */
export const agentFileInputSchema = z
  .object({
    attachments: z
      .array(
        z.object({
          attachmentId: z.string().uuid(),
          /** Override the staged filename (defaults to the attachment's file name). */
          as: z.string().max(255).optional(),
          /** Also stage a `<name>.txt` OCR/text sidecar next to the raw file. */
          ocrText: z.boolean().optional(),
        }),
      )
      .max(20),
  })
  .strict()

export type AgentFileInput = z.infer<typeof agentFileInputSchema>

/** Reserved envelope key on a run's input: `input.__files?: AgentFileInput`. */
export const FILE_INPUT_ENVELOPE_KEY = '__files' as const

/**
 * Split a run input into its business part (envelope stripped) and the parsed
 * `__files` envelope (or null when absent/invalid). Non-object inputs (e.g. a bare
 * string prompt) pass through unchanged with no envelope.
 */
export function extractFileInput(input: unknown): { input: unknown; files: AgentFileInput | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { input, files: null }
  const record = input as Record<string, unknown>
  if (!(FILE_INPUT_ENVELOPE_KEY in record)) return { input, files: null }
  const { [FILE_INPUT_ENVELOPE_KEY]: rawEnvelope, ...business } = record
  const parsed = agentFileInputSchema.safeParse(rawEnvelope)
  return { input: business, files: parsed.success ? parsed.data : null }
}
