import type { EntityManager } from '@mikro-orm/postgresql'
import { MessageAccessToken } from '../../data/entities'
import { MAX_TOKEN_USE_COUNT, consumeMessageAccessToken } from '../tokenConsumption'

function createKnexChain(updateResult: number) {
  const chain = {
    where: jest.fn().mockReturnThis(),
    update: jest.fn().mockResolvedValue(updateResult),
  }
  const knexFn = jest.fn().mockReturnValue(chain) as jest.Mock & { raw: jest.Mock }
  knexFn.raw = jest.fn().mockReturnValue('use_count + 1')
  return { chain, knexFn }
}

function buildEm(options: {
  updateResult: number
  fresh?: { id: string; expiresAt: Date } | null
}): { em: EntityManager; chain: ReturnType<typeof createKnexChain>['chain']; knexFn: jest.Mock } {
  const { chain, knexFn } = createKnexChain(options.updateResult)
  const em = {
    getKnex: jest.fn().mockReturnValue(knexFn),
    clear: jest.fn(),
    findOne: jest.fn(async (cls: unknown) => {
      if (cls === MessageAccessToken) return options.fresh ?? null
      return null
    }),
  } as unknown as EntityManager
  return { em, chain, knexFn }
}

describe('consumeMessageAccessToken', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns ok when the atomic UPDATE affects one row', async () => {
    const { em, chain, knexFn } = buildEm({ updateResult: 1 })

    const result = await consumeMessageAccessToken(em, 'tok-1')

    expect(result).toEqual({ ok: true })
    expect(knexFn).toHaveBeenCalledWith('message_access_tokens')
    expect(chain.where).toHaveBeenCalledWith('id', 'tok-1')
    expect(chain.where).toHaveBeenCalledWith('use_count', '<', MAX_TOKEN_USE_COUNT)
    expect(chain.where).toHaveBeenCalledWith('expires_at', '>', expect.any(Date))
    expect(chain.update).toHaveBeenCalledWith({
      use_count: 'use_count + 1',
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
