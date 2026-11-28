import {
  ARTIFACT_REFS,
  AGENT_TRACE_ARTIFACT_NAMESPACE,
  AGENT_TRACE_CONTENT_NAMESPACE,
  createArtifactOffloader,
  deleteArtifact,
  getArtifact,
  putArtifact,
  putArtifactResult,
  readArtifact,
} from '../lib/trace/artifactStore'
import { createTestArtifactEncryption, passThroughArtifactEncryption } from './support/artifactEncryption'

/**
 * F1 encrypted artifact offload. These unit tests exercise the fail-open
 * storage contract (degrade to null when storage is absent / unconfigured), the
 * fail-closed encryption contract (never upload a payload that did not come back
 * sealed), and the encrypt→upload / download→decrypt round-trip against
 * in-memory stubs with real AES-GCM, so no storage-s3 credentials are needed.
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

const testEncryption = createTestArtifactEncryption()
const encryption = testEncryption.service

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
    const stored = blobs.get('k-1')!
    expect(stored.toString('utf8')).not.toContain('hello')
    expect(testEncryption.openSealedBuffer(stored)).toEqual({ output: JSON.stringify(value) })

    const got = await getArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, key!)
    expect(got).toEqual(value)
  })

  it('reads a plaintext blob stored before writes failed closed', async () => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption })
    blobs.set('legacy', Buffer.from(JSON.stringify({ output: JSON.stringify({ x: 1 }) }), 'utf8'))

    expect(await getArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, 'legacy')).toEqual({ x: 1 })
  })
})

describe('artifactStore — putArtifact fails closed when encryption is on but unavailable', () => {
  it('uploads nothing when no tenant encryption service is registered', async () => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({ storageService: proxy })

    expect(await putArtifact(container, SCOPE, ARTIFACT_REFS.llmRequest, { prompt: 'secret' })).toBeNull()
    expect(blobs.size).toBe(0)
  })

  it('uploads nothing when the service returns the payload unencrypted (KMS unhealthy / no DEK)', async () => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: passThroughArtifactEncryption })

    expect(
      await putArtifact(container, SCOPE, ARTIFACT_REFS.llmResponse, { text: 'secret' }, AGENT_TRACE_CONTENT_NAMESPACE),
    ).toBeNull()
    expect(blobs.size).toBe(0)
  })

  it('uploads nothing when the service drops the field or returns a non-envelope value', async () => {
    const outputs: Array<Record<string, unknown>> = [{}, { output: 'not-an-envelope' }, { output: 'aaaa:bbbb:cccc:v1' }]
    for (const sealed of outputs) {
      const { proxy, blobs } = makeStorage()
      const container = makeContainer({
        storageService: proxy,
        tenantEncryptionService: { encryptEntityPayload: async () => sealed },
      })
      expect(await putArtifact(container, SCOPE, ARTIFACT_REFS.runOutput, { a: 1 })).toBeNull()
      expect(blobs.size).toBe(0)
    }
  })

  it('returns null without uploading when encryption throws', async () => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({
      storageService: proxy,
      tenantEncryptionService: {
        encryptEntityPayload: async () => {
          throw new Error('[internal] kms down')
        },
      },
    })

    expect(await putArtifact(container, SCOPE, ARTIFACT_REFS.contextPayload, { a: 1 })).toBeNull()
    expect(blobs.size).toBe(0)
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
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption })

    await putArtifact(container, SCOPE, ARTIFACT_REFS.llmRequest, { a: 1 })
    await putArtifact(container, SCOPE, ARTIFACT_REFS.llmResponse, { a: 2 }, AGENT_TRACE_CONTENT_NAMESPACE)

    expect(namespaces).toEqual([AGENT_TRACE_ARTIFACT_NAMESPACE, AGENT_TRACE_CONTENT_NAMESPACE])
    expect(AGENT_TRACE_CONTENT_NAMESPACE).toBe('agent-trace-content')
  })
})

describe('artifactStore — readArtifact tri-state', () => {
  it('returns ok with the value', async () => {
    const { proxy } = makeStorage()
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption })
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
    const sealing = makeContainer({ storageService: proxy, tenantEncryptionService: encryption })
    const key = await putArtifact(sealing, SCOPE, ARTIFACT_REFS.llmRequest, { a: 1 })
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
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption })
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

describe('artifactStore — putArtifactResult reports why nothing was stored', () => {
  it('returns stored with the key', async () => {
    const { proxy } = makeStorage()
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption })
    expect(await putArtifactResult(container, SCOPE, ARTIFACT_REFS.llmRequest, { a: 1 })).toEqual({
      status: 'stored',
      key: 'k-1',
    })
  })

  it('returns encryption_unavailable without uploading when the payload cannot be sealed', async () => {
    for (const registrations of [{}, { tenantEncryptionService: passThroughArtifactEncryption }]) {
      const { proxy, blobs } = makeStorage()
      const container = makeContainer({ storageService: proxy, ...registrations })
      expect(await putArtifactResult(container, SCOPE, ARTIFACT_REFS.llmRequest, { a: 1 })).toEqual({
        status: 'encryption_unavailable',
      })
      expect(blobs.size).toBe(0)
    }
  })

  it('returns storage_unavailable when storage is absent or the upload fails', async () => {
    expect(
      await putArtifactResult(makeContainer({ tenantEncryptionService: encryption }), SCOPE, ARTIFACT_REFS.llmRequest, {}),
    ).toEqual({ status: 'storage_unavailable' })
    const failing = makeContainer({
      tenantEncryptionService: encryption,
      storageService: {
        _resolveService: async () => ({
          upload: async () => {
            throw new Error('[internal] s3 down')
          },
        }),
      },
    })
    expect(await putArtifactResult(failing, SCOPE, ARTIFACT_REFS.llmRequest, {})).toEqual({
      status: 'storage_unavailable',
    })
  })

  it('returns storage_unavailable when encryption throws', async () => {
    const { proxy } = makeStorage()
    const container = makeContainer({
      storageService: proxy,
      tenantEncryptionService: {
        encryptEntityPayload: async () => {
          throw new Error('[internal] kms down')
        },
      },
    })
    expect(await putArtifactResult(container, SCOPE, ARTIFACT_REFS.llmRequest, {})).toEqual({
      status: 'storage_unavailable',
    })
  })
})

describe('artifactStore — encryption turned off by the operator', () => {
  const original = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'false'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = original
  })

  it('stores a plaintext wrapper and round-trips it, with or without an encryption service', async () => {
    for (const registrations of [{}, { tenantEncryptionService: passThroughArtifactEncryption }]) {
      const { proxy, blobs } = makeStorage()
      const container = makeContainer({ storageService: proxy, ...registrations })
      const value = { prompt: 'hello' }

      const result = await putArtifactResult(container, SCOPE, ARTIFACT_REFS.llmRequest, value)

      expect(result).toEqual({ status: 'stored', key: 'k-1' })
      expect(JSON.parse(blobs.get('k-1')!.toString('utf8'))).toEqual({ input: JSON.stringify(value) })
      expect(await getArtifact(container, SCOPE, ARTIFACT_REFS.llmRequest, 'k-1')).toEqual(value)
    }
  })
})
