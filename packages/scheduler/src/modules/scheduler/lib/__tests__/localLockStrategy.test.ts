import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { LocalLockStrategy } from '../localLockStrategy'

describe('LocalLockStrategy', () => {
  let strategy: LocalLockStrategy
  let mockEm: any
  let mockConnection: any
  let emFactory: () => any

  beforeEach(() => {
    mockConnection = {
      execute: jest.fn() as any,
    }

    mockEm = {
      getConnection: jest.fn(() => mockConnection) as any,
    }

    emFactory = jest.fn(() => mockEm) as any

    strategy = new LocalLockStrategy(emFactory)
  })

  describe('tryLock', () => {
    it('should acquire lock successfully', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      const result = await strategy.tryLock('test-key')

      expect(result).toBe(true)
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock(?) as acquired',
        expect.any(Array)
      )
    })

    it('should fail to acquire lock if already locked', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: false }])

      const result = await strategy.tryLock('test-key')

      expect(result).toBe(false)
    })

    it('should use different hashes for different keys', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      await strategy.tryLock('key1')
      const call1 = (mockConnection.execute as any).mock.calls[0]

      await strategy.tryLock('key2')
      const call2 = (mockConnection.execute as any).mock.calls[1]

      // The hash values (second parameter) should be different
      expect(call1[1][0]).not.toBe(call2[1][0])
    })

    it('should use same hash for same key', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      await strategy.tryLock('same-key')
      const call1 = (mockConnection.execute as any).mock.calls[0]

      await strategy.tryLock('same-key')
      const call2 = (mockConnection.execute as any).mock.calls[1]

      // The hash values should be identical
      expect(call1[1][0]).toBe(call2[1][0])
    })

    it('should handle database errors gracefully', async () => {
      ;(mockConnection.execute as any).mockRejectedValue(new Error('Database connection failed'))

      const result = await strategy.tryLock('test-key')

      expect(result).toBe(false)
    })

    it('should handle empty result array', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([])

      const result = await strategy.tryLock('test-key')

      expect(result).toBe(false)
    })

    it('should handle null acquired value', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: null }])

      const result = await strategy.tryLock('test-key')

      expect(result).toBe(false)
    })

    it('should handle undefined acquired value', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: undefined }])

      const result = await strategy.tryLock('test-key')

      expect(result).toBe(false)
    })

    it('should convert hash to positive integer', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      await strategy.tryLock('test-key')

      const call = (mockConnection.execute as any).mock.calls[0]
      const hash = call[1][0]

      // Hash should be a positive number
      expect(typeof hash).toBe('number')
      expect(hash).toBeGreaterThanOrEqual(0)
    })
  })

  describe('unlock', () => {
    it('should release lock successfully', async () => {
      ;(mockConnection.execute as any).mockResolvedValue(undefined)

      await strategy.unlock('test-key')

      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock(?)',
        expect.any(Array)
      )
    })

    it('should use same hash as tryLock for same key', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      await strategy.tryLock('test-key')
      const lockCall = (mockConnection.execute as any).mock.calls[0]
      const lockHash = lockCall[1][0]

      await strategy.unlock('test-key')
      const unlockCall = (mockConnection.execute as any).mock.calls[1]
      const unlockHash = unlockCall[1][0]

      expect(lockHash).toBe(unlockHash)
    })

    it('should handle database errors gracefully', async () => {
      ;(mockConnection.execute as any).mockRejectedValue(new Error('Database error'))

      // Should not throw
      await expect(strategy.unlock('test-key')).resolves.not.toThrow()
    })

    it('should handle network timeout', async () => {
      ;(mockConnection.execute as any).mockRejectedValue(new Error('Connection timeout'))

      await expect(strategy.unlock('test-key')).resolves.not.toThrow()
    })

    it('should work even if lock was never acquired', async () => {
      ;(mockConnection.execute as any).mockResolvedValue(undefined)

      // Unlocking a never-acquired lock should not error
      await expect(strategy.unlock('never-locked-key')).resolves.not.toThrow()
    })
  })

  describe('hash function', () => {
    it('should produce consistent hashes for same input', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      await strategy.tryLock('consistent-key')
      const call1 = (mockConnection.execute as any).mock.calls[0]

      await strategy.tryLock('consistent-key')
      const call2 = (mockConnection.execute as any).mock.calls[1]

      expect(call1[1][0]).toBe(call2[1][0])
    })

    it('should produce different hashes for different inputs', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      const keys = ['key1', 'key2', 'key3', 'a', 'aa', 'aaa']
      const hashes = new Set<number>()

      for (const key of keys) {
        await strategy.tryLock(key)
        const call = (mockConnection.execute as any).mock.calls[(mockConnection.execute as any).mock.calls.length - 1]
        hashes.add(call[1][0])
      }

      // All hashes should be unique
      expect(hashes.size).toBe(keys.length)
    })

    it('should handle empty string', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      await strategy.tryLock('')
      const call = (mockConnection.execute as any).mock.calls[0]

      expect(call[1][0]).toBe(0) // Empty string should hash to 0
    })

    it('should handle long strings', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      const longKey = 'a'.repeat(1000)
      await strategy.tryLock(longKey)

      const call = (mockConnection.execute as any).mock.calls[0]
      const hash = call[1][0]

      expect(typeof hash).toBe('number')
      expect(hash).toBeGreaterThanOrEqual(0)
    })

    it('should handle special characters', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      const specialKeys = [
        'key-with-dashes',
        'key_with_underscores',
        'key.with.dots',
        'key:with:colons',
        'key/with/slashes',
        'key@with@ats',
        'key#with#hashes',
        'key$with$dollars',
      ]

      const hashes = new Set<number>()

      for (const key of specialKeys) {
        await strategy.tryLock(key)
        const call = (mockConnection.execute as any).mock.calls[(mockConnection.execute as any).mock.calls.length - 1]
        hashes.add(call[1][0])
      }

      // All should produce valid hashes
      expect(hashes.size).toBe(specialKeys.length)
    })

    it('should handle unicode characters', async () => {
      ;(mockConnection.execute as any).mockResolvedValue([{ acquired: true }])

      const unicodeKeys = ['café', '日本語', '🎉', 'Ñoño']

      for (const key of unicodeKeys) {
        await strategy.tryLock(key)
        const call = (mockConnection.execute as any).mock.calls[(mockConnection.execute as any).mock.calls.length - 1]
        const hash = call[1][0]

        expect(typeof hash).toBe('number')
        expect(hash).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('integration scenarios', () => {
    it('should support lock-execute-unlock pattern', async () => {
      ;(mockConnection.execute as any)
        .mockResolvedValueOnce([{ acquired: true }])  // tryLock succeeds
        .mockResolvedValueOnce(undefined)              // unlock succeeds

      const locked = await strategy.tryLock('resource-id')
      expect(locked).toBe(true)

      // ... do work ...

      await strategy.unlock('resource-id')
      
      expect(mockConnection.execute).toHaveBeenCalledTimes(2)
    })

    it('should handle concurrent lock attempts', async () => {
      ;(mockConnection.execute as any)
        .mockResolvedValueOnce([{ acquired: true }])  // First attempt succeeds
        .mockResolvedValueOnce([{ acquired: false }]) // Second attempt fails

      const lock1 = await strategy.tryLock('shared-resource')
      const lock2 = await strategy.tryLock('shared-resource')

      expect(lock1).toBe(true)
      expect(lock2).toBe(false)
    })

    it('should allow locking after unlock', async () => {
      ;(mockConnection.execute as any)
        .mockResolvedValueOnce([{ acquired: true }])  // First lock
        .mockResolvedValueOnce(undefined)              // Unlock
        .mockResolvedValueOnce([{ acquired: true }])  // Second lock

      const lock1 = await strategy.tryLock('resource')
      expect(lock1).toBe(true)

      await strategy.unlock('resource')

      const lock2 = await strategy.tryLock('resource')
      expect(lock2).toBe(true)
    })

    it('should handle multiple resources independently', async () => {
      ;(mockConnection.execute as any)
        .mockResolvedValueOnce([{ acquired: true }])  // Lock resource1
        .mockResolvedValueOnce([{ acquired: true }])  // Lock resource2
        .mockResolvedValueOnce(undefined)              // Unlock resource1
        .mockResolvedValueOnce(undefined)              // Unlock resource2

      const lock1 = await strategy.tryLock('resource1')
      const lock2 = await strategy.tryLock('resource2')

      expect(lock1).toBe(true)
      expect(lock2).toBe(true)

      await strategy.unlock('resource1')
      await strategy.unlock('resource2')

      expect(mockConnection.execute).toHaveBeenCalledTimes(4)
    })
  })

  describe('error handling', () => {
    it('should not throw on tryLock error', async () => {
      ;(mockConnection.execute as any).mockRejectedValue(new Error('SQL error'))

      await expect(strategy.tryLock('test')).resolves.not.toThrow()
    })

    it('should not throw on unlock error', async () => {
      ;(mockConnection.execute as any).mockRejectedValue(new Error('SQL error'))

      await expect(strategy.unlock('test')).resolves.not.toThrow()
    })

    it('should handle connection pool exhaustion', async () => {
      ;(mockConnection.execute as any).mockRejectedValue(new Error('Connection pool exhausted'))

      const result = await strategy.tryLock('test')

      expect(result).toBe(false)
    })

    it('should handle transaction errors', async () => {
      ;(mockConnection.execute as any).mockRejectedValue(new Error('Transaction aborted'))

      await expect(strategy.unlock('test')).resolves.not.toThrow()
    })
  })
})
