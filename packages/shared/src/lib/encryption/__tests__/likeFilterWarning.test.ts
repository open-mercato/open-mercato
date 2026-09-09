import { collectLikeFilterFields, warnOnEncryptedLikeFilter } from '../likeFilterWarning'
import { registerEntityIds } from '../entityIds'
import { resetCiphertextLikeWarnCache } from '../../query/ciphertext-search-warning'

jest.mock('../../logger', () => {
  const warn = jest.fn()
  const debug = jest.fn()
  const child = jest.fn(() => ({ warn, debug }))
  return { createLogger: jest.fn(() => ({ child })), __warn: warn, __debug: debug }
})

jest.mock('../customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

const loggerModule = jest.requireMock('../../logger') as { __warn: jest.Mock }

describe('collectLikeFilterFields', () => {
  it('finds string operators on a top-level property', () => {
    expect(collectLikeFilterFields({ title: { $ilike: '%q%' } })).toEqual(['title'])
    expect(collectLikeFilterFields({ title: { $like: 'q%' } })).toEqual(['title'])
    expect(collectLikeFilterFields({ title: { $re: '^q' } })).toEqual(['title'])
  })

  it('ignores filters that do not use a string operator', () => {
    expect(collectLikeFilterFields({ title: 'Renewal', status: { $in: ['open'] } })).toEqual([])
    expect(collectLikeFilterFields({ createdAt: { $gte: new Date(0) } })).toEqual([])
  })

  it('descends into $and, $or and $not branches', () => {
    const where = {
      $and: [
        { tenantId: 't1' },
        { $or: [{ title: { $ilike: '%q%' } }, { subject: { $ilike: '%q%' } }] },
      ],
    }
    expect(collectLikeFilterFields(where).sort()).toEqual(['subject', 'title'])
    expect(collectLikeFilterFields({ title: { $not: { $ilike: '%q%' } } })).toEqual(['title'])
  })

  it('does not attribute a nested relation filter to the root entity', () => {
    expect(collectLikeFilterFields({ customer: { displayName: { $ilike: '%q%' } } })).toEqual([])
  })

  it('tolerates empty, null and non-object filters', () => {
    expect(collectLikeFilterFields(undefined)).toEqual([])
    expect(collectLikeFilterFields(null)).toEqual([])
    expect(collectLikeFilterFields('id-1')).toEqual([])
    expect(collectLikeFilterFields({})).toEqual([])
  })

  it('reports each property once regardless of how many branches match', () => {
    const where = { $or: [{ title: { $ilike: '%a%' } }, { title: { $ilike: '%b%' } }] }
    expect(collectLikeFilterFields(where)).toEqual(['title'])
  })
})

describe('warnOnEncryptedLikeFilter', () => {
  const originalNodeEnv = process.env.NODE_ENV

  const makeEm = () => ({
    getMetadata: () => ({ find: (name: string) => (name === 'MailMessage' ? { className: 'MailMessage' } : undefined) }),
  })

  const makeService = (encryptedFields: string[]) => ({
    isEnabled: () => true,
    getEncryptedFieldNames: jest.fn(async () => encryptedFields),
  })

  beforeAll(() => {
    registerEntityIds({ mail: { mail_message: 'mail:mail_message' } })
  })

  beforeEach(() => {
    resetCiphertextLikeWarnCache()
    loggerModule.__warn.mockClear()
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', configurable: true })
  })

  afterAll(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: originalNodeEnv, configurable: true })
  })

  it('warns when the filtered property is covered by an encryption map', async () => {
    await warnOnEncryptedLikeFilter({
      em: makeEm() as any,
      entityName: 'MailMessage',
      where: { subject: { $ilike: '%invoice%' } },
      tenantId: 'tenant-1',
      encryptionService: makeService(['subject']) as any,
    })

    expect(loggerModule.__warn).toHaveBeenCalledTimes(1)
    expect(loggerModule.__warn.mock.calls[0][1]).toMatchObject({
      entity: 'mail:mail_message',
      field: 'subject',
      reason: 'raw-orm-filter',
    })
    expect(loggerModule.__warn.mock.calls[0][1].hint).toContain('findEntityIdsBySearchTokens')
  })

  it('stays quiet for properties outside the encryption map', async () => {
    await warnOnEncryptedLikeFilter({
      em: makeEm() as any,
      entityName: 'MailMessage',
      where: { subject: { $ilike: '%invoice%' } },
      tenantId: 'tenant-1',
      encryptionService: makeService(['body']) as any,
    })
    expect(loggerModule.__warn).not.toHaveBeenCalled()
  })

  it('skips the encryption lookup entirely in production', async () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true })
    const service = makeService(['subject'])
    await warnOnEncryptedLikeFilter({
      em: makeEm() as any,
      entityName: 'MailMessage',
      where: { subject: { $ilike: '%invoice%' } },
      tenantId: 'tenant-1',
      encryptionService: service as any,
    })
    expect(service.getEncryptedFieldNames).not.toHaveBeenCalled()
    expect(loggerModule.__warn).not.toHaveBeenCalled()
  })

  it('skips the encryption lookup when no string operator is present', async () => {
    const service = makeService(['subject'])
    await warnOnEncryptedLikeFilter({
      em: makeEm() as any,
      entityName: 'MailMessage',
      where: { subject: 'Invoice' },
      tenantId: 'tenant-1',
      encryptionService: service as any,
    })
    expect(service.getEncryptedFieldNames).not.toHaveBeenCalled()
  })

  it('stays quiet when the entity id cannot be resolved', async () => {
    await warnOnEncryptedLikeFilter({
      em: makeEm() as any,
      entityName: 'UnknownEntity',
      where: { subject: { $ilike: '%invoice%' } },
      tenantId: 'tenant-1',
      encryptionService: makeService(['subject']) as any,
    })
    expect(loggerModule.__warn).not.toHaveBeenCalled()
  })

  it('never rethrows when metadata access fails', async () => {
    const em = {
      getMetadata: () => {
        throw new Error('orm not initialized')
      },
    }
    await expect(
      warnOnEncryptedLikeFilter({
        em: em as any,
        entityName: 'MailMessage',
        where: { subject: { $ilike: '%invoice%' } },
        tenantId: 'tenant-1',
        encryptionService: makeService(['subject']) as any,
      }),
    ).resolves.toBeUndefined()
    expect(loggerModule.__warn).not.toHaveBeenCalled()
  })
})
