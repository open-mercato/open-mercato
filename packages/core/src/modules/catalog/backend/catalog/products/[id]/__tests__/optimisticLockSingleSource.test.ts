import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const productPageSource = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8')
const variantPageSource = readFileSync(
  join(__dirname, '..', '..', '[productId]', 'variants', '[variantId]', 'page.tsx'),
  'utf8',
)

describe('catalog edit pages — optimistic-lock single header source', () => {
  it('product UPDATE is single-sourced (bare updateCrud; CrudForm auto-derives from initialValues.updatedAt)', () => {
    // The product update itself must NOT manually wrap the header — CrudForm
    // auto-derives it from initialValues.updatedAt, so the call stays bare.
    expect(productPageSource).toContain('await updateCrud("catalog/products", payload)')
  })

  it('inline variant-list delete keeps its own explicit lock header + conflict bar (not a CrudForm submit)', () => {
    // The variant delete in the product page variant list is a custom deleteCrud,
    // not a CrudForm submit, so it must wire the header explicitly (#2055 round-3).
    expect(productPageSource).toContain('buildOptimisticLockHeader(variant.updatedAt)')
    expect(productPageSource).toContain('surfaceRecordConflict(err, t)')
  })

  it('product edit page still feeds CrudForm an initialValues.updatedAt so the auto-derive can attach the header', () => {
    expect(productPageSource).toContain('updatedAt:')
    expect(productPageSource).toContain('initialValues={initialValues ?? undefined}')
  })

  it('product edit page re-syncs initialValues to the just-saved form values after every submit, so a second consecutive save does not send a stale optimistic-lock header and CrudForm does not snap fields back to their pre-save snapshot (#5985)', () => {
    expect(productPageSource).toContain('const updateResult = await updateCrud("catalog/products", payload)')
    expect(productPageSource).toContain('setInitialValues((prev) =>')
    // Must merge the full submitted `formValues`, not just `updatedAt` — CrudForm
    // reconciles `values` against `initialValues` on every change and re-applies
    // every field the user isn't still mid-edit on, so refreshing `updatedAt` alone
    // would leave every other field pinned to its pre-save snapshot.
    expect(productPageSource).toContain('...formValues,')
  })

  it('variant UPDATE is single-sourced (bare updateCrud; CrudForm auto-derives), while the price sync sends each price its own version', () => {
    // The variant update itself stays bare — CrudForm auto-derives the variant
    // header from initialValues.updatedAt.
    expect(variantPageSource).toContain("await updateCrud('catalog/variants', payload)")
    // The catalog/prices sub-sync runs inside the same submit scope, so it must
    // override the leaked variant header with each price's own version (#2055).
    expect(variantPageSource).toContain('buildOptimisticLockHeader(lockVersion)')
    expect(variantPageSource).toContain("updateCrud('catalog/prices'")
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
