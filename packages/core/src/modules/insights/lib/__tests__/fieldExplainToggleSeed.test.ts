import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { seedInsightsFieldExplainToggle } from '../fieldExplainToggleSeed'
import { INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION, INSIGHTS_FIELD_EXPLAIN_TOGGLE_ID } from '../fieldExplainToggle'
import setup from '../../setup'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

type EmDouble = {
  em: EntityManager
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
}

function buildEm(): EmDouble {
  const create = jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data }))
  const persist = jest.fn()
  const flush = jest.fn(async () => undefined)
  return { em: { create, persist, flush } as unknown as EntityManager, create, persist, flush }
}

function containerWith(registrations: string[]) {
  return { hasRegistration: (name: string | symbol) => registrations.includes(String(name)) }
}

describe('insights_field_explain toggle seed', () => {
  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
  })

  it('declares a boolean toggle that defaults to on', () => {
    expect(INSIGHTS_FIELD_EXPLAIN_TOGGLE_ID).toBe('insights_field_explain')
    expect(INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION).toEqual(expect.objectContaining({
      identifier: 'insights_field_explain',
      type: 'boolean',
      defaultValue: true,
      category: 'insights',
    }))
  })

  it('creates the toggle when the feature_toggles module is enabled', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const double = buildEm()

    await expect(seedInsightsFieldExplainToggle(double.em, containerWith(['featureTogglesService']))).resolves.toBe(true)

    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(double.em, FeatureToggle, { identifier: 'insights_field_explain' })
    expect(double.create).toHaveBeenCalledWith(FeatureToggle, {
      identifier: 'insights_field_explain',
      name: INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION.name,
      description: INSIGHTS_FIELD_EXPLAIN_TOGGLE_DEFINITION.description,
      category: 'insights',
      type: 'boolean',
      defaultValue: true,
    })
    expect(double.persist).toHaveBeenCalledTimes(1)
    expect(double.flush).toHaveBeenCalledTimes(1)
  })

  it('leaves an existing (or soft-deleted) toggle untouched', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ identifier: 'insights_field_explain', deletedAt: new Date() })
    const double = buildEm()

    await expect(seedInsightsFieldExplainToggle(double.em, containerWith(['featureTogglesService']))).resolves.toBe(false)
    expect(double.persist).not.toHaveBeenCalled()
    expect(double.flush).not.toHaveBeenCalled()
  })

  it('skips seeding when the feature_toggles module is disabled', async () => {
    const double = buildEm()

    await expect(seedInsightsFieldExplainToggle(double.em, containerWith([]))).resolves.toBe(false)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(double.persist).not.toHaveBeenCalled()
  })

  it('runs from the module seedDefaults hook', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const double = buildEm()

    await setup.seedDefaults?.({
      em: double.em,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      container: containerWith(['featureTogglesService']) as unknown as AwilixContainer,
    })
    expect(double.persist).toHaveBeenCalledTimes(1)
  })
})
