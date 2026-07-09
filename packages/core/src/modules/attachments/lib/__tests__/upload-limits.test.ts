import {
  isMultipartRequestWithinUploadLimit,
  MultipartUploadLimitError,
  parseMultipartFormDataWithinUploadLimit,
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

  it('rejects a streamed multipart body that exceeds a missing or dishonest content length', async () => {
    process.env[primaryMaxUploadEnv] = '0.000001'
    const boundary = 'upload-limit'
    const body = new TextEncoder().encode([
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="metadata"\r\n\r\n',
      'x'.repeat(1024 * 1024),
      `\r\n--${boundary}--\r\n`,
    ].join(''))

    for (const contentLength of [null, 'invalid', '1']) {
      const headers = new Headers({ 'content-type': `multipart/form-data; boundary=${boundary}` })
      if (contentLength !== null) headers.set('content-length', contentLength)
      const request = new Request('http://example.test/upload', { method: 'POST', headers, body })

      await expect(parseMultipartFormDataWithinUploadLimit(request)).rejects.toBeInstanceOf(MultipartUploadLimitError)
    }
  })

  it('parses a valid multipart body exactly at the total request limit', async () => {
    process.env[primaryMaxUploadEnv] = '0.000001'
    const boundary = 'exact-boundary'
    const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n`
    const suffix = `\r\n--${boundary}--\r\n`
    const maxBytes = resolveDefaultAttachmentMaxUploadBytes() + 1024 * 1024
    const value = 'x'.repeat(maxBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))
    const body = new TextEncoder().encode(`${prefix}${value}${suffix}`)
    const request = new Request('http://example.test/upload', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.byteLength),
      },
      body,
    })

    const form = await parseMultipartFormDataWithinUploadLimit(request)

    expect(body.byteLength).toBe(maxBytes)
    expect(form.get('metadata')).toBe(value)
  })

  it('stops pulling the request stream after the total request limit is crossed', async () => {
    process.env[primaryMaxUploadEnv] = '0.000001'
    let pulls = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(1024 * 1024 + 2))
      },
      cancel(error) {
        cancelled = error instanceof MultipartUploadLimitError
      },
    }, { highWaterMark: 0 })
    const request = new Request('http://example.test/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=unused' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    await expect(parseMultipartFormDataWithinUploadLimit(request)).rejects.toBeInstanceOf(MultipartUploadLimitError)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pulls).toBe(1)
    expect(cancelled).toBe(true)
  })
})
