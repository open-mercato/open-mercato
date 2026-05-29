import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const productPageSource = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8')
const variantPageSource = readFileSync(
  join(__dirname, '..', '..', '[productId]', 'variants', '[variantId]', 'page.tsx'),
  'utf8',
)

describe('catalog edit pages — optimistic-lock single header source', () => {
  it('product edit page no longer manually wires the lock header (CrudForm auto-derives from initialValues.updatedAt)', () => {
    expect(productPageSource).not.toContain('buildOptimisticLockHeader')
    expect(productPageSource).not.toContain('withScopedApiRequestHeaders')
    expect(productPageSource).toContain('await updateCrud("catalog/products", payload)')
  })

  it('product edit page still feeds CrudForm an initialValues.updatedAt so the auto-derive can attach the header', () => {
    expect(productPageSource).toContain('updatedAt:')
    expect(productPageSource).toContain('initialValues={initialValues ?? undefined}')
  })

  it('variant edit page no longer manually wires the lock header on update or delete', () => {
    expect(variantPageSource).not.toContain('buildOptimisticLockHeader')
    expect(variantPageSource).not.toContain('withScopedApiRequestHeaders')
    expect(variantPageSource).toContain("await updateCrud('catalog/variants', payload)")
  })

  it('variant edit page keeps the delete-conflict UX (handleVariantDeleteError + surfaceRecordConflict)', () => {
    expect(variantPageSource).toContain('handleVariantDeleteError(err, t)')
    expect(variantPageSource).toContain('surfaceRecordConflict')
  })

  it('variant edit page still feeds CrudForm an initialValues.updatedAt for the auto-derive', () => {
    expect(variantPageSource).toContain('updatedAt:')
    expect(variantPageSource).toContain('initialValues={initialValues ?? undefined}')
  })
})
