import {
  isMultipartRequestWithinUploadLimit,
  resolveAttachmentMaxBytes,
  resolveAttachmentTenantQuotaBytes,
  resolveDefaultAttachmentMaxUploadBytes,
  willExceedAttachmentTenantQuota,
} from '../upload-limits'

describe('attachment upload limits', () => {
  const originalMaxUploadMb = process.env.OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB
  const originalQuotaMb = process.env.OPENMERCATO_ATTACHMENT_TENANT_QUOTA_MB

  beforeEach(() => {
    delete process.env.OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB
    delete process.env.OPENMERCATO_ATTACHMENT_TENANT_QUOTA_MB
  })

  afterAll(() => {
    if (originalMaxUploadMb === undefined) delete process.env.OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB
    else process.env.OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB = originalMaxUploadMb
    if (originalQuotaMb === undefined) delete process.env.OPENMERCATO_ATTACHMENT_TENANT_QUOTA_MB
    else process.env.OPENMERCATO_ATTACHMENT_TENANT_QUOTA_MB = originalQuotaMb
  })

  it('uses conservative defaults when env is not set', () => {
    expect(resolveDefaultAttachmentMaxUploadBytes()).toBe(25 * 1024 * 1024)
    expect(resolveAttachmentTenantQuotaBytes()).toBe(512 * 1024 * 1024)
  })

  it('caps field-specific max size by the global upload limit', () => {
    process.env.OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB = '5'
    expect(resolveAttachmentMaxBytes(10)).toBe(5 * 1024 * 1024)
    expect(resolveAttachmentMaxBytes(2)).toBe(2 * 1024 * 1024)
  })

  it('rejects multipart content length above the global limit with overhead', () => {
    process.env.OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB = '1'
    expect(isMultipartRequestWithinUploadLimit(String(3 * 1024 * 1024))).toBe(false)
  })

  it('detects tenant quota exhaustion', () => {
    process.env.OPENMERCATO_ATTACHMENT_TENANT_QUOTA_MB = '1'
    expect(willExceedAttachmentTenantQuota(900_000, 200_000)).toBe(true)
    expect(willExceedAttachmentTenantQuota(700_000, 200_000)).toBe(false)
  })
})
