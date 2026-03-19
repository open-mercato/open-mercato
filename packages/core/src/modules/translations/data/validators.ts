import { z } from 'zod'

export const translationBodySchema = z
  .record(
    z.string().trim().min(2).max(10),
    z.record(
      z.string().trim().min(1).max(100),
      z.union([z.string().max(10000), z.null()]),
    ),
  )
  .refine((obj) => Object.keys(obj).length <= 50, 'Maximum 50 locales per entity')

export type TranslationBody = z.infer<typeof translationBodySchema>

export const entityTypeParamSchema = z.string().min(1).regex(/^[a-z_]+:[a-z_]+$/)

export const entityIdParamSchema = z.string().min(1)
