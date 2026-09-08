/**
 * @jest-environment node
 */
import path from 'node:path'
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { extractModuleExtensionFacts } from '@open-mercato/cli/lib/generators/module-extension-facts'

const RETIRED_FLAG_NAME = 'NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED'
const CRUDFORM_FLAG_NAME = 'NEXT_PUBLIC_OM_CRUDFORM_EXTENDED_EVENTS_ENABLED'
const originalRetiredFlagValue = process.env[RETIRED_FLAG_NAME]
const originalCrudFormFlagValue = process.env[CRUDFORM_FLAG_NAME]

const moduleRoot = path.join(__dirname, '..', '..')

const CROSS_MODULE_SPOT_IDS = [
  'crud-form:customers.person:fields',
  'crud-form:customers.customer_entity:fields',
  'data-table:customers.people:columns',
  'data-table:customers.people.list:columns',
  'data-table:customers.people:filters',
  'data-table:customers.people.list:filters',
  'data-table:customers.people:row-actions',
  'data-table:customers.people.list:row-actions',
  'data-table:customers.people:bulk-actions',
  'data-table:customers.people.list:bulk-actions',
  'customers.person.detail:details',
  'crud-form:catalog.product',
  'crud-form:catalog.catalog_product',
  'crud-form:catalog.variant',
  'crud-form:catalog.catalog_variant',
  'sales.document.detail.quote:tabs',
  'sales.document.detail.order:tabs',
  'data-table:catalog.products:header',
] as const

const EXAMPLE_OWN_SPOT_IDS = [
  'portal:dashboard:sections',
  'crud-form:example.todo',
  'widget:example.injection.crud-validation:addon',
  'example:phase-c-handlers',
  'menu:sidebar:main',
  'menu:topbar:profile-dropdown',
] as const

async function loadInjectionTableWithEnv(env: Record<string, string | undefined>): Promise<ModuleInjectionTable> {
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string') process.env[name] = value
    else delete process.env[name]
  }
  jest.resetModules()
  const mod = await import('../injection-table')
  return mod.injectionTable
}

function readInjectionTableContributionIds(): string[] {
  const facts = extractModuleExtensionFacts({
    moduleId: 'example',
    moduleRoot,
    sourceRoot: 'src/modules/example',
    entities: [],
    events: [],
    apiRoutes: [],
    searchEntities: [],
  })
  return facts.contributions
    .filter((contribution) => contribution.source?.symbol === 'injectionTable')
    .map((contribution) => contribution.id)
    .sort()
}

describe('example injection-table', () => {
  afterEach(() => {
    if (typeof originalRetiredFlagValue === 'string') process.env[RETIRED_FLAG_NAME] = originalRetiredFlagValue
    else delete process.env[RETIRED_FLAG_NAME]
    if (typeof originalCrudFormFlagValue === 'string') process.env[CRUDFORM_FLAG_NAME] = originalCrudFormFlagValue
    else delete process.env[CRUDFORM_FLAG_NAME]
    jest.resetModules()
  })

  it('ships every spot unconditionally, with no env flag able to remove one', async () => {
    const withoutFlags = await loadInjectionTableWithEnv({
      [RETIRED_FLAG_NAME]: undefined,
      [CRUDFORM_FLAG_NAME]: undefined,
    })
    for (const spotId of [...EXAMPLE_OWN_SPOT_IDS, ...CROSS_MODULE_SPOT_IDS]) {
      expect(withoutFlags[spotId]).toBeDefined()
    }

    // The retired flag is dead config: setting it to its old "off" value must not
    // subtract a single spot any more.
    const withRetiredFlagOff = await loadInjectionTableWithEnv({
      [RETIRED_FLAG_NAME]: 'false',
      [CRUDFORM_FLAG_NAME]: 'false',
    })
    expect(Object.keys(withRetiredFlagOff).sort()).toEqual(Object.keys(withoutFlags).sort())
  })

  it('keeps the example-owned demo surfaces pointed at their widgets', async () => {
    const table = await loadInjectionTableWithEnv({
      [RETIRED_FLAG_NAME]: undefined,
      [CRUDFORM_FLAG_NAME]: undefined,
    })
    expect(table['crud-form:example.todo']).toBe('example.injection.crud-validation')
    expect(table['example:phase-c-handlers']).toBe('example.injection.crud-validation')
    expect(table['crud-form:catalog.product']).toBe('example.injection.crud-validation')
  })

  /**
   * The whole point of this slice: `readRootObject` -> `staticValue` in
   * packages/cli/src/lib/generators/module-extension-facts.ts can only fold a
   * statically known value. While the export was built by a ternary over an env
   * flag, the framework's OWN reader published ZERO contributions for this file
   * and every scaffolded app saw the canonical module contribute nothing.
   *
   * This asserts through the real extractor, not through source-text matching:
   * a regex for `export const injectionTable: ModuleInjectionTable = {` would
   * pass just as happily if `staticValue` still refused to fold the value.
   */
  it('is read by the real fact extractor, including every cross-module entry', () => {
    const contributionIds = readInjectionTableContributionIds()

    expect(contributionIds.length).toBeGreaterThan(0)
    expect(contributionIds).toContain('example.injection.crud-validation@crud-form:example.todo')
    expect(contributionIds).toContain('example.injection.customer-priority-field@crud-form:customers.person:fields')
    expect(contributionIds).toContain('example.injection.customer-priority-column@data-table:customers.people.list:columns')
    expect(contributionIds).toContain('example.injection.sales-todos@sales.document.detail.order:tabs')
    expect(contributionIds).toContain('example.injection.catalog-seo-report@data-table:catalog.products:header')
    expect(contributionIds).toContain('example.injection.portal-stats@portal:dashboard:sections')
    expect(contributionIds).toContain('example.injection.example-menus@menu:sidebar:main')
  })

  it('publishes one extractor contribution per runtime slot', async () => {
    const table = await loadInjectionTableWithEnv({
      [RETIRED_FLAG_NAME]: undefined,
      [CRUDFORM_FLAG_NAME]: undefined,
    })
    const runtimeSlotCount = Object.values(table)
      .reduce((total, slot) => total + (Array.isArray(slot) ? slot.length : 1), 0)

    expect(readInjectionTableContributionIds()).toHaveLength(runtimeSlotCount)
  })
})
