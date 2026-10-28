import { z } from 'zod'
import { storefrontProductListResponseSchema } from '../products/openapiSchemas'

export type StorefrontCategoryNodeSchema = {
  id: string
  name: string
  slug: string | null
  description: string | null
  depth: number
  parentId: string | null
  productCount: number | null
  hasChildren: boolean
  children: StorefrontCategoryNodeSchema[]
}

export const storefrontCategoryNodeSchema: z.ZodType<StorefrontCategoryNodeSchema> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    depth: z.number().int(),
    parentId: z.string().uuid().nullable(),
    productCount: z
      .number()
      .int()
      .nullable()
      .describe(
        'Products of the buyer\'s effective assortment in this category or a descendant; null when the assortment is too large to count',
      ),
    hasChildren: z.boolean(),
    children: z.array(storefrontCategoryNodeSchema),
  }),
)

export const storefrontCategoryTreeResponseSchema = z.object({
  tree: z.array(storefrontCategoryNodeSchema),
  effectiveLocale: z.string(),
})

export const storefrontCategoryLandingResponseSchema = z.object({
  category: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    depth: z.number().int(),
    parentId: z.string().uuid().nullable(),
    ancestorIds: z.array(z.string().uuid()),
    breadcrumb: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string().nullable() })),
    children: z.array(
      z.object({ id: z.string().uuid(), name: z.string(), slug: z.string().nullable(), productCount: z.number().int().nullable() }),
    ),
    productCount: z.number().int().nullable(),
    seo: z.object({
      title: z.string().nullable(),
      description: z.string().nullable(),
      canonicalUrl: z.string().nullable(),
    }),
  }),
  products: storefrontProductListResponseSchema.describe('Identical to GET /products with the category filter applied'),
  effectiveLocale: z.string(),
})
