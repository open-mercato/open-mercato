/**
 * @jest-environment node
 */
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

const FLAG_NAME = 'NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED'
const ED_FLAG_NAME = 'NEXT_PUBLIC_OM_CRUDFORM_EXTENDED_EVENTS_ENABLED'
const originalFlagValue = process.env[FLAG_NAME]
const originalEdFlagValue = process.env[ED_FLAG_NAME]

async function loadInjectionTableWithFlags(flagValue?: string, edFlagValue?: string): Promise<ModuleInjectionTable> {
  if (typeof flagValue === 'string') {
    process.env[FLAG_NAME] = flagValue
  } else {
    delete process.env[FLAG_NAME]
  }
  if (typeof edFlagValue === 'string') {
    process.env[ED_FLAG_NAME] = edFlagValue
  } else {
    delete process.env[ED_FLAG_NAME]
  }

  jest.resetModules()
  const mod = await import('../injection-table')
  return mod.injectionTable
}

describe('example injection-table flag behavior', () => {
  afterEach(() => {
    if (typeof originalFlagValue === 'string') {
      process.env[FLAG_NAME] = originalFlagValue
    } else {
      delete process.env[FLAG_NAME]
    }
    if (typeof originalEdFlagValue === 'string') {
      process.env[ED_FLAG_NAME] = originalEdFlagValue
    } else {
      delete process.env[ED_FLAG_NAME]
    }
    jest.resetModules()
  })

  it('keeps todo harness and menu injections enabled when the flag is unset (default false)', async () => {
    const table = await loadInjectionTableWithFlags(undefined, undefined)

    expect(table['crud-form:example.todo']).toBe('example.injection.crud-validation')
    expect(table['example:phase-c-handlers']).toBe('example.injection.crud-validation')
    expect(table['menu:sidebar:main']).toBeDefined()
    expect(table['menu:topbar:profile-dropdown']).toBeDefined()

    expect(table['crud-form:catalog.product']).toBeUndefined()
    expect(table['sales.document.detail.quote:tabs']).toBeUndefined()
    expect(table['data-table:catalog.products:header']).toBeUndefined()
    expect(table['crud-form:customers.person:fields']).toBeUndefined()
    expect(table['data-table:customers.people.list:columns']).toBeUndefined()
    expect(table['data-table:customers.people.list:filters']).toBeUndefined()
    expect(table['data-table:customers.people.list:row-actions']).toBeUndefined()
    expect(table['data-table:customers.people.list:bulk-actions']).toBeUndefined()
    expect(table['customers.person.detail:details']).toBeUndefined()
  })

  it('enables cross-module catalog, sales, and customer injections when the flag is true', async () => {
    const table = await loadInjectionTableWithFlags('true', undefined)

    expect(table['crud-form:example.todo']).toBe('example.injection.crud-validation')
    expect(table['menu:sidebar:main']).toBeDefined()
    expect(table['menu:topbar:profile-dropdown']).toBeDefined()

    expect(table['crud-form:catalog.product']).toBe('example.injection.crud-validation')
    expect(table['sales.document.detail.quote:tabs']).toBeDefined()
    expect(table['sales.document.detail.order:tabs']).toBeDefined()
    expect(table['data-table:catalog.products:header']).toBeDefined()
    expect(table['crud-form:customers.person:fields']).toBeDefined()
    expect(table['crud-form:customers.customer_entity:fields']).toBeDefined()
    expect(table['data-table:customers.people:columns']).toBeDefined()
    expect(table['data-table:customers.people.list:columns']).toBeDefined()
    expect(table['data-table:customers.people:filters']).toBeDefined()
    expect(table['data-table:customers.people.list:filters']).toBeDefined()
    expect(table['data-table:customers.people:row-actions']).toBeDefined()
    expect(table['data-table:customers.people.list:row-actions']).toBeDefined()
    expect(table['data-table:customers.people:bulk-actions']).toBeDefined()
    expect(table['data-table:customers.people.list:bulk-actions']).toBeDefined()
    expect(table['customers.person.detail:details']).toBeDefined()
  })

  it('enables cross-module injections when E-D env flag is true', async () => {
    const table = await loadInjectionTableWithFlags(undefined, 'true')
    expect(table['customers.person.detail:details']).toBeDefined()
    expect(table['data-table:customers.people.list:columns']).toBeDefined()
  })
})
