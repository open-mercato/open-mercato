import { z } from 'zod'
import { STANDARD_PDF_FONT_FAMILIES } from '../providers/react-pdf/constants'
import { fontSourceLocation, isAbsolutePath, isNpmPackageName, isRelativePathInsidePackage, isWoff2Font } from '../utils/fontSources'

const trimmedNonEmpty = z.string().trim().min(1)

const documentPayloadShape = {
  template_id: trimmedNonEmpty,
  template_version: trimmedNonEmpty.max(64).optional(),
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

const fontWeightSchema = z.union([z.number().int().min(100).max(900), z.enum(['normal', 'bold'])])
const fontStyleSchema = z.enum(['normal', 'italic'])

const fontSourceBaseSchema = z.object({
  fontWeight: fontWeightSchema.optional(),
  fontStyle: fontStyleSchema.optional(),
})

const fontSourceConfigSchema = z.union([
  fontSourceBaseSchema.extend({
    package: trimmedNonEmpty.refine(isNpmPackageName, { message: 'package must be an npm package name' }),
    file: trimmedNonEmpty.refine(isRelativePathInsidePackage, { message: 'file must be a relative path inside the package' }),
  }).strict(),
  fontSourceBaseSchema.extend({
    path: trimmedNonEmpty.refine(isAbsolutePath, { message: 'path must be absolute' }),
  }).strict(),
  fontSourceBaseSchema.extend({ url: z.string().trim().url() }).strict(),
])

const fontFamilyConfigSchema = z.object({
  family: trimmedNonEmpty,
  sources: z.array(fontSourceConfigSchema).min(1),
}).strict()

const fontFamilyNameSchema = z.union([trimmedNonEmpty, z.array(trimmedNonEmpty).min(1)])

export const reactPdfConfigSchema = z.object({
  fontFamily: fontFamilyNameSchema.optional(),
  fonts: z.array(fontFamilyConfigSchema).optional(),
}).strict().superRefine((config, ctx) => {
  config.fonts?.forEach((font, fontIndex) => font.sources.forEach((source, sourceIndex) => {
    if (!isWoff2Font(fontSourceLocation(source))) return
    ctx.addIssue({
      code: 'custom',
      path: ['fonts', fontIndex, 'sources', sourceIndex],
      message: 'WOFF2 fonts cannot be embedded by React-PDF; use a .ttf, .otf or .woff file',
    })
  }))
  if (config.fontFamily === undefined) return
  const knownFamilies = new Set([...STANDARD_PDF_FONT_FAMILIES, ...(config.fonts ?? []).map((font) => font.family)])
  const names = Array.isArray(config.fontFamily) ? config.fontFamily : [config.fontFamily]
  for (const name of names) {
    if (knownFamilies.has(name)) continue
    ctx.addIssue({
      code: 'custom',
      path: ['fontFamily'],
      message: `font family "${name}" is neither listed in fonts nor a standard PDF font`,
    })
  }
})

const documentGeneratorsProviderSchema = z.object({
  id: trimmedNonEmpty,
  config: z.record(z.string(), z.unknown()).optional(),
}).strict()

export const documentGeneratorsConfigSchema = z.object({
  providers: z.array(documentGeneratorsProviderSchema).optional(),
}).strict().superRefine((config, ctx) => {
  const seen = new Set<string>()
  config.providers?.forEach((provider, index) => {
    if (seen.has(provider.id)) {
      ctx.addIssue({ code: 'custom', path: ['providers', index, 'id'], message: `duplicate provider id "${provider.id}"` })
    }
    seen.add(provider.id)
  })
})

export type PreviewInput = z.infer<typeof previewSchema>
export type GenerateInput = z.infer<typeof generateSchema>
export type ListTemplatesQuery = z.infer<typeof listTemplatesSchema>
export type ListDocumentsQuery = z.infer<typeof listDocumentsSchema>
export type FontFamilyName = z.infer<typeof fontFamilyNameSchema>
export type FontSourceConfig = z.infer<typeof fontSourceConfigSchema>
export type FontFamilyConfig = z.infer<typeof fontFamilyConfigSchema>
export type ReactPdfConfig = z.infer<typeof reactPdfConfigSchema>
export type DocumentGeneratorsProviderConfig = z.infer<typeof documentGeneratorsProviderSchema>
export type DocumentGeneratorsConfig = z.infer<typeof documentGeneratorsConfigSchema>
