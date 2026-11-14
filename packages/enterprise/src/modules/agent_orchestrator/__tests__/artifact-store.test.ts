import {
  ARTIFACT_REFS,
  AGENT_TRACE_ARTIFACT_NAMESPACE,
  AGENT_TRACE_CONTENT_NAMESPACE,
  createArtifactOffloader,
  deleteArtifact,
  getArtifact,
  putArtifact,
  readArtifact,
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
  const namespaces: string[] = []
  const service = {
    async upload({ buffer, namespace }: { buffer: Buffer; namespace: string }) {
      namespaces.push(namespace)
      const key = `k-${++seq}`
      blobs.set(key, buffer)
      return { key }
    },
    async download({ key }: { key: string }) {
      const buffer = blobs.get(key)
      if (!buffer) throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' })
      return { buffer }
    },
    async delete({ key }: { key: string }) {
      blobs.delete(key)
    },
  }
  return { blobs, namespaces, proxy: { _resolveService: async () => service } }
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

describe('artifactStore — namespace parameter', () => {
  it('defaults to the trace artifact namespace and honors an explicit namespace', async () => {
    const { proxy, namespaces } = makeStorage()
    const container = makeContainer({ storageService: proxy })

    await putArtifact(container, SCOPE, ARTIFACT_REFS.llmRequest, { a: 1 })
    await putArtifact(container, SCOPE, ARTIFACT_REFS.llmResponse, { a: 2 }, AGENT_TRACE_CONTENT_NAMESPACE)

    expect(namespaces).toEqual([AGENT_TRACE_ARTIFACT_NAMESPACE, AGENT_TRACE_CONTENT_NAMESPACE])
    expect(AGENT_TRACE_CONTENT_NAMESPACE).toBe('agent-trace-content')
  })
})

describe('artifactStore — readArtifact tri-state', () => {
  it('returns ok with the value', async () => {
    const { proxy } = makeStorage()
    const container = makeContainer({ storageService: proxy })
    const key = await putArtifact(container, SCOPE, ARTIFACT_REFS.contextPayload, { a: 1 })
    expect(await readArtifact(container, SCOPE, ARTIFACT_REFS.contextPayload, key!)).toEqual({
      status: 'ok',
      value: { a: 1 },
    })
  })

  it('returns missing for NoSuchKey, NotFound and 404 errors', async () => {
    const failures = [
      Object.assign(new Error('x'), { name: 'NoSuchKey' }),
      Object.assign(new Error('x'), { code: 'NotFound' }),
      Object.assign(new Error('x'), { $metadata: { httpStatusCode: 404 } }),
      new Error('NoSuchKey'),
    ]
    for (const failure of failures) {
      const container = makeContainer({
        storageService: {
          _resolveService: async () => ({
            download: async () => {
              throw failure
            },
          }),
        },
      })
      expect(await readArtifact(container, SCOPE, ARTIFACT_REFS.llmRequest, 'k')).toEqual({ status: 'missing' })
    }
  })

  it('returns unavailable without storage, on other errors and on decrypt failure', async () => {
    expect(await readArtifact(makeContainer({}), SCOPE, ARTIFACT_REFS.llmRequest, 'k')).toEqual({
      status: 'unavailable',
    })

    const failing = makeContainer({
      storageService: {
        _resolveService: async () => ({
          download: async () => {
            throw Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } })
          },
        }),
      },
    })
    expect(await readArtifact(failing, SCOPE, ARTIFACT_REFS.llmRequest, 'k')).toEqual({ status: 'unavailable' })

    const { proxy } = makeStorage()
    const plain = makeContainer({ storageService: proxy })
    const key = await putArtifact(plain, SCOPE, ARTIFACT_REFS.llmRequest, { a: 1 })
    const brokenDecrypt = makeContainer({
      storageService: proxy,
      tenantEncryptionService: {
        decryptEntityPayload: async () => {
          throw new Error('decrypt failed')
        },
      },
    })
    expect(await readArtifact(brokenDecrypt, SCOPE, ARTIFACT_REFS.llmRequest, key!)).toEqual({
      status: 'unavailable',
    })
  })

  it('keeps getArtifact returning null for missing blobs', async () => {
    const { proxy } = makeStorage()
    const container = makeContainer({ storageService: proxy })
    expect(await getArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, 'absent')).toBeNull()
  })
})

describe('artifactStore — deleteArtifact', () => {
  it('deletes an existing blob', async () => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({ storageService: proxy })
    const key = await putArtifact(container, SCOPE, ARTIFACT_REFS.llmRequest, { a: 1 })
    expect(await deleteArtifact(container, SCOPE, key!)).toEqual({ status: 'deleted' })
    expect(blobs.has(key!)).toBe(false)
  })

  it('treats NoSuchKey as success', async () => {
    const container = makeContainer({
      storageService: {
        _resolveService: async () => ({
          delete: async () => {
            throw Object.assign(new Error('gone'), { name: 'NoSuchKey' })
          },
        }),
      },
    })
    expect(await deleteArtifact(container, SCOPE, 'k')).toEqual({ status: 'deleted' })
  })

  it('reports unavailable without storage and rethrows other failures', async () => {
    expect(await deleteArtifact(makeContainer({}), SCOPE, 'k')).toEqual({ status: 'unavailable' })
    const container = makeContainer({
      storageService: {
        _resolveService: async () => ({
          delete: async () => {
            throw new Error('access denied')
          },
        }),
      },
    })
    await expect(deleteArtifact(container, SCOPE, 'k')).rejects.toThrow('access denied')
  })
})
