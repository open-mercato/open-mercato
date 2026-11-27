import { registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'
import { isPlannerModuleEnabled } from '../lib/plannerModule'

describe('isPlannerModuleEnabled', () => {
  it('treats planner as enabled until the enabled-module registry is known', () => {
    expect(isPlannerModuleEnabled()).toBe(true)
  })

  it('reports planner as disabled when the app does not enable it', () => {
    registerEnabledModuleIds(['resources', 'dictionaries'])
    expect(isPlannerModuleEnabled()).toBe(false)
  })

  it('reports planner as enabled when the app enables it', () => {
    registerEnabledModuleIds(['resources', 'planner'])
    expect(isPlannerModuleEnabled()).toBe(true)
  })
})
