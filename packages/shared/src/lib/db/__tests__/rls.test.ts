import {
  isRlsEnabled,
  isRlsStrict,
  setRlsContext,
  clearRlsContext,
  getRlsTenantContext,
  getRlsOrgContext,
  withRlsContext,
  RLS_TENANT_VAR,
  RLS_ORG_VAR,
} from '../rls'

describe('RLS Helper Module', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('isRlsEnabled', () => {
    test('returns false by default', () => {
      delete process.env.RLS_ENABLED
      expect(isRlsEnabled()).toBe(false)
    })

    test('returns true when RLS_ENABLED=true', () => {
      process.env.RLS_ENABLED = 'true'
      expect(isRlsEnabled()).toBe(true)
    })

    test('returns true when RLS_ENABLED=yes', () => {
      process.env.RLS_ENABLED = 'yes'
      expect(isRlsEnabled()).toBe(true)
    })

    test('returns true when RLS_ENABLED=1', () => {
      process.env.RLS_ENABLED = '1'
      expect(isRlsEnabled()).toBe(true)
    })

    test('returns false when RLS_ENABLED=false', () => {
      process.env.RLS_ENABLED = 'false'
      expect(isRlsEnabled()).toBe(false)
    })

    test('returns false when RLS_ENABLED=no', () => {
      process.env.RLS_ENABLED = 'no'
      expect(isRlsEnabled()).toBe(false)
    })
  })

  describe('isRlsStrict', () => {
    test('returns false by default', () => {
      delete process.env.RLS_STRICT
      expect(isRlsStrict()).toBe(false)
    })

    test('returns true when RLS_STRICT=true', () => {
      process.env.RLS_STRICT = 'true'
      expect(isRlsStrict()).toBe(true)
    })
  })

  describe('setRlsContext', () => {
    let mockKnex: any

    beforeEach(() => {
      mockKnex = {
        raw: jest.fn().mockResolvedValue({ rows: [] }),
      }
    })

    test('does nothing when RLS is disabled', async () => {
      delete process.env.RLS_ENABLED
      await setRlsContext(mockKnex, 'tenant-123', 'org-456')
      expect(mockKnex.raw).not.toHaveBeenCalled()
    })

    test('sets tenant context when RLS is enabled', async () => {
      process.env.RLS_ENABLED = 'true'
      await setRlsContext(mockKnex, 'tenant-123')
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT set_config(?, ?, true)',
        [RLS_TENANT_VAR, 'tenant-123']
      )
    })

    test('sets both tenant and org context when provided', async () => {
      process.env.RLS_ENABLED = 'true'
      await setRlsContext(mockKnex, 'tenant-123', 'org-456')
      expect(mockKnex.raw).toHaveBeenCalledTimes(2)
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT set_config(?, ?, true)',
        [RLS_TENANT_VAR, 'tenant-123']
      )
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT set_config(?, ?, true)',
        [RLS_ORG_VAR, 'org-456']
      )
    })

    test('sets empty string for null tenant', async () => {
      process.env.RLS_ENABLED = 'true'
      await setRlsContext(mockKnex, null)
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT set_config(?, ?, true)',
        [RLS_TENANT_VAR, '']
      )
    })

    test('sets empty string for null organization', async () => {
      process.env.RLS_ENABLED = 'true'
      await setRlsContext(mockKnex, 'tenant-123', null)
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT set_config(?, ?, true)',
        [RLS_ORG_VAR, '']
      )
    })

    test('does not set org context when undefined', async () => {
      process.env.RLS_ENABLED = 'true'
      await setRlsContext(mockKnex, 'tenant-123', undefined)
      expect(mockKnex.raw).toHaveBeenCalledTimes(1)
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT set_config(?, ?, true)',
        [RLS_TENANT_VAR, 'tenant-123']
      )
    })
  })

  describe('clearRlsContext', () => {
    let mockKnex: any

    beforeEach(() => {
      mockKnex = {
        raw: jest.fn().mockResolvedValue({ rows: [] }),
      }
    })

    test('does nothing when RLS is disabled', async () => {
      delete process.env.RLS_ENABLED
      await clearRlsContext(mockKnex)
      expect(mockKnex.raw).not.toHaveBeenCalled()
    })

    test('clears both tenant and org context when RLS is enabled', async () => {
      process.env.RLS_ENABLED = 'true'
      await clearRlsContext(mockKnex)
      expect(mockKnex.raw).toHaveBeenCalledTimes(2)
      expect(mockKnex.raw).toHaveBeenCalledWith(
        "SELECT set_config(?, '', true)",
        [RLS_TENANT_VAR]
      )
      expect(mockKnex.raw).toHaveBeenCalledWith(
        "SELECT set_config(?, '', true)",
        [RLS_ORG_VAR]
      )
    })
  })

  describe('getRlsTenantContext', () => {
    test('returns tenant ID from database session (rows format)', async () => {
      const mockKnex = {
        raw: jest.fn().mockResolvedValue({ rows: [{ value: 'tenant-123' }] }),
      }
      const result = await getRlsTenantContext(mockKnex as any)
      expect(result).toBe('tenant-123')
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT current_setting(?, true) as value',
        [RLS_TENANT_VAR]
      )
    })

    test('returns tenant ID from database session (array format)', async () => {
      const mockKnex = {
        raw: jest.fn().mockResolvedValue([{ value: 'tenant-456' }]),
      }
      const result = await getRlsTenantContext(mockKnex as any)
      expect(result).toBe('tenant-456')
    })

    test('returns null for empty string', async () => {
      const mockKnex = {
        raw: jest.fn().mockResolvedValue({ rows: [{ value: '' }] }),
      }
      const result = await getRlsTenantContext(mockKnex as any)
      expect(result).toBeNull()
    })

    test('returns null when not set', async () => {
      const mockKnex = {
        raw: jest.fn().mockResolvedValue({ rows: [] }),
      }
      const result = await getRlsTenantContext(mockKnex as any)
      expect(result).toBeNull()
    })
  })

  describe('getRlsOrgContext', () => {
    test('returns organization ID from database session', async () => {
      const mockKnex = {
        raw: jest.fn().mockResolvedValue({ rows: [{ value: 'org-789' }] }),
      }
      const result = await getRlsOrgContext(mockKnex as any)
      expect(result).toBe('org-789')
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT current_setting(?, true) as value',
        [RLS_ORG_VAR]
      )
    })

    test('returns null for empty string', async () => {
      const mockKnex = {
        raw: jest.fn().mockResolvedValue({ rows: [{ value: '' }] }),
      }
      const result = await getRlsOrgContext(mockKnex as any)
      expect(result).toBeNull()
    })
  })

  describe('withRlsContext', () => {
    let mockKnex: any

    beforeEach(() => {
      mockKnex = {
        raw: jest.fn().mockResolvedValue({ rows: [] }),
      }
    })

    test('sets context and executes function', async () => {
      process.env.RLS_ENABLED = 'true'
      const fn = jest.fn().mockResolvedValue('result')

      const result = await withRlsContext(mockKnex, 'tenant-123', 'org-456', fn)

      expect(result).toBe('result')
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT set_config(?, ?, true)',
        [RLS_TENANT_VAR, 'tenant-123']
      )
      expect(mockKnex.raw).toHaveBeenCalledWith(
        'SELECT set_config(?, ?, true)',
        [RLS_ORG_VAR, 'org-456']
      )
      expect(fn).toHaveBeenCalled()
    })

    test('executes function even when RLS is disabled', async () => {
      delete process.env.RLS_ENABLED
      const fn = jest.fn().mockResolvedValue('result')

      const result = await withRlsContext(mockKnex, 'tenant-123', 'org-456', fn)

      expect(result).toBe('result')
      expect(mockKnex.raw).not.toHaveBeenCalled()
      expect(fn).toHaveBeenCalled()
    })

    test('propagates errors from the function', async () => {
      process.env.RLS_ENABLED = 'true'
      const error = new Error('Test error')
      const fn = jest.fn().mockRejectedValue(error)

      await expect(withRlsContext(mockKnex, 'tenant-123', null, fn)).rejects.toThrow('Test error')
    })
  })
})
