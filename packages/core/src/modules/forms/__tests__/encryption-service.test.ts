import { randomBytes } from 'node:crypto'
import {
  DevDeterministicKmsAdapter,
  EnvMasterKeyKmsAdapter,
  FormsEncryptionError,
  FormsEncryptionService,
  redactSensitive,
  resolveKmsAdapter,
  setKmsAdapterFactory,
} from '../services/encryption-service'

class FakeEntityManager {
  private rows: Array<Record<string, unknown>> = []
  private autoFlushedRows: Array<Record<string, unknown>> = []
  private nowFactory = () => new Date()

  setNow(factory: () => Date) {
    this.nowFactory = factory
  }

  create(_entity: unknown, data: Record<string, unknown>): Record<string, unknown> {
    return { ...data }
  }

  persist(entity: Record<string, unknown>) {
    this.autoFlushedRows.push(entity)
  }

  async flush() {
    while (this.autoFlushedRows.length) {
      const next = this.autoFlushedRows.shift()
      if (!next) continue
      // ensure created_at filled when missing
      if (!next.createdAt) next.createdAt = this.nowFactory()
      this.upsert(next)
    }
  }

  async findOne(_entity: unknown, where: Record<string, unknown>, opts?: { orderBy?: Record<string, 'asc' | 'desc'> }): Promise<Record<string, unknown> | null> {
    const matches = this.rows.filter((row) => match(row, where))
    if (matches.length === 0) return null
    if (opts?.orderBy) {
      const [key, dir] = Object.entries(opts.orderBy)[0]
      matches.sort((a, b) => {
        const av = a[key] as number
        const bv = b[key] as number
        return dir === 'desc' ? bv - av : av - bv
      })
    }
    return matches[0]
  }

  private upsert(row: Record<string, unknown>) {
    const existingIndex = this.rows.findIndex(
      (entry) =>
        entry.organizationId === row.organizationId
        && entry.keyVersion === row.keyVersion,
    )
    if (existingIndex >= 0) {
      this.rows[existingIndex] = row
    } else {
      this.rows.push(row)
    }
  }
}

function match(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value === null) {
      if (row[key] !== null && row[key] !== undefined) return false
      continue
    }
    if (row[key] !== value) return false
  }
  return true
}

describe('FormsEncryptionService', () => {
  beforeEach(() => {
    process.env.FORMS_ENCRYPTION_KMS_KEY_ID = 'test-kms-key-id'
  })

  it('round-trips encrypt/decrypt for a payload', async () => {
    const em = new FakeEntityManager()
    const service = new FormsEncryptionService({
      emFactory: () => em as unknown as never,
    })

    const plaintext = Buffer.from(JSON.stringify({ full_name: 'Jane', dob: '1990-01-01' }), 'utf8')
    const ciphertext = await service.encrypt('org-1', plaintext)
    expect(ciphertext.subarray(0, 2).readUInt16BE(0)).toBe(0x0001)
    expect(ciphertext.subarray(2, 4).readUInt16BE(0)).toBe(1)

    const decrypted = await service.decrypt('org-1', ciphertext)
    expect(decrypted.toString('utf8')).toBe(plaintext.toString('utf8'))
  })

  it('uses cached DEK on subsequent calls without re-fetching', async () => {
    const em = new FakeEntityManager()
    const service = new FormsEncryptionService({
      emFactory: () => em as unknown as never,
    })
    await service.encrypt('org-1', Buffer.from('{}', 'utf8'))
    const findOneSpy = jest.spyOn(em, 'findOne')
    await service.encrypt('org-1', Buffer.from('{}', 'utf8'))
    // No cache miss → no findOne call should have been triggered.
    expect(findOneSpy).not.toHaveBeenCalled()
  })

  it('rotates keys and decrypts both old and new revisions', async () => {
    const em = new FakeEntityManager()
    const service = new FormsEncryptionService({
      emFactory: () => em as unknown as never,
    })
    const before = await service.encrypt('org-1', Buffer.from('before-rotation', 'utf8'))
    await service.rotate('org-1')
    const after = await service.encrypt('org-1', Buffer.from('after-rotation', 'utf8'))
    // After-rotation ciphertext should advertise key_version = 2
    expect(after.subarray(2, 4).readUInt16BE(0)).toBe(2)
    expect((await service.decrypt('org-1', before)).toString('utf8')).toBe('before-rotation')
    expect((await service.decrypt('org-1', after)).toString('utf8')).toBe('after-rotation')
    expect(await service.currentKeyVersion('org-1')).toBe(2)
  })

  it('rejects ciphertext shorter than the envelope header', async () => {
    const em = new FakeEntityManager()
    const service = new FormsEncryptionService({
      emFactory: () => em as unknown as never,
    })
    await service.encrypt('org-1', Buffer.from('seed', 'utf8')) // ensure key exists
    await expect(service.decrypt('org-1', Buffer.alloc(4))).rejects.toBeInstanceOf(FormsEncryptionError)
  })

  it('rejects ciphertext with an unsupported format version', async () => {
    const em = new FakeEntityManager()
    const service = new FormsEncryptionService({
      emFactory: () => em as unknown as never,
    })
    await service.encrypt('org-1', Buffer.from('seed', 'utf8'))
    const bogus = Buffer.alloc(50)
    bogus.writeUInt16BE(0xffff, 0)
    bogus.writeUInt16BE(1, 2)
    await expect(service.decrypt('org-1', bogus)).rejects.toBeInstanceOf(FormsEncryptionError)
  })
})

