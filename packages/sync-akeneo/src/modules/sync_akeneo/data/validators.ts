import { z } from 'zod'

export const akeneoDiscoveryQuerySchema = z.object({
  refresh: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
})

export const akeneoDiscoveryResponseSchema = z.object({
  ok: z.boolean(),
  locales: z.array(z.object({
    code: z.string(),
    label: z.string(),
    enabled: z.boolean().optional(),
  })).default([]),
  channels: z.array(z.object({
    code: z.string(),
    label: z.string(),
    locales: z.array(z.string()).default([]),
  })).default([]),
  attributes: z.array(z.object({
    code: z.string(),
    type: z.string(),
    label: z.string(),
    localizable: z.boolean().default(false),
    scopable: z.boolean().default(false),
    group: z.string().optional(),
    metricFamily: z.string().optional(),
  })).default([]),
  families: z.array(z.object({
    code: z.string(),
    label: z.string(),
    attributeCount: z.number().int().nonnegative(),
  })).default([]),
  familyVariants: z.array(z.object({
    familyCode: z.string(),
    code: z.string(),
    label: z.string(),
    axes: z.array(z.string()).default([]),
    attributes: z.array(z.string()).default([]),
  })).default([]),
  localChannels: z.array(z.object({
    code: z.string(),
    name: z.string(),
  })).default([]),
  priceKinds: z.array(z.object({
    code: z.string(),
    title: z.string(),
    displayMode: z.string(),
  })).default([]),
  message: z.string().optional(),
})

export type AkeneoDiscoveryResponse = z.infer<typeof akeneoDiscoveryResponseSchema>
