import { z } from 'zod'

export const storefrontSearchSuggestResponseSchema = z.object({
  products: z.array(
    z.object({
      id: z.string().uuid(),
      handle: z.string().nullable(),
      title: z.string(),
      defaultMediaUrl: z.string().nullable(),
      formattedPrice: z
        .string()
        .nullable()
        .describe('The buyer\'s resolved price (the lowest variant price for products priced per variant)'),
    }),
  ),
  categories: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      slug: z.string().nullable(),
    }),
  ),
  suggestions: z.array(z.string()).describe('Query completions; always empty in this phase'),
  effectiveLocale: z.string(),
})
