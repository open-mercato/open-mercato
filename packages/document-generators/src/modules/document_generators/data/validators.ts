import { z } from 'zod'

/**
 * Body accepted by POST /api/document-generators/generate.
 *
 * `data` is the widget record (shape is a contract between the widget and its
 * DocumentService — kept as a passthrough object). Resource identity is derived
 * server-side by the loaded template and never accepted from the client.
 */
export const generateSchema = z.object({
  template_id: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
})

export type GenerateInput = z.infer<typeof generateSchema>

/**
 * Body accepted by POST /api/document-generators/preview.
 *
 * Same core contract as {@link generateSchema} minus the history `resource_*`
 * fields — preview renders without side effects.
 */
export const previewSchema = z.object({
  template_id: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
})

export type PreviewInput = z.infer<typeof previewSchema>

/** Query params for GET /api/document-generators/documents (generation history). */
export const listDocumentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  resource_kind: z.string().min(1).optional(),
  resource_id: z.string().min(1).optional(),
})

export type ListDocumentsInput = z.infer<typeof listDocumentsSchema>
