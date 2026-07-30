import { findRepoRoot, getMockupBySlug } from '../loader'
import { mockupDocument, type MockupDocument } from '../schema'
import {
  derivePromotion,
  moduleFromRouteHint,
  scaffoldAvailableFromHelp,
} from '../promote'

/**
 * Phase 3 — the promote bridge. The DERIVATION is the tested contract: the
 * purpose-built promotable fixture yields the exact scaffold command line
 * (golden), drafts are refused naming the flag, reserved names are filtered
 * with a report, duplicates fold with required OR-merged, and blocks that
 * don't map are listed as "not scaffolded". Execution is CLI-side, gated by
 * --execute and the runtime availability check (the `module scaffold`
 * subcommand ships with the module-scaffold PR on a separate branch).
 */

const EXPECTED_DSL =
  'name:text:required,email:text,status:select(active|inactive),rating:number,onboardedAt:date,vip:checkbox,notes:textarea'
const EXPECTED_COMMAND = `yarn mercato module scaffold suppliers --entity supplierContact --with-ui --fields "${EXPECTED_DSL}"`

function promotableFixture(): MockupDocument {
  const loaded = getMockupBySlug('suppliers-directory', findRepoRoot(__dirname))
  if (!loaded?.document) throw new Error('Promotable fixture missing or invalid')
  return loaded.document
}

describe('design_system mockup promote derivation', () => {
  it('golden: the promotable fixture derives the exact scaffold command', () => {
    const result = derivePromotion(promotableFixture())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.derivation.entity).toBe('supplierContact')
    expect(result.derivation.module).toBe('suppliers')
    expect(result.derivation.fieldsDsl).toBe(EXPECTED_DSL)
    expect(result.derivation.command).toBe(EXPECTED_COMMAND)
  })

  it('filters reserved field names with a report, never silently', () => {
    const result = derivePromotion(promotableFixture())
    if (!result.ok) throw new Error(result.error)
    expect(result.derivation.skippedFields).toEqual([
      {
        name: 'createdAt',
        blockId: 'directory-table',
        reason: 'reserved name, the scaffold generator owns this field',
      },
    ])
    expect(result.derivation.fields.map((field) => field.name)).not.toContain('createdAt')
  })

  it('folds duplicate names into the first occurrence with required OR-merged', () => {
    const result = derivePromotion(promotableFixture())
    if (!result.ok) throw new Error(result.error)
    expect(result.derivation.mergedDuplicates).toEqual([
      { name: 'name', blockId: 'quick-add-name' },
    ])
    const nameField = result.derivation.fields.find((field) => field.name === 'name')
    // The table column came first (not required); the required form field
    // hardens it.
    expect(nameField).toMatchObject({ required: true, type: 'text', blockId: 'directory-table' })
  })

  it('lists blocks that do not map as not scaffolded (placeholders and bespoke blocks)', () => {
    const result = derivePromotion(promotableFixture())
    if (!result.ok) throw new Error(result.error)
    expect(result.derivation.unmapped.map((block) => block.id).sort()).toEqual([
      'contract-panel',
      'directory-kpi',
    ])
    // Chrome the scaffold provides itself (header, filter bar) is neither a
    // field source nor an unmapped leftover.
    expect(result.derivation.unmapped.map((block) => block.id)).not.toContain('directory-header')
    expect(result.derivation.unmapped.map((block) => block.id)).not.toContain('directory-filters')
  })

  it('refuses drafts, naming the flag', () => {
    const draft = mockupDocument.parse({
      ...JSON.parse(JSON.stringify(promotableFixture())),
      draft: true,
    })
    const result = derivePromotion(draft)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('draft: true')
    expect(result.error).toContain('never auto-final')
  })

  it('refuses the committed generated draft fixture (exit-1 path of the CLI)', () => {
    const loaded = getMockupBySlug('customers-quick-add', findRepoRoot(__dirname))
    if (!loaded?.document) throw new Error('Draft fixture missing or invalid')
    const result = derivePromotion(loaded.document)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('draft: true')
  })

  it('requires an entity (document hint or --entity)', () => {
    const document = mockupDocument.parse({
      ...JSON.parse(JSON.stringify(promotableFixture())),
      entity: undefined,
    })
    const withoutHint = derivePromotion(document)
    expect(withoutHint.ok).toBe(false)
    if (!withoutHint.ok) expect(withoutHint.error).toContain('--entity')
    const withFlag = derivePromotion(document, { entity: 'supplierContact' })
    expect(withFlag.ok).toBe(true)
  })

  it('refuses mockups without mappable blocks (the Phase 1 golden mockup)', () => {
    const golden = getMockupBySlug('customers-people-list', findRepoRoot(__dirname))
    if (!golden?.document) throw new Error('Golden mockup missing or invalid')
    const result = derivePromotion(golden.document, { entity: 'person' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('no mappable')
  })

  it('falls back to the route hint for the module id', () => {
    expect(moduleFromRouteHint('/backend/suppliers/contacts')).toBe('suppliers')
    expect(moduleFromRouteHint('/backend/customers')).toBe('customers')
    expect(moduleFromRouteHint('/frontend/shop')).toBeNull()
    expect(moduleFromRouteHint(undefined)).toBeNull()
    const document = mockupDocument.parse({
      ...JSON.parse(JSON.stringify(promotableFixture())),
      module: undefined,
    })
    const result = derivePromotion(document)
    if (!result.ok) throw new Error(result.error)
    expect(result.derivation.module).toBe('suppliers')
  })

  it('detects scaffold availability from the module help output', () => {
    // This branch: the subcommand ships with the module-scaffold PR and is absent.
    expect(
      scaffoldAvailableFromHelp('Usage: yarn mercato module <add|enable|eject> ...'),
    ).toBe(false)
    expect(
      scaffoldAvailableFromHelp(
        'Usage: yarn mercato module <add|enable|eject|scaffold> ...\n  yarn mercato module scaffold <module> --entity <name> --with-ui --fields "..."',
      ),
    ).toBe(true)
  })
})
