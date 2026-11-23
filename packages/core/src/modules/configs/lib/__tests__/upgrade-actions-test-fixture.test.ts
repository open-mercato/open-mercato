import type { UpgradeActionDefinition } from '@open-mercato/shared/modules/upgrade-actions'
import fixture, { TEST_FIXTURE_MARKER } from '../../upgrades/0.0.1-test-reversible-fixture'

function loadManifest(flag: string | undefined): UpgradeActionDefinition[] {
  const previous = process.env.OM_UPGRADE_ACTION_TEST_FIXTURES
  if (flag === undefined) delete process.env.OM_UPGRADE_ACTION_TEST_FIXTURES
  else process.env.OM_UPGRADE_ACTION_TEST_FIXTURES = flag
  let manifest: UpgradeActionDefinition[] = []
  jest.isolateModules(() => {
    manifest = require('../../upgrades').upgradeActions
  })
  if (previous === undefined) delete process.env.OM_UPGRADE_ACTION_TEST_FIXTURES
  else process.env.OM_UPGRADE_ACTION_TEST_FIXTURES = previous
  return manifest
}

function createEm(row: { valueJson: unknown } | null) {
  return {
    findOne: jest.fn(async () => row),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
}

const context = { tenantId: 't', organizationId: 'o', container: {} as never }

describe('configs test-only reversible upgrade action', () => {
  it('is not registered unless OM_UPGRADE_ACTION_TEST_FIXTURES is on', () => {
    expect(loadManifest(undefined)).toEqual([])
    expect(loadManifest('0')).toEqual([])
    expect(loadManifest('1').map((action) => action.id)).toEqual(['configs.test-reversible-fixture'])
  })

  it('refuses to adopt a pre-existing row on apply', async () => {
    const em = createEm({ valueJson: { marker: TEST_FIXTURE_MARKER } })
    await expect(fixture.run({ ...context, em: em as never })).rejects.toThrow('refusing to adopt')
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('reverts only the unchanged row it wrote', async () => {
    const untouched = { valueJson: { marker: TEST_FIXTURE_MARKER } }
    const em = createEm(untouched)
    await fixture.down?.({ ...context, em: em as never })
    expect(em.remove).toHaveBeenCalledWith(untouched)

    const changed = createEm({ valueJson: { marker: 'edited by an operator' } })
    await expect(fixture.down?.({ ...context, em: changed as never })).rejects.toThrow('changed since apply')
    expect(changed.remove).not.toHaveBeenCalled()
  })
})
