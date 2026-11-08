/** @jest-environment node */

import {
  INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS,
  InboundAttachmentsConfigError,
  readInboundAttachmentsConfig,
  resolveInboundAttachmentsConfig,
} from '../inboundAttachmentsConfig'

const MIB = 1024 * 1024

describe('readInboundAttachmentsConfig', () => {
  const savedMaxUpload = process.env.OM_ATTACHMENT_MAX_UPLOAD_MB

  afterEach(() => {
    if (savedMaxUpload === undefined) delete process.env.OM_ATTACHMENT_MAX_UPLOAD_MB
    else process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = savedMaxUpload
  })

  it('uses the documented defaults', () => {
    delete process.env.OM_ATTACHMENT_MAX_UPLOAD_MB
    expect(readInboundAttachmentsConfig({})).toEqual({
      enabled: true,
      allowUnguardedReaders: false,
      resendStubEnabled: false,
      maxAttachments: 20,
      maxTotalBytes: 25 * MIB,
      maxFileBytes: 25 * MIB,
      inlineImageMinBytes: 16 * 1024,
      fetchTimeoutMs: 30_000,
      leaseMs: 1_800_000,
      retryDelayMs: 900_000,
      maxPartAttempts: 3,
      maxTextChars: 60_000,
      maxTextCharsPerFile: 20_000,
    })
  })

  it('reads overrides and treats blank values as unset', () => {
    const config = readInboundAttachmentsConfig({
      INBOX_OPS_ATTACHMENTS_ENABLED: 'false',
      INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS: 'true',
      OM_ENABLE_RESEND_STUB: '1',
      RESEND_API_KEY: 're_stub_test',
      INBOX_OPS_MAX_ATTACHMENTS: '5',
      INBOX_OPS_MAX_ATTACHMENTS_TOTAL_BYTES: ' ',
      INBOX_OPS_INLINE_IMAGE_MIN_BYTES: '0',
      INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS: '10000',
      INBOX_OPS_ATTACHMENT_LEASE_MS: '600000',
      INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS_PER_FILE: '500',
    })
    expect(config).toMatchObject({
      enabled: false,
      allowUnguardedReaders: true,
      resendStubEnabled: true,
      maxAttachments: 5,
      maxTotalBytes: 25 * MIB,
      inlineImageMinBytes: 0,
      fetchTimeoutMs: 10_000,
      leaseMs: 600_000,
      maxTextCharsPerFile: 500,
    })
  })

  it.each([
    ['unset', undefined],
    ['a real key', 're_live_123'],
    ['the bare prefix', 're_stub_'],
  ])('keeps the Resend stub off without a stub API key (%s)', (_label, key) => {
    expect(readInboundAttachmentsConfig({ OM_ENABLE_RESEND_STUB: 'true', RESEND_API_KEY: key }).resendStubEnabled).toBe(false)
  })

  it('takes the per-file limit from the attachments module', () => {
    process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = '10'
    expect(readInboundAttachmentsConfig({}).maxFileBytes).toBe(10 * MIB)
  })

  it('refuses a lease that does not exceed four fetch timeouts', () => {
    expect(() => readInboundAttachmentsConfig({
      INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS: '30000',
      INBOX_OPS_ATTACHMENT_LEASE_MS: '120000',
    })).toThrow(InboundAttachmentsConfigError)
    expect(() => readInboundAttachmentsConfig({
      INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS: '30000',
      INBOX_OPS_ATTACHMENT_LEASE_MS: '120001',
    })).not.toThrow()
  })

  it('refuses a lease above the ingest worker lockDuration', () => {
    try {
      readInboundAttachmentsConfig({ INBOX_OPS_ATTACHMENT_LEASE_MS: String(INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS + 1) })
      throw new Error('expected a configuration error')
    } catch (error) {
      expect(error).toBeInstanceOf(InboundAttachmentsConfigError)
      expect((error as InboundAttachmentsConfigError).issues).toEqual([
        expect.stringContaining('INBOX_OPS_ATTACHMENT_LEASE_MS'),
      ])
    }
  })

  it.each([
    ['INBOX_OPS_MAX_ATTACHMENTS', 'abc'],
    ['INBOX_OPS_MAX_ATTACHMENTS', '0'],
    ['INBOX_OPS_MAX_ATTACHMENTS_TOTAL_BYTES', '1.5'],
    ['INBOX_OPS_INLINE_IMAGE_MIN_BYTES', '-1'],
    ['INBOX_OPS_ATTACHMENT_MAX_PART_ATTEMPTS', '0'],
    ['INBOX_OPS_ATTACHMENTS_ENABLED', 'maybe'],
  ])('refuses %s=%s', (name, value) => {
    expect(() => readInboundAttachmentsConfig({ [name]: value })).toThrow(InboundAttachmentsConfigError)
  })
})

describe('resolveInboundAttachmentsConfig', () => {
  it('returns the parsed config and no error for a valid environment', () => {
    const resolved = resolveInboundAttachmentsConfig({ INBOX_OPS_MAX_ATTACHMENTS: '5' })
    expect(resolved.error).toBeNull()
    expect(resolved.config.maxAttachments).toBe(5)
  })

  it('falls back per variable and keeps the valid ones', () => {
    const resolved = resolveInboundAttachmentsConfig({
      INBOX_OPS_MAX_ATTACHMENTS: 'abc',
      INBOX_OPS_MAX_ATTACHMENT_TEXT_CHARS_PER_FILE: '500',
    })
    expect(resolved.error).toBeInstanceOf(InboundAttachmentsConfigError)
    expect(resolved.error?.issues).toEqual([expect.stringContaining('INBOX_OPS_MAX_ATTACHMENTS')])
    expect(resolved.config).toMatchObject({ enabled: true, maxAttachments: 20, maxTextCharsPerFile: 500 })
  })

  it('turns ingestion off for a malformed kill switch', () => {
    const resolved = resolveInboundAttachmentsConfig({ INBOX_OPS_ATTACHMENTS_ENABLED: 'of' })
    expect(resolved.error).toBeInstanceOf(InboundAttachmentsConfigError)
    expect(resolved.config.enabled).toBe(false)
  })

  it.each([
    ['a lease within four fetch timeouts', { INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS: '30000', INBOX_OPS_ATTACHMENT_LEASE_MS: '120000' }],
    ['a lease above lockDuration', { INBOX_OPS_ATTACHMENT_LEASE_MS: String(INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS + 1) }],
    ['a fetch timeout the default lease cannot cover', { INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS: '600000' }],
    ['a malformed fetch timeout', { INBOX_OPS_ATTACHMENT_FETCH_TIMEOUT_MS: 'soon', INBOX_OPS_ATTACHMENT_LEASE_MS: '200000' }],
  ])('resets the lease and fetch timeout together for %s', (_label, env) => {
    const resolved = resolveInboundAttachmentsConfig(env)
    expect(resolved.error).toBeInstanceOf(InboundAttachmentsConfigError)
    expect(resolved.config.leaseMs).toBe(1_800_000)
    expect(resolved.config.fetchTimeoutMs).toBe(30_000)
    expect(resolved.config.leaseMs).toBeGreaterThan(4 * resolved.config.fetchTimeoutMs)
  })
})
