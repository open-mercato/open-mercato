/**
 * The task entity registry must survive duplicated module instances (#7180).
 *
 * `bootstrap/workflows.ts` evaluates a module's `workflows.ts` and registers its
 * entity types, while API routes and the work-inbox provider can load another
 * server-bundle copy of `task-entity-registry.ts`. Each `jest.isolateModules`
 * block below gets a fresh module copy, standing in for those two bundles: a
 * registration written through one copy must be readable through the other.
 */

import { describe, test, expect, jest, afterEach } from '@jest/globals'

type TaskEntityRegistryModule = typeof import('../task-entity-registry')

function loadRegistryCopy(): TaskEntityRegistryModule {
  let registry: TaskEntityRegistryModule | undefined
  jest.isolateModules(() => {
    registry = require('../task-entity-registry') as TaskEntityRegistryModule
  })
  if (!registry) throw new Error('[internal] task entity registry did not load')
  return registry
}

describe('task entity registry across module copies', () => {
  afterEach(() => {
    loadRegistryCopy().clearTaskEntityRegistrationsForTests()
  })

  test('a registration made in one module copy is visible from another', () => {
    const writer = loadRegistryCopy()
    const reader = loadRegistryCopy()
    expect(reader).not.toBe(writer)

    const buildHref = (recordId: string) => `/backend/notary/cases/${recordId}`
    writer.registerTaskEntityAclRequirements([
      { entityId: 'notary:notary_case', view: ['notary.cases.view'] },
    ])
    writer.registerTaskEntityLinkBuilders([{ entityId: 'notary:notary_case', buildHref }])

    expect(reader.resolveRegisteredTaskEntityViewFeatures('notary:notary_case')).toEqual([
      'notary.cases.view',
    ])
    expect(reader.resolveRegisteredTaskEntityLinkBuilder('notary:notary_case')).toBe(buildHref)
  })

  test('clearing through one copy clears what another copy registered', () => {
    const writer = loadRegistryCopy()
    const reader = loadRegistryCopy()

    writer.registerTaskEntityAclRequirements([
      { entityId: 'notary:notary_case', view: ['notary.cases.view'] },
    ])
    writer.registerTaskEntityLinkBuilders([
      { entityId: 'notary:notary_case', buildHref: (recordId) => `/backend/notary/cases/${recordId}` },
    ])
    reader.clearTaskEntityRegistrationsForTests()

    expect(writer.resolveRegisteredTaskEntityViewFeatures('notary:notary_case')).toBeNull()
    expect(writer.resolveRegisteredTaskEntityLinkBuilder('notary:notary_case')).toBeNull()
  })
})