describe('DevDeterministicKmsAdapter', () => {
  it('wraps and unwraps a 32-byte DEK losslessly', async () => {
    const adapter = new DevDeterministicKmsAdapter('test-kms')
    const dek = Buffer.alloc(32, 7)
    const wrapped = await adapter.wrap(dek)
    const unwrapped = await adapter.unwrap(wrapped)
    expect(unwrapped.equals(dek)).toBe(true)
  })

  it('rejects non-32-byte DEK on wrap', async () => {
    const adapter = new DevDeterministicKmsAdapter('test-kms')
    await expect(adapter.wrap(Buffer.alloc(16))).rejects.toBeInstanceOf(FormsEncryptionError)
  })
})

describe('EnvMasterKeyKmsAdapter', () => {
  it('round-trips wrap/unwrap with a 32-byte master key', async () => {
    const adapter = new EnvMasterKeyKmsAdapter(Buffer.alloc(32, 9))
    const dek = randomBytes(32)
    const wrapped = await adapter.wrap(dek)
    const unwrapped = await adapter.unwrap(wrapped)
    expect(unwrapped.equals(dek)).toBe(true)
  })

  it('produces the same envelope length as the dev adapter', async () => {
    const env = new EnvMasterKeyKmsAdapter(Buffer.alloc(32, 1))
    const dev = new DevDeterministicKmsAdapter('id')
    const dek = randomBytes(32)
    const a = await env.wrap(dek)
    const b = await dev.wrap(dek)
    expect(a.length).toBe(b.length)
  })

  it('fails to unwrap a tampered wrapped blob', async () => {
    const adapter = new EnvMasterKeyKmsAdapter(Buffer.alloc(32, 5))
    const wrapped = await adapter.wrap(randomBytes(32))
    wrapped[wrapped.length - 1] ^= 0xff
    await expect(adapter.unwrap(wrapped)).rejects.toBeInstanceOf(FormsEncryptionError)
  })

  it('accepts a base64-encoded 32-byte key', () => {
    const encoded = randomBytes(32).toString('base64')
    expect(EnvMasterKeyKmsAdapter.fromEncoded(encoded)).toBeInstanceOf(EnvMasterKeyKmsAdapter)
  })

  it('accepts a hex-encoded 32-byte key', () => {
    const encoded = randomBytes(32).toString('hex')
    expect(EnvMasterKeyKmsAdapter.fromEncoded(encoded)).toBeInstanceOf(EnvMasterKeyKmsAdapter)
  })

  it('throws on a missing master key', () => {
    expect(() => EnvMasterKeyKmsAdapter.fromEncoded(undefined)).toThrow(FormsEncryptionError)
  })

  it('throws on a short (non-32-byte) master key', () => {
    const tooShort = randomBytes(16).toString('hex')
    expect(() => EnvMasterKeyKmsAdapter.fromEncoded(tooShort)).toThrow(FormsEncryptionError)
  })

  it('drives a full FormsEncryptionService encrypt/decrypt round-trip when injected', async () => {
    const em = new FakeEntityManager()
    const service = new FormsEncryptionService({
      emFactory: () => em as unknown as never,
      kmsAdapter: new EnvMasterKeyKmsAdapter(Buffer.alloc(32, 3)),
    })
    const plaintext = Buffer.from(JSON.stringify({ ssn: '111-22-3333' }), 'utf8')
    const ciphertext = await service.encrypt('org-env', plaintext)
    // Force a DEK cache miss so the wrapped DEK is unwrapped via the Env adapter.
    service.resetCache()
    const decrypted = await service.decrypt('org-env', ciphertext)
    expect(decrypted.toString('utf8')).toBe(plaintext.toString('utf8'))
  })
})

