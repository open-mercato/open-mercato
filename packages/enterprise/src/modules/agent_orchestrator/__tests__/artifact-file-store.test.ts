import {
  AGENT_ARTIFACT_FILE_NAMESPACE,
  getArtifactBytes,
  putArtifactBytes,
  putArtifactBytesResult,
} from '../lib/runtime/artifactFileStore'
import { createTestArtifactEncryption, passThroughArtifactEncryption } from './support/artifactEncryption'

const SCOPE = { tenantId: 't1', organizationId: 'o1' }
const BYTES = Buffer.from('%PDF-1.7 customer statement for jane.doe@example.com', 'utf8')
const FILE = { buffer: BYTES, fileName: 'statement.pdf', mimeType: 'application/pdf' }

function makeContainer(registrations: Record<string, unknown>) {
  return {
    hasRegistration: (name: string) => name in registrations,
    resolve<T = unknown>(name: string): T {
      if (!(name in registrations)) throw new Error(`[internal] unregistered ${name}`)
      return registrations[name] as T
    },
  }
}

function makeStorage() {
  const blobs = new Map<string, Buffer>()
  const uploads: Array<{ namespace: string; fileName: string }> = []
  let seq = 0
  const service = {
    async upload({ buffer, namespace, fileName }: { buffer: Buffer; namespace: string; fileName: string }) {
      uploads.push({ namespace, fileName })
      const key = `f-${++seq}`
      blobs.set(key, buffer)
      return { key }
    },
    async download({ key }: { key: string }) {
      const buffer = blobs.get(key)
      if (!buffer) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' })
      return { buffer }
    },
  }
  return { blobs, uploads, proxy: { _resolveService: async () => service } }
}

describe('artifactFileStore — putArtifactBytes', () => {
  it('stores the bytes sealed under the tenant DEK and round-trips them', async () => {
    const encryption = createTestArtifactEncryption()
    const { proxy, blobs, uploads } = makeStorage()
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption.service })

    const key = await putArtifactBytes(container, SCOPE, FILE)

    expect(key).toBe('f-1')
    expect(uploads).toEqual([{ namespace: AGENT_ARTIFACT_FILE_NAMESPACE, fileName: 'statement.pdf.enc' }])
    const stored = blobs.get('f-1')!
    expect(stored.toString('utf8')).not.toContain(BYTES.toString('base64'))
    expect(encryption.openSealedBuffer(stored)).toEqual({ caption: BYTES.toString('base64') })
    expect(await getArtifactBytes(container, SCOPE, key!)).toEqual(BYTES)
  })

  it('returns null when storage is not registered', async () => {
    const encryption = createTestArtifactEncryption()
    const container = makeContainer({ tenantEncryptionService: encryption.service })
    expect(await putArtifactBytes(container, SCOPE, FILE)).toBeNull()
  })

  it('uploads nothing when no tenant encryption service is registered', async () => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({ storageService: proxy })

    expect(await putArtifactBytes(container, SCOPE, FILE)).toBeNull()
    expect(blobs.size).toBe(0)
  })

  it('uploads nothing when encryption passes the bytes through (KMS unhealthy / no DEK)', async () => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: passThroughArtifactEncryption })

    expect(await putArtifactBytes(container, SCOPE, FILE)).toBeNull()
    expect(blobs.size).toBe(0)
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

    expect(await putArtifactBytes(container, SCOPE, FILE)).toBeNull()
    expect(blobs.size).toBe(0)
  })
})

describe('artifactFileStore — putArtifactBytesResult reasons', () => {
  it('reports stored with the key', async () => {
    const encryption = createTestArtifactEncryption()
    const { proxy } = makeStorage()
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption.service })

    expect(await putArtifactBytesResult(container, SCOPE, FILE)).toEqual({ status: 'stored', key: 'f-1' })
  })

  it('reports storage_unavailable when storage is not registered', async () => {
    const encryption = createTestArtifactEncryption()
    const container = makeContainer({ tenantEncryptionService: encryption.service })

    expect(await putArtifactBytesResult(container, SCOPE, FILE)).toEqual({ status: 'storage_unavailable' })
  })

  it('reports storage_unavailable when the upload throws', async () => {
    const encryption = createTestArtifactEncryption()
    const container = makeContainer({
      storageService: {
        _resolveService: async () => ({
          upload: async () => {
            throw new Error('[internal] s3 down')
          },
          download: async () => ({ buffer: Buffer.alloc(0) }),
        }),
      },
      tenantEncryptionService: encryption.service,
    })

    expect(await putArtifactBytesResult(container, SCOPE, FILE)).toEqual({ status: 'storage_unavailable' })
  })

  it.each([
    ['no tenant encryption service is registered', {}],
    ['encryption passes the bytes through', { tenantEncryptionService: passThroughArtifactEncryption }],
    [
      'encryption throws',
      {
        tenantEncryptionService: {
          encryptEntityPayload: async () => {
            throw new Error('[internal] kms down')
          },
        },
      },
    ],
  ])('reports encryption_unavailable and uploads nothing when %s', async (_label, registrations) => {
    const { proxy, blobs } = makeStorage()
    const container = makeContainer({ storageService: proxy, ...registrations })

    expect(await putArtifactBytesResult(container, SCOPE, FILE)).toEqual({ status: 'encryption_unavailable' })
    expect(blobs.size).toBe(0)
  })
})

describe('artifactFileStore — getArtifactBytes', () => {
  it('still reads a plaintext blob stored before writes failed closed', async () => {
    const encryption = createTestArtifactEncryption()
    const { proxy, blobs } = makeStorage()
    blobs.set('legacy', Buffer.from(JSON.stringify({ caption: BYTES.toString('base64') }), 'utf8'))
    const container = makeContainer({ storageService: proxy, tenantEncryptionService: encryption.service })

    expect(await getArtifactBytes(container, SCOPE, 'legacy')).toEqual(BYTES)
  })

  it('returns null for a missing object', async () => {
    const { proxy } = makeStorage()
    const container = makeContainer({ storageService: proxy })
    expect(await getArtifactBytes(container, SCOPE, 'absent')).toBeNull()
  })
})
