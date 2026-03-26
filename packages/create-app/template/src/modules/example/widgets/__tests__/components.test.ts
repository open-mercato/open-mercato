/**
 * @jest-environment node
 */
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'

const FLAG_NAME = 'NEXT_PUBLIC_OM_EXAMPLE_CHECKOUT_TEST_INJECTIONS_ENABLED'
const originalFlagValue = process.env[FLAG_NAME]

async function loadComponentOverridesWithFlag(flagValue?: string) {
  if (typeof flagValue === 'string') {
    process.env[FLAG_NAME] = flagValue
  } else {
    delete process.env[FLAG_NAME]
  }

  jest.resetModules()
  const mod = await import('../components')
  return mod.componentOverrides
}

describe('example component override flag behavior', () => {
  afterEach(() => {
    if (typeof originalFlagValue === 'string') {
      process.env[FLAG_NAME] = originalFlagValue
    } else {
      delete process.env[FLAG_NAME]
    }
    jest.resetModules()
  })

  it('keeps checkout pay-page wrappers disabled by default', async () => {
    const overrides = await loadComponentOverridesWithFlag(undefined)
    const componentIds = overrides.map((override) => override.target.componentId)

    expect(componentIds).toEqual([
      ComponentReplacementHandles.section('ui.detail', 'NotesSection'),
    ])
  })

  it('enables checkout pay-page wrappers when the test flag is true', async () => {
    const overrides = await loadComponentOverridesWithFlag('true')
    const componentIds = overrides.map((override) => override.target.componentId)

    expect(componentIds).toEqual([
      ComponentReplacementHandles.section('ui.detail', 'NotesSection'),
      ComponentReplacementHandles.section('checkout.pay-page', 'summary'),
      ComponentReplacementHandles.section('checkout.pay-page', 'help'),
    ])
  })
})