describe('resolveKmsAdapter', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalMasterKey = process.env.FORMS_ENCRYPTION_MASTER_KEY

  afterEach(() => {
    setKmsAdapterFactory(null)
    if (originalNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalMasterKey === undefined) delete process.env.FORMS_ENCRYPTION_MASTER_KEY
    else process.env.FORMS_ENCRYPTION_MASTER_KEY = originalMasterKey
  })

  it('selects the Env adapter when a valid master key is present', () => {
    const env = { FORMS_ENCRYPTION_MASTER_KEY: randomBytes(32).toString('base64') } as NodeJS.ProcessEnv
    expect(resolveKmsAdapter(env)).toBeInstanceOf(EnvMasterKeyKmsAdapter)
  })

  it('falls back to the Dev adapter when no master key is set (non-production)', () => {
    const env = { FORMS_ENCRYPTION_KMS_KEY_ID: 'dev-id' } as NodeJS.ProcessEnv
    expect(resolveKmsAdapter(env)).toBeInstanceOf(DevDeterministicKmsAdapter)
  })

  it('prefers an operator-registered factory over env resolution', () => {
    const custom = new EnvMasterKeyKmsAdapter(Buffer.alloc(32, 2))
    setKmsAdapterFactory(() => custom)
    const env = {} as NodeJS.ProcessEnv
    expect(resolveKmsAdapter(env)).toBe(custom)
  })

  it('throws INSECURE_KMS_IN_PRODUCTION when production has no master key', () => {
    const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv
    expect(() => resolveKmsAdapter(env)).toThrow(FormsEncryptionError)
    try {
      resolveKmsAdapter(env)
    } catch (error) {
      expect((error as FormsEncryptionError).code).toBe('INSECURE_KMS_IN_PRODUCTION')
    }
  })

  it('does not throw in production when a valid master key is set', () => {
    const env = {
      NODE_ENV: 'production',
      FORMS_ENCRYPTION_MASTER_KEY: randomBytes(32).toString('hex'),
    } as NodeJS.ProcessEnv
    expect(resolveKmsAdapter(env)).toBeInstanceOf(EnvMasterKeyKmsAdapter)
  })
})

describe('redactSensitive', () => {
  it('replaces values for fields marked x-om-sensitive', () => {
    const compiled = {
      schemaHash: 'h',
      ajv: (() => true) as unknown as never,
      zod: {} as never,
      registryVersion: 'v1:test',
      rolePolicyLookup: () => ({ canRead: false, canWrite: false }),
      fieldIndex: {
        full_name: {
          key: 'full_name',
          type: 'text',
          sectionKey: null,
          sensitive: false,
          editableBy: ['patient'],
          visibleTo: ['patient', 'admin'],
          required: true,
        },
        ssn: {
          key: 'ssn',
          type: 'text',
          sectionKey: null,
          sensitive: true,
          editableBy: ['patient'],
          visibleTo: ['admin'],
          required: false,
        },
      },
    }
    const out = redactSensitive(compiled, { full_name: 'Jane', ssn: '111-22-3333' })
    expect(out.full_name).toBe('Jane')
    expect(out.ssn).toBe('[REDACTED]')
  })
})
