/** @jest-environment node */

import { describe, test, expect, jest } from '@jest/globals'
import { z } from 'zod'
import type { ActivityTypeEntry } from '../activity-registry'

type ActivityRegistryModule = typeof import('../activity-registry')

const loadIsolatedRegistry = (): ActivityRegistryModule => {
  let loaded: ActivityRegistryModule | undefined
  jest.isolateModules(() => {
    loaded = require('../activity-registry') as ActivityRegistryModule
  })
  if (!loaded) throw new Error('[internal] failed to load activity-registry in isolation')
  return loaded
}

const makeEntry = (id: string): ActivityTypeEntry => ({
  id,
  icon: 'Zap',
  i18nKey: `workflows.activities.types.${id}`,
  configSchema: z.object({}),
  form: [{ id: 'value', component: 'TextInput' }],
  execute: async () => ({ ok: true }),
  async: { capable: true },
})

describe('activity registry', () => {
  test('register/get/list/ids round-trip preserves registration order', () => {
    const registryModule = loadIsolatedRegistry()
    const first = makeEntry('FIRST_TYPE')
    const second = makeEntry('SECOND_TYPE')

    registryModule.registerActivityType(first)
    registryModule.registerActivityType(second)

    expect(registryModule.getActivityType('FIRST_TYPE')).toBe(first)
    expect(registryModule.getActivityType('SECOND_TYPE')).toBe(second)
    expect(registryModule.listActivityTypes()).toEqual([first, second])
    expect(registryModule.activityTypeIds()).toEqual(['FIRST_TYPE', 'SECOND_TYPE'])
  })

  test('getActivityType returns null for an unknown id', () => {
    const registryModule = loadIsolatedRegistry()
    expect(registryModule.getActivityType('MISSING_TYPE')).toBeNull()
  })

  test('registering a duplicate id throws', () => {
    const registryModule = loadIsolatedRegistry()
    registryModule.registerActivityType(makeEntry('DUPLICATE_TYPE'))
    expect(() => registryModule.registerActivityType(makeEntry('DUPLICATE_TYPE'))).toThrow(
      'Activity type already registered: DUPLICATE_TYPE'
    )
  })

  test('activityTypeIds throws when the registry is empty', () => {
    const registryModule = loadIsolatedRegistry()
    expect(() => registryModule.activityTypeIds()).toThrow('Activity registry is empty')
  })
})
