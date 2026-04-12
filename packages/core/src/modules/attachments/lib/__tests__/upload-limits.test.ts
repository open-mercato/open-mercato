import {
  isMultipartRequestWithinUploadLimit,
  resolveAttachmentMaxBytes,
  resolveAttachmentTenantQuotaBytes,
  resolveDefaultAttachmentMaxUploadBytes,
  willExceedAttachmentTenantQuota,
} from '../upload-limits'

describe('attachment upload limits', () => {
  const primaryMaxUploadEnv = 'OM_ATTACHMENT_MAX_UPLOAD_MB'
  const primaryQuotaEnv = 'OM_ATTACHMENT_TENANT_QUOTA_MB'
  const legacyMaxUploadEnv = 'OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB'
  const legacyQuotaEnv = 'OPENMERCATO_ATTACHMENT_TENANT_QUOTA_MB'
  const originalPrimaryMaxUploadMb = process.env[primaryMaxUploadEnv]
  const originalPrimaryQuotaMb = process.env[primaryQuotaEnv]
  const originalLegacyMaxUploadMb = process.env[legacyMaxUploadEnv]
  const originalLegacyQuotaMb = process.env[legacyQuotaEnv]

  beforeEach(() => {
    delete process.env[primaryMaxUploadEnv]
    delete process.env[primaryQuotaEnv]
    delete process.env[legacyMaxUploadEnv]
    delete process.env[legacyQuotaEnv]
  })

  afterAll(() => {
    if (originalPrimaryMaxUploadMb === undefined) delete process.env[primaryMaxUploadEnv]
    else process.env[primaryMaxUploadEnv] = originalPrimaryMaxUploadMb
    if (originalPrimaryQuotaMb === undefined) delete process.env[primaryQuotaEnv]
    else process.env[primaryQuotaEnv] = originalPrimaryQuotaMb
    if (originalLegacyMaxUploadMb === undefined) delete process.env[legacyMaxUploadEnv]
    else process.env[legacyMaxUploadEnv] = originalLegacyMaxUploadMb
    if (originalLegacyQuotaMb === undefined) delete process.env[legacyQuotaEnv]
    else process.env[legacyQuotaEnv] = originalLegacyQuotaMb
  })

  it('uses conservative defaults when env is not set', () => {
    expect(resolveDefaultAttachmentMaxUploadBytes()).toBe(25 * 1024 * 1024)
    expect(resolveAttachmentTenantQuotaBytes()).toBe(512 * 1024 * 1024)
  })

  it('caps field-specific max size by the global upload limit', () => {
    process.env[primaryMaxUploadEnv] = '5'
    expect(resolveAttachmentMaxBytes(10)).toBe(5 * 1024 * 1024)
    expect(resolveAttachmentMaxBytes(2)).toBe(2 * 1024 * 1024)
  })

  it('rejects multipart content length above the global limit with overhead', () => {
    process.env[primaryMaxUploadEnv] = '1'
    expect(isMultipartRequestWithinUploadLimit(String(3 * 1024 * 1024))).toBe(false)
  })

  it('detects tenant quota exhaustion', () => {
    process.env[primaryQuotaEnv] = '1'
    expect(willExceedAttachmentTenantQuota(900_000, 200_000)).toBe(true)
    expect(willExceedAttachmentTenantQuota(700_000, 200_000)).toBe(false)
  })

  it('falls back to legacy aliases when OM envs are unset', () => {
    process.env[legacyMaxUploadEnv] = '2'
    process.env[legacyQuotaEnv] = '3'
    expect(resolveDefaultAttachmentMaxUploadBytes()).toBe(2 * 1024 * 1024)
    expect(resolveAttachmentTenantQuotaBytes()).toBe(3 * 1024 * 1024)
  })
})
