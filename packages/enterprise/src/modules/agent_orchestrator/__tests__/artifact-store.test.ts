import {
  ARTIFACT_REFS,
  createArtifactOffloader,
  getArtifact,
  putArtifact,
} from '../lib/trace/artifactStore'

/**
 * F1 encrypted artifact offload. These unit tests exercise the fail-open
 * contract (degrade to null when storage is absent / unconfigured) and the
 * encrypt→upload / download→decrypt round-trip against in-memory stubs, so no
 * real storage-s3 credentials are needed.
 */

const SCOPE = { tenantId: 't1', organizationId: 'o1' }

function makeContainer(registrations: Record<string, unknown>) {
  return {
    hasRegistration: (name: string) => name in registrations,
    resolve<T = unknown>(name: string): T {
      if (!(name in registrations)) throw new Error(`[internal] unregistered ${name}`)
      const value = registrations[name]
      if (value instanceof Error) throw value
      return value as T
    },
  }
}

/** In-memory storage stub keyed by generated key; `upload` records the bytes. */
function makeStorage() {
  const blobs = new Map<string, Buffer>()
  let seq = 0
  const service = {
    async upload({ buffer }: { buffer: Buffer }) {
      const key = `k-${++seq}`
      blobs.set(key, buffer)
      return { key }
    },
    async download({ key }: { key: string }) {
      const buffer = blobs.get(key)
      if (!buffer) throw new Error('[internal] missing blob')
      return { buffer }
    },
  }
  return { blobs, proxy: { _resolveService: async () => service } }
}

/** Reversible "encryption" stub: prefixes each mapped field value with ENC:. */
const encryption = {
  async encryptEntityPayload(_entityId: string, payload: Record<string, unknown>) {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(payload)) out[key] = `ENC:${String(value)}`
    return out
  },
  async decryptEntityPayload(_entityId: string, payload: Record<string, unknown>) {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(payload)) {
      out[key] = typeof value === 'string' && value.startsWith('ENC:') ? value.slice(4) : value
    }
    return out
  },
}

describe('artifactStore — putArtifact fail-open', () => {
  it('returns null when storageService is not registered', async () => {
    const container = makeContainer({})
    expect(await putArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, { a: 1 })).toBeNull()
  })

  it('returns null when the tenant has no storage credentials (_resolveService throws)', async () => {
    const container = makeContainer({
      storageService: {
        _resolveService: async () => {
          throw new Error('S3 storage integration is not configured for this tenant.')
        },
      },
    })
    expect(await putArtifact(container, SCOPE, ARTIFACT_REFS.toolRequest, { a: 1 })).toBeNull()
  })
})

describe('artifactStore — encrypt → upload → download → decrypt round-trip', () => {
  it('encrypts the blob and round-trips the original value', async () => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption })
    const value = { big: 'hello', nested: { a: 1 } }

    const key = await putArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, value)
    expect(key).toBe('k-1')
    // Bytes at rest pass through the encryption service (the reversible stub
    // marks each mapped field with ENC:; real crypto would render it opaque).
    const stored = blobs.get('k-1')!.toString('utf8')
    expect(stored).toContain('ENC:')

    const got = await getArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, key!)
    expect(got).toEqual(value)
  })

  it('stores a plaintext wrapper and round-trips when encryption is disabled', async () => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({ storageService: proxy })
    const value = { x: 1 }

    const key = await putArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, value)
    const stored = JSON.parse(blobs.get(key!)!.toString('utf8'))
    // Wrapped under the declared field name, serialized, but not encrypted.
    expect(stored).toEqual({ output: JSON.stringify(value) })

    const got = await getArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, key!)
    expect(got).toEqual(value)
  })
})

describe('artifactStore — getArtifact fail-open + offloader factory', () => {
  it('returns null when storage is unavailable', async () => {
    const container = makeContainer({})
    expect(await getArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, 'k-1')).toBeNull()
  })

  it('createArtifactOffloader binds container + scope to putArtifact', async () => {
    const { proxy } = makeStorage()
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption })
    const offload = createArtifactOffloader(container, SCOPE)

    const key = await offload(ARTIFACT_REFS.toolResponse, { a: 1 })
    expect(key).toBe('k-1')
    expect(await getArtifact(container, SCOPE, ARTIFACT_REFS.toolResponse, key!)).toEqual({ a: 1 })
  })
})
