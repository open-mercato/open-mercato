import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { LocalLockStrategy } from '../localLockStrategy'

describe('LocalLockStrategy', () => {
  let strategy: LocalLockStrategy
  let mockEm: any
  let mockConnection: any
  let mockForkedEm: any
  let transactionalImpl: any
  let emFactory: () => any

  beforeEach(() => {
    mockConnection = {
      execute: jest.fn() as any,
    }

    transactionalImpl = jest.fn(async (fn: any) => fn(mockForkedEm))

    mockForkedEm = {
      getConnection: jest.fn(() => mockConnection) as any,
    }

    mockEm = {
      fork: jest.fn(() => ({
        transactional: transactionalImpl,
      })) as any,
    }

    emFactory = jest.fn(() => mockEm) as any

    strategy = new LocalLockStrategy(emFactory)
  })

  describe('runWithLock', () => {
    it('should acquire lock and execute fn', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      const fn = jest.fn(async () => 'ok')
      const result = await strategy.runWithLock('test-key', fn)

      expect(result).toEqual({ acquired: true, result: 'ok' })
      expect(fn).toHaveBeenCalledTimes(1)
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_xact_lock(?) as acquired',
        expect.any(Array),
      )
    })

    it('should skip fn if lock not acquired', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: false }])

      const fn = jest.fn(async () => 'ok')
      const result = await strategy.runWithLock('test-key', fn)

      expect(result).toEqual({ acquired: false })
      expect(fn).not.toHaveBeenCalled()
    })

    it('should handle empty result array', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([])

      const fn = jest.fn(async () => 'ok')
      const result = await strategy.runWithLock('test-key', fn)

      expect(result).toEqual({ acquired: false })
      expect(fn).not.toHaveBeenCalled()
    })

    it('should handle database errors gracefully', async () => {
      ;(mockConnection.execute as any).mockRejectedValue(new Error('Database connection failed'))

      const fn = jest.fn(async () => 'ok')
      const result = await strategy.runWithLock('test-key', fn)

      expect(result).toEqual({ acquired: false })
      expect(fn).not.toHaveBeenCalled()
    })
  })
})
