import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigRecord } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { dealStatusVocabularySchema, DEFAULT_DEAL_STATUS_VOCABULARY } from '../../data/dealStatusVocabulary'
import { canonicalDealStatus, expandDealStatusAliases, isClosedDealStatus, isWonDealStatus, isLostDealStatus } from '../dealStatus'
import { resolveDealStatusVocabulary } from '../dealStatusVocabulary'
import { dealClosureOutcomeFromStatus } from '../closureStage'

const custom = { won: ['accepted'], lost: ['declined'], closed: ['archived'] }
const envDefault = { won: ['signed'], lost: ['rejected'], closed: ['finished'] }
const originalEnv = process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY

function makeContainer(value: unknown, tenantId = 'tenant-a', source: ModuleConfigRecord['source'] = 'tenant') {
  const record: ModuleConfigRecord = {
    moduleId: 'customers', name: 'dealStatusVocabulary', value, tenantId,
    organizationId: null, source, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T01:00:00.000Z',
  }
  const getRecord = jest.fn().mockResolvedValue(record)
  const container = { resolve: jest.fn().mockReturnValue({ getRecord }) } as unknown as Pick<AppContainer, 'resolve'>
  return { container, getRecord }
}

afterEach(() => {
  if (originalEnv === undefined) delete process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY
  else process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY = originalEnv
})

beforeEach(() => { delete process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY })

describe('resolved deal status vocabulary', () => {
  it('retains shipped defaults without configuration', async () => {
    expect(await resolveDealStatusVocabulary(undefined, 'tenant-a')).toEqual({ vocabulary: DEFAULT_DEAL_STATUS_VOCABULARY, source: 'default', updatedAt: null })
    expect(expandDealStatusAliases(['closed']).sort()).toEqual(['closed', 'loose', 'lost', 'win', 'won'])
  })

  it('uses env JSON before built-ins and a tenant row before env', async () => {
    process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY = JSON.stringify(envDefault)
    expect((await resolveDealStatusVocabulary(undefined, 'tenant-a')).vocabulary).toEqual(envDefault)
    const { container, getRecord } = makeContainer(custom)
    expect(await resolveDealStatusVocabulary(container, 'tenant-a')).toMatchObject({ vocabulary: custom, source: 'tenant' })
    expect(getRecord).toHaveBeenCalledWith('customers', 'dealStatusVocabulary', { tenantId: 'tenant-a' })
  })

  it('ignores instance rows and records from another tenant', async () => {
    process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY = JSON.stringify(envDefault)
    for (const setup of [makeContainer(custom, 'tenant-a', 'instance'), makeContainer(custom, 'tenant-b')]) {
      expect((await resolveDealStatusVocabulary(setup.container, 'tenant-a')).source).toBe('env')
    }
  })

  it('falls through invalid or reset tenant settings and malformed env', async () => {
    process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY = JSON.stringify(envDefault)
    expect(await resolveDealStatusVocabulary(makeContainer(null).container, 'tenant-a')).toMatchObject({ vocabulary: envDefault, source: 'env', updatedAt: '2026-10-18T01:00:00.000Z' })
    process.env.OM_CUSTOMERS_DEAL_STATUS_VOCABULARY = '{bad'
    expect((await resolveDealStatusVocabulary(makeContainer({ won: [] }).container, 'tenant-a')).source).toBe('default')
  })

  it('keeps simultaneous tenant configurations isolated', async () => {
    const first = makeContainer(custom)
    const second = makeContainer(envDefault, 'tenant-b')
    const [resolvedFirst, resolvedSecond] = await Promise.all([
      resolveDealStatusVocabulary(first.container, 'tenant-a'),
      resolveDealStatusVocabulary(second.container, 'tenant-b'),
    ])
    expect(resolvedFirst.vocabulary).toEqual(custom)
    expect(resolvedSecond.vocabulary).toEqual(envDefault)
  })

  it('does not hide database failures as default configuration', async () => {
    const { container, getRecord } = makeContainer(custom)
    getRecord.mockRejectedValue(new Error('database unavailable'))
    await expect(resolveDealStatusVocabulary(container, 'tenant-a')).rejects.toThrow('database unavailable')
  })
})

describe('configured status semantics', () => {
  it('uses configured canonical spellings and retains historical read aliases', () => {
    expect(canonicalDealStatus('WON', custom)).toBe('accepted')
    expect(canonicalDealStatus('loose', custom)).toBe('declined')
    expect(isWonDealStatus('accepted', custom)).toBe(true)
    expect(isLostDealStatus('declined', custom)).toBe(true)
    expect(isClosedDealStatus('archived', custom)).toBe(true)
    expect(isWonDealStatus('win', custom)).toBe(true)
    expect(expandDealStatusAliases(['accepted'], custom)).toEqual(['accepted', 'win', 'won'])
    expect(expandDealStatusAliases(['archived'], custom).sort()).toEqual(['accepted', 'archived', 'closed', 'declined', 'loose', 'lost', 'win', 'won'])
    expect(dealClosureOutcomeFromStatus('ACCEPTED', custom)).toBe('won')
    expect(dealClosureOutcomeFromStatus('archived', custom)).toBeNull()
  })

  it.each([
    { ...custom, won: [] },
    { ...custom, won: [''] },
    { ...custom, lost: ['Accepted'] },
    { ...custom, won: ['lost'] },
    { ...custom, closed: ['OPEN'] },
    { ...custom, won: ['accepted', 'ACCEPTED'] },
  ])('rejects ambiguous or invalid vocabulary %p', (vocabulary) => {
    expect(dealStatusVocabularySchema.safeParse(vocabulary).success).toBe(false)
  })
})
