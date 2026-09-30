/** @jest-environment node */

/**
 * Contract guards for the catalog product form's section table.
 *
 * The ids are a protected surface (`BACKWARD_COMPATIBILITY.md` §3, built-in
 * `CrudFormGroup.id` values): an app names them in
 * `overrides.forms.sections['crud-form:catalog.product']`, and an unmatched id
 * is ignored rather than erroring — so a silent rename would quietly un-hide a
 * card an app had deliberately hidden.
 *
 * The ownership guard is the other half: it fails the build when a form field
 * belongs to no section, because such a field would be invisible to the
 * restore-before-validation step and would therefore leak an edit into a
 * payload the policy meant to exclude.
 */

import { BASE_INITIAL_VALUES } from '../productForm'
import {
  CATALOG_PRODUCT_FORM_HOST_ID,
  CATALOG_PRODUCT_FORM_SECTIONS,
  CATALOG_PRODUCT_FORM_SECTION_IDS,
  getCatalogProductFormSection,
  isCatalogProductFormSectionId,
} from '../formSections'

describe('catalog product form section ids', () => {
  it('pins the ten shipped ids and their order', () => {
    expect([...CATALOG_PRODUCT_FORM_SECTION_IDS]).toEqual([
      'details',
      'dimensions',
      'metadata',
      'options',
      'product-uom',
      'compliance',
      'variants',
      'meta',
      'categorize',
      'custom-fields',
    ])
  })

  it('pins the host id the policy is keyed on', () => {
    // This is the documented `crud-form:<entityId>` spot the catalog module
    // declares in `extension-points.ts`; an app writes it verbatim.
    expect(CATALOG_PRODUCT_FORM_HOST_ID).toBe('crud-form:catalog.product')
  })

  it('has exactly one descriptor per id, in the same order', () => {
    expect(CATALOG_PRODUCT_FORM_SECTIONS.map((section) => section.id)).toEqual([
      ...CATALOG_PRODUCT_FORM_SECTION_IDS,
    ])
  })

  it('resolves a known id and rejects an unknown one', () => {
    expect(getCatalogProductFormSection('compliance')?.id).toBe('compliance')
    expect(isCatalogProductFormSectionId('compliance')).toBe(true)
    expect(isCatalogProductFormSectionId('nope')).toBe(false)
    // A widget card id must never resolve as a built-in section.
    expect(isCatalogProductFormSectionId('widget:some.widget')).toBe(false)
  })
})

describe('catalog product form field ownership', () => {
  /**
   * Form keys deliberately owned by no section, each with the reason it is
   * exempt. Anything else must be attributed, or the guard below fails.
   */
  const UNOWNED_FIELDS: Record<string, string> = {}

  it('attributes every editable form field to exactly one section', () => {
    const owned = new Map<string, string>()
    const duplicates: string[] = []
    for (const section of CATALOG_PRODUCT_FORM_SECTIONS) {
      for (const field of section.ownedFields) {
        const key = String(field)
        if (owned.has(key)) duplicates.push(`${key} (${owned.get(key)} + ${section.id})`)
        else owned.set(key, section.id)
      }
    }

    expect(duplicates).toEqual([])

    const formKeys = Object.keys(BASE_INITIAL_VALUES)
    const unattributed = formKeys.filter(
      (key) => !owned.has(key) && !(key in UNOWNED_FIELDS),
    )

    // A new form field added without an owning section would show up here. That
    // matters because an unowned field is never restored when its card is
    // hidden, so an edit to it would ride along into a payload the app's policy
    // meant to exclude.
    expect(unattributed).toEqual([])
  })

  it('does not claim ownership of fields the form does not have', () => {
    const formKeys = new Set(Object.keys(BASE_INITIAL_VALUES))
    const phantom = CATALOG_PRODUCT_FORM_SECTIONS.flatMap((section) =>
      section.ownedFields.map(String).filter((field) => !formKeys.has(field)),
    )

    expect(phantom).toEqual([])
  })

  it('gives the sections that own writes their write hooks, and no others', () => {
    const withWrites = CATALOG_PRODUCT_FORM_SECTIONS.filter(
      (section) => section.writeBefore || section.writeAfter,
    ).map((section) => section.id)

    // Only two sections own secondary writes: `product-uom` synchronises the
    // product-unit-conversion records after the product write, and `categorize`
    // deletes offers for de-selected channels before it. Any third entry here
    // is a write that the policy would not be able to disable.
    expect(withWrites.sort()).toEqual(['categorize', 'product-uom'])
  })

  it('gives every section that contributes payload keys a buildPayload', () => {
    const withoutPayload = CATALOG_PRODUCT_FORM_SECTIONS.filter(
      (section) => !section.buildPayload,
    ).map((section) => section.id)

    // `variants` is the only read-only section: variant records are written
    // through their own routes inside the card, never through this submit.
    expect(withoutPayload).toEqual(['variants'])
  })
})
