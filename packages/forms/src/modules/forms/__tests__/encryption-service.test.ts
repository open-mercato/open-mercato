import {
  DevDeterministicKmsAdapter,
  FormsEncryptionError,
  FormsEncryptionService,
  redactSensitive,
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
