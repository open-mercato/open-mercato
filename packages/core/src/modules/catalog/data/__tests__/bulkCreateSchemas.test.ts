import { categoriesBulkCreateSchema, productsBulkCreateSchema } from '../validators'

/**
 * The batch caps are published in `apps/docs/docs/api/catalog.mdx`. Pinning them here means a
 * change to either limit fails a test instead of silently making the documented contract wrong.
 */
describe('bulk-create batch size caps', () => {
  const categoryRow = { name: 'Category' }
  const productRow = { title: 'Product' }

  it('accepts a categories batch at the documented 10,000-row cap and rejects one row more', () => {
    expect(categoriesBulkCreateSchema.safeParse({ items: Array(10_000).fill(categoryRow) }).success).toBe(true)
    expect(categoriesBulkCreateSchema.safeParse({ items: Array(10_001).fill(categoryRow) }).success).toBe(false)
  })

  it('accepts a products batch at the documented 2,000-row cap and rejects one row more', () => {
    expect(productsBulkCreateSchema.safeParse({ items: Array(2_000).fill(productRow) }).success).toBe(true)
    expect(productsBulkCreateSchema.safeParse({ items: Array(2_001).fill(productRow) }).success).toBe(false)
  })

  it('rejects an empty batch on both endpoints', () => {
    expect(categoriesBulkCreateSchema.safeParse({ items: [] }).success).toBe(false)
    expect(productsBulkCreateSchema.safeParse({ items: [] }).success).toBe(false)
  })

  it('reports the failing row index in the issue path so the route can surface it', () => {
    const parsed = categoriesBulkCreateSchema.safeParse({ items: [categoryRow, { slug: 'no-name' }] })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues.some((issue) => issue.path.join('.') === 'items.1.name')).toBe(true)
  })
})
