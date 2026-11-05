import type { EntityManager } from '@mikro-orm/postgresql'
import { MessageAccessToken } from '../../data/entities'
import { MAX_TOKEN_USE_COUNT, consumeMessageAccessToken } from '../tokenConsumption'

function createKyselyChain(updateResult: number) {
  const builder = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    executeTakeFirst: jest
      .fn()
      .mockResolvedValue({ numUpdatedRows: BigInt(updateResult) }),
  }
  const db = { updateTable: jest.fn().mockReturnValue(builder) }
  return { builder, db }
}

function buildEm(options: {
  updateResult: number
  fresh?: { id: string; expiresAt: Date } | null
}): { em: EntityManager; builder: ReturnType<typeof createKyselyChain>['builder']; db: ReturnType<typeof createKyselyChain>['db'] } {
  const { builder, db } = createKyselyChain(options.updateResult)
  const em = {
    getKysely: jest.fn().mockReturnValue(db),
    clear: jest.fn(),
    findOne: jest.fn(async (cls: unknown) => {
      if (cls === MessageAccessToken) return options.fresh ?? null
      return null
    }),
  } as unknown as EntityManager
  return { em, builder, db }
}

describe('consumeMessageAccessToken', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns ok when the atomic UPDATE affects one row', async () => {
    const { em, builder, db } = buildEm({ updateResult: 1 })

    const result = await consumeMessageAccessToken(em, 'tok-1')

    expect(result).toEqual({ ok: true })
    expect(db.updateTable).toHaveBeenCalledWith('message_access_tokens')
    expect(builder.where).toHaveBeenCalledWith('id', '=', 'tok-1')
    expect(builder.where).toHaveBeenCalledWith('use_count', '<', MAX_TOKEN_USE_COUNT)
    expect(builder.where).toHaveBeenCalledWith('expires_at', '>', expect.any(Date))
    expect(builder.set).toHaveBeenCalledWith({
      use_count: expect.anything(),
      used_at: expect.any(Date),
    })
  })

  it('returns expired when the UPDATE affects zero rows and the token is past expiry', async () => {
    const { em } = buildEm({
      updateResult: 0,
      fresh: { id: 'tok-1', expiresAt: new Date(Date.now() - 60_000) },
    })

    const result = await consumeMessageAccessToken(em, 'tok-1')

    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('returns exhausted when the UPDATE affects zero rows but the token has not expired', async () => {
    const { em } = buildEm({
      updateResult: 0,
      fresh: { id: 'tok-1', expiresAt: new Date(Date.now() + 60_000) },
    })

    const result = await consumeMessageAccessToken(em, 'tok-1')

    expect(result).toEqual({ ok: false, reason: 'exhausted' })
  })

  it('returns not_found when the UPDATE affects zero rows and the token is gone', async () => {
    const { em } = buildEm({ updateResult: 0, fresh: null })

    const result = await consumeMessageAccessToken(em, 'tok-1')

    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })
})
