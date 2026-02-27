/**
 * @jest-environment node
 */
import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

const FLAG_NAME = 'NEXT_PUBLIC_OM_EXAMPLE_INJECTION_WIDGETS_ENABLED'
const originalFlagValue = process.env[FLAG_NAME]

async function loadInjectionTableWithFlag(flagValue?: string): Promise<ModuleInjectionTable> {
  if (typeof flagValue === 'string') {
    process.env[FLAG_NAME] = flagValue
  } else {
    delete process.env[FLAG_NAME]
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
    jest.resetModules()
  })

  it('keeps todo harness and menu injections enabled when the flag is unset (default false)', async () => {
    const table = await loadInjectionTableWithFlag(undefined)

    expect(table['crud-form:example.todo']).toBe('example.injection.crud-validation')
    expect(table['example:phase-c-handlers']).toBe('example.injection.crud-validation')
    expect(table['menu:sidebar:main']).toBeDefined()
    expect(table['menu:topbar:profile-dropdown']).toBeDefined()

    expect(table['crud-form:catalog.product']).toBeUndefined()
    expect(table['sales.document.detail.quote:tabs']).toBeUndefined()
    expect(table['data-table:catalog.products:header']).toBeUndefined()
    expect(table['crud-form:customers.person']).toBeUndefined()
  })

  it('enables cross-module catalog and sales injections when the flag is true', async () => {
    const table = await loadInjectionTableWithFlag('true')

    expect(table['crud-form:example.todo']).toBe('example.injection.crud-validation')
    expect(table['menu:sidebar:main']).toBeDefined()
    expect(table['menu:topbar:profile-dropdown']).toBeDefined()

    expect(table['crud-form:catalog.product']).toBe('example.injection.crud-validation')
    expect(table['sales.document.detail.quote:tabs']).toBeDefined()
    expect(table['sales.document.detail.order:tabs']).toBeDefined()
    expect(table['data-table:catalog.products:header']).toBeDefined()
    expect(table['crud-form:customers.person']).toBeUndefined()
  })
})
