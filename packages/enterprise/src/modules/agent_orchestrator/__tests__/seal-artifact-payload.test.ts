import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { sealArtifactPayload } from '../lib/trace/sealArtifactPayload'
import { createTestArtifactEncryption, passThroughArtifactEncryption } from './support/artifactEncryption'

const SCOPE = { tenantId: 't1', organizationId: 'o1' }
const REF = { entityId: 'agent_orchestrator:agent_run', field: 'input' }
const PLAINTEXT = JSON.stringify({ prompt: 'refund order for jane.doe@example.com' })

describe('sealArtifactPayload', () => {
  it('returns the sealed wrapper when the field comes back as an AES-GCM envelope', async () => {
    const encryption = createTestArtifactEncryption()
    const sealed = await sealArtifactPayload(encryption.service, SCOPE, REF, PLAINTEXT)

    expect(sealed).not.toBeNull()
    expect(sealed!.input).not.toBe(PLAINTEXT)
    expect(encryption.openSealedBuffer(Buffer.from(JSON.stringify(sealed)))).toEqual({ input: PLAINTEXT })
  })

  it('passes the ref, payload and scope to the encryption service', async () => {
    const encryption = createTestArtifactEncryption()
    const encryptEntityPayload = jest.fn(encryption.service.encryptEntityPayload)

    await sealArtifactPayload({ encryptEntityPayload }, SCOPE, REF, PLAINTEXT)

    expect(encryptEntityPayload).toHaveBeenCalledWith(REF.entityId, { input: PLAINTEXT }, 't1', 'o1')
  })

  it('returns null without a service', async () => {
    expect(await sealArtifactPayload(null, SCOPE, REF, PLAINTEXT)).toBeNull()
  })

  it('returns null when the service passes the payload through', async () => {
    expect(await sealArtifactPayload(passThroughArtifactEncryption, SCOPE, REF, PLAINTEXT)).toBeNull()
  })

  it.each([
    ['a missing field', {}],
    ['a null field', { input: null }],
    ['a non-envelope string', { input: 'ENC:something' }],
    ['a forged short envelope', { input: 'aaaa:bbbb:cccc:v1' }],
  ])('returns null for %s', async (_label, result) => {
    const service = { encryptEntityPayload: async () => result }
    expect(await sealArtifactPayload(service, SCOPE, REF, PLAINTEXT)).toBeNull()
  })

  it('propagates encryption errors so callers can log and degrade', async () => {
    const service = {
      encryptEntityPayload: async () => {
        throw new Error('[internal] kms down')
      },
    }
    await expect(sealArtifactPayload(service, SCOPE, REF, PLAINTEXT)).rejects.toThrow('kms down')
  })

  describe('with the real TenantDataEncryptionService', () => {
    const originalToggle = process.env.TENANT_DATA_ENCRYPTION

    afterEach(() => {
      if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = originalToggle
    })

    it('returns null when tenant data encryption is disabled', async () => {
      process.env.TENANT_DATA_ENCRYPTION = 'false'
      const service = new TenantDataEncryptionService({} as never)
      expect(await sealArtifactPayload(service, SCOPE, REF, PLAINTEXT)).toBeNull()
    })
  })
})
