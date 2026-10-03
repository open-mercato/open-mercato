import { z } from 'zod'

const trimmedNonEmpty = z.string().trim().min(1)

const documentPayloadShape = {
  template_id: trimmedNonEmpty,
  data: z.record(z.string(), z.unknown()),
}

export const previewSchema = z.object(documentPayloadShape).strict()
export const generateSchema = z.object(documentPayloadShape).strict()

export const listTemplatesSchema = z.object({
  resource_kind: trimmedNonEmpty.optional(),
  document_type: trimmedNonEmpty.optional(),
  format: trimmedNonEmpty.optional(),
  tags: z.preprocess(
    (value) => (typeof value === 'string' ? [value] : value),
    z.array(trimmedNonEmpty).min(1),
  ).optional(),
})

export const DOCUMENT_SORT_FIELDS = ['template_label', 'format', 'generated_by', 'generated_at'] as const

const isoDatetime = z.string().datetime({ offset: true })

export const listDocumentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  resource_kind: trimmedNonEmpty.optional(),
  resource_id: trimmedNonEmpty.optional(),
  template_id: trimmedNonEmpty.optional(),
  generated_by: z.string().uuid().optional(),
  generated_from: isoDatetime.optional(),
  generated_to: isoDatetime.optional(),
  sort: z.enum(DOCUMENT_SORT_FIELDS).default('generated_at'),
  sort_direction: z.enum(['asc', 'desc']).default('desc'),
})
  .refine((value) => (value.resource_kind === undefined) === (value.resource_id === undefined), {
    message: 'resource_kind and resource_id must be provided together',
    path: ['resource_id'],
  })
  .refine(
    (value) => !value.generated_from || !value.generated_to
      || Date.parse(value.generated_from) <= Date.parse(value.generated_to),
    { message: 'generated_from must not be later than generated_to', path: ['generated_from'] },
  )

export type PreviewInput = z.infer<typeof previewSchema>
export type GenerateInput = z.infer<typeof generateSchema>
export type ListTemplatesQuery = z.infer<typeof listTemplatesSchema>
export type ListDocumentsQuery = z.infer<typeof listDocumentsSchema>

export function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key)
    result[key] = key === 'tags' ? values : values[values.length - 1]
  }
  return result
}
