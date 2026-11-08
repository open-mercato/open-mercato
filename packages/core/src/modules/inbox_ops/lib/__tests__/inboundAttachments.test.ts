/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type {
  AttachmentPersistLink,
  CreatedScopedAttachment,
  CreateScopedAttachmentInput,
} from '@open-mercato/core/modules/attachments'
import { sanitizeUploadedFileName } from '@open-mercato/core/modules/attachments/lib/security'
import { InboxEmail, InboxEmailAttachment } from '../../data/entities'
import type { ResendInboundAttachment } from '../../data/validators'
import {
  capInboundAttachmentPlans,
  classifyInboundUploadError,
  INBOUND_ATTACHMENT_LEDGER_MAX_ROWS,
  readInboundAttachmentsConfigOrDefaults,
  resetInboundAttachmentConfigReportsForTests,
  fallbackInboundFileName,
  inboundAttachmentPartKey,
  isDecorativeInboundPart,
  nonDecorativeInboundAttachmentIds,
  persistInboundPart,
  planInboundAttachmentParts,
  truncateInboundAttachmentText,
  type InboundAttachmentLimits,
  type PersistInboundPartInput,
} from '../inboundAttachments'
import { readResendInboundAttachments, resolveInboundAttachmentIntake } from '../inboundAttachmentWebhook'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const EMAIL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PART_ROW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ATTACHMENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CLAIM_TOKEN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const MIB = 1024 * 1024

const limits: InboundAttachmentLimits = {
  maxAttachments: 20,
  maxFileBytes: 25 * MIB,
  maxTotalBytes: 25 * MIB,
  inlineImageMinBytes: 16 * 1024,
}

function part(overrides: Partial<ResendInboundAttachment> & { id: string }): ResendInboundAttachment {
  return {
    filename: `${overrides.id}.pdf`,
    size: 1000,
    content_type: 'application/pdf',
    content_id: null,
    content_disposition: 'attachment',
    ...overrides,
  }
}

function logo(id: string): ResendInboundAttachment {
  return part({ id, filename: `${id}.png`, size: 2048, content_type: 'image/png', content_id: `<${id}@mail>`, content_disposition: 'inline' })
}

describe('decoration rule and part keys', () => {
  it('treats only small inline parts with a content id as decorative', () => {
    expect(isDecorativeInboundPart(logo('logo'), limits.inlineImageMinBytes)).toBe(true)
    expect(isDecorativeInboundPart({ ...logo('photo'), size: 16 * 1024 }, limits.inlineImageMinBytes)).toBe(false)
    expect(isDecorativeInboundPart({ ...logo('no-cid'), content_id: null }, limits.inlineImageMinBytes)).toBe(false)
    expect(isDecorativeInboundPart({ ...logo('blank-cid'), content_id: '  ' }, limits.inlineImageMinBytes)).toBe(false)
    expect(isDecorativeInboundPart({ ...logo('upper'), content_disposition: 'INLINE' }, limits.inlineImageMinBytes)).toBe(true)
  })

  it('counts a null disposition as attachment', () => {
    const nullDisposition = { ...logo('null-disposition'), content_disposition: null }
    expect(isDecorativeInboundPart(nullDisposition, limits.inlineImageMinBytes)).toBe(false)
    const [plan] = planInboundAttachmentParts([nullDisposition], limits)
    expect(plan).toMatchObject({ disposition: 'attachment', status: 'pending', reason: null })
  })

  it('keys every part by its Resend attachment id', () => {
    expect(inboundAttachmentPartKey('att_123')).toBe('resend:att_123')
  })
})

describe('planInboundAttachmentParts', () => {
  it('applies decoration before the count limit (21 parts, logos first)', () => {
    const parts = [logo('logo-1'), ...Array.from({ length: 20 }, (_, index) => part({ id: `file-${index + 1}` }))]
    const plans = planInboundAttachmentParts(parts, limits)

    expect(plans).toHaveLength(21)
    expect(plans[0]).toMatchObject({ partKey: 'resend:logo-1', status: 'skipped', reason: 'inline_decoration', disposition: 'inline' })
    expect(plans.slice(1).every((plan) => plan.status === 'pending' && plan.reason === null)).toBe(true)
  })

  it('skips parts past the count limit with too_many', () => {
    const parts = [logo('logo-1'), logo('logo-2'), ...Array.from({ length: 21 }, (_, index) => part({ id: `file-${index + 1}` }))]
    const plans = planInboundAttachmentParts(parts, limits)

    expect(plans.filter((plan) => plan.reason === 'inline_decoration')).toHaveLength(2)
    expect(plans.filter((plan) => plan.status === 'pending')).toHaveLength(20)
    expect(plans[plans.length - 1]).toMatchObject({ providerAttachmentId: 'file-21', status: 'skipped', reason: 'too_many' })
  })

  it('applies the per-file limit after the count and the total limit last', () => {
    const plans = planInboundAttachmentParts(
      [
        part({ id: 'huge', size: 25 * MIB + 1 }),
        part({ id: 'big', size: 20 * MIB }),
        part({ id: 'overflow', size: 6 * MIB }),
        part({ id: 'small', size: 5 * MIB }),
      ],
      limits,
    )

    expect(plans.map((plan) => [plan.providerAttachmentId, plan.status, plan.reason])).toEqual([
      ['huge', 'skipped', 'too_large'],
      ['big', 'pending', null],
      ['overflow', 'skipped', 'total_too_large'],
      ['small', 'pending', null],
    ])
  })

  it('lets an oversized part use up a count slot, as the order count → per-file requires', () => {
    const plans = planInboundAttachmentParts(
      [part({ id: 'huge', size: 30 * MIB }), part({ id: 'second' })],
      { ...limits, maxAttachments: 1 },
    )
    expect(plans.map((plan) => plan.reason)).toEqual(['too_large', 'too_many'])
  })

  it('names a nameless part attachment-<n> with an extension from its content type', () => {
    const plans = planInboundAttachmentParts(
      [
        part({ id: 'named' }),
        part({ id: 'nameless-pdf', filename: null, content_type: 'application/pdf; name=x' }),
        part({ id: 'blank-name', filename: '   ', content_type: 'IMAGE/JPEG' }),
        part({ id: 'unknown-type', filename: null, content_type: 'application/x-unknown' }),
        part({ id: 'forwarded', filename: undefined, content_type: 'message/rfc822' }),
      ],
      limits,
    )

    expect(plans.map((plan) => plan.fileName)).toEqual([
      'named.pdf',
      'attachment-2.pdf',
      'attachment-3.jpg',
      'attachment-4.bin',
      'attachment-5.eml',
    ])
    expect(plans[1].declaredMimeType).toBe('application/pdf')
    expect(plans[2].declaredMimeType).toBe('image/jpeg')
    expect(fallbackInboundFileName(7, null)).toBe('attachment-7.bin')
  })

  it('keeps a non-ASCII file name verbatim for the encrypted ledger', () => {
    const [plan] = planInboundAttachmentParts([part({ id: 'pl', filename: 'Zamówienie żółć №5.pdf' })], limits)
    expect(plan.fileName).toBe('Zamówienie żółć №5.pdf')
  })

  it('plans a repeated provider id once', () => {
    const plans = planInboundAttachmentParts([part({ id: 'dup' }), part({ id: 'dup' })], limits)
    expect(plans).toHaveLength(1)
  })

  it('plans a part of unknown size pending, reserving the per-file maximum after the parts of known size', () => {
    const small = { ...limits, maxFileBytes: 10 * MIB, maxTotalBytes: 25 * MIB }
    const plans = planInboundAttachmentParts(
      [
        part({ id: 'unknown-1', size: null }),
        part({ id: 'known', size: 4 * MIB }),
        part({ id: 'unknown-2', size: null }),
        part({ id: 'unknown-3', size: null }),
        { ...logo('logo'), size: null },
      ],
      small,
    )
    expect(plans.map((plan) => [plan.providerAttachmentId, plan.status, plan.reason, plan.sizeBytes])).toEqual([
      // 4 MiB known first, then 10 MiB per unknown part while the 25 MiB total admits it.
      ['unknown-1', 'pending', null, null],
      ['known', 'pending', null, 4 * MIB],
      ['unknown-2', 'pending', null, null],
      ['unknown-3', 'skipped', 'total_too_large', null],
      // Without a size, an inline image with a content id is not taken for a decoration.
      ['logo', 'skipped', 'total_too_large', null],
    ])
    expect(isDecorativeInboundPart({ ...logo('logo'), size: null }, limits.inlineImageMinBytes)).toBe(false)
  })
})

describe('nonDecorativeInboundAttachmentIds', () => {
  it('returns every non-decorative id, including parts skipped by a limit', () => {
    const ids = nonDecorativeInboundAttachmentIds(
      [logo('logo'), part({ id: 'b' }), part({ id: 'huge', size: 40 * MIB }), part({ id: 'a' })],
      limits,
    )
    expect(ids).toEqual(['b', 'huge', 'a'])
  })
})

describe('ledger cap', () => {
  it('keeps every pending part and records skipped parts only up to the total cap', () => {
    const parts = [
      ...Array.from({ length: 150 }, (_, index) => logo(`logo-${index}`)),
      ...Array.from({ length: 30 }, (_, index) => part({ id: `doc-${index}` })),
    ]
    const { plans, omittedParts } = capInboundAttachmentPlans(planInboundAttachmentParts(parts, limits))
    expect(plans).toHaveLength(INBOUND_ATTACHMENT_LEDGER_MAX_ROWS)
    expect(plans.filter((plan) => plan.status === 'pending')).toHaveLength(limits.maxAttachments)
    expect(omittedParts).toBe(180 - INBOUND_ATTACHMENT_LEDGER_MAX_ROWS)
    // The planned order (the ledger's created_at order) follows the provider's order.
    const positions = plans.map((plan) => plan.position)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('omits nothing under the cap and still keeps pending parts beyond it', () => {
    const few = planInboundAttachmentParts([part({ id: 'a' }), logo('l')], limits)
    expect(capInboundAttachmentPlans(few)).toEqual({ plans: few, omittedParts: 0 })
    const many = planInboundAttachmentParts(
      Array.from({ length: 8 }, (_, index) => part({ id: `p-${index}` })),
      { ...limits, maxAttachments: 6 },
    )
    const capped = capInboundAttachmentPlans(many, 4)
    expect(capped.plans.map((plan) => plan.status)).toEqual(Array(6).fill('pending'))
    expect(capped.omittedParts).toBe(2)
  })

  it('records the overflow on the intake while the hash input still lists every non-decorative part', () => {
    const parts = [
      ...Array.from({ length: 120 }, (_, index) => part({ id: `doc-${index}` })),
      ...Array.from({ length: 5 }, (_, index) => logo(`logo-${index}`)),
    ]
    const config = { ...limits, enabled: true, allowUnguardedReaders: false, resendStubEnabled: false } as never
    const intake = resolveInboundAttachmentIntake({ parts, attachmentServiceAvailable: true, config, listReaders: () => [] })
    expect(intake.kind).toBe('ingest')
    if (intake.kind !== 'ingest') return
    expect(intake.plans).toHaveLength(INBOUND_ATTACHMENT_LEDGER_MAX_ROWS)
    expect(intake.omittedParts).toBe(25)
    expect(intake.attachmentIds).toEqual(nonDecorativeInboundAttachmentIds(parts, limits))
    expect(intake.attachmentIds).toHaveLength(120)
  })
})

describe('readResendInboundAttachments', () => {
  it('keeps every entry with a valid id, degrading malformed fields to null, and drops entries without one', () => {
    const parts = readResendInboundAttachments([
      { id: 'ok', filename: 'ok.pdf', size: 10, content_type: 'application/pdf', content_id: null, content_disposition: 'attachment' },
      { id: 'odd', filename: 42, size: 'big', content_type: ['x'], content_id: {}, content_disposition: 7 },
      { id: 'negative', size: -1 },
      { id: '  ', size: 10 },
      { filename: 'no-id.pdf', size: 10 },
      'garbage',
    ])
    expect(parts).toEqual([
      { id: 'ok', filename: 'ok.pdf', size: 10, content_type: 'application/pdf', content_id: null, content_disposition: 'attachment' },
      { id: 'odd', filename: null, size: null, content_type: null, content_id: null, content_disposition: null },
      { id: 'negative', size: null },
    ])
  })

  it('degrades a size past the int column to null, so the part is planned with an unknown size', () => {
    const parts = readResendInboundAttachments([
      { id: 'max', filename: 'max.pdf', size: 2_147_483_647 },
      { id: 'huge', filename: 'huge.pdf', size: 2_147_483_648 },
    ])
    expect(parts.map((entry) => [entry.id, entry.size])).toEqual([['max', 2_147_483_647], ['huge', null]])
    const plans = planInboundAttachmentParts(parts, { ...limits, maxTotalBytes: 100 * MIB })
    expect(plans.map((plan) => [plan.providerAttachmentId, plan.sizeBytes, plan.status, plan.reason])).toEqual([
      ['max', 2_147_483_647, 'skipped', 'too_large'],
      ['huge', null, 'pending', null],
    ])
  })

  it('records an entry with a malformed size in the ledger plan and the hash input', () => {
    const parts = readResendInboundAttachments([{ id: 'odd', filename: 'odd.pdf', size: 'big' }])
    const config = { ...limits, enabled: true, allowUnguardedReaders: false, resendStubEnabled: false } as never
    const intake = resolveInboundAttachmentIntake({ parts, attachmentServiceAvailable: true, config, listReaders: () => [] })
    expect(intake).toMatchObject({ kind: 'ingest', attachmentIds: ['odd'] })
    if (intake.kind !== 'ingest') return
    expect(intake.plans).toEqual([expect.objectContaining({ partKey: 'resend:odd', fileName: 'odd.pdf', sizeBytes: null, status: 'pending' })])
  })
})

describe('resolveInboundAttachmentIntake without a part left to fetch', () => {
  it('settles the intake when the webhook skipped every recorded part', () => {
    const config = { ...limits, enabled: true, allowUnguardedReaders: false, resendStubEnabled: false } as never
    const intake = resolveInboundAttachmentIntake({
      parts: [logo('logo'), part({ id: 'huge', size: 40 * MIB })],
      attachmentServiceAvailable: true,
      config,
      listReaders: () => [],
    })
    expect(intake).toMatchObject({ kind: 'settled', attachmentIds: ['huge'], omittedParts: 0 })
    if (intake.kind !== 'settled') return
    expect(intake.plans.map((plan) => [plan.status, plan.reason])).toEqual([['skipped', 'inline_decoration'], ['skipped', 'too_large']])
  })
})

describe('readInboundAttachmentsConfigOrDefaults', () => {
  beforeEach(() => {
    mockReportError.mockReset()
    resetInboundAttachmentConfigReportsForTests()
  })

  it('falls back instead of throwing and reports a malformed environment once', () => {
    const env = { INBOX_OPS_MAX_ATTACHMENTS: 'twenty' }
    expect(readInboundAttachmentsConfigOrDefaults(env).maxAttachments).toBe(20)
    expect(readInboundAttachmentsConfigOrDefaults(env).maxAttachments).toBe(20)
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError.mock.calls[0][1]).toMatchObject({ module: 'inbox_ops', code: 'inbox_ops.attachment_config_invalid' })
  })

  it('reports nothing for a valid environment', () => {
    expect(readInboundAttachmentsConfigOrDefaults({}).enabled).toBe(true)
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('lets the webhook intake resolve under a malformed environment', () => {
    const previous = process.env.INBOX_OPS_ATTACHMENT_LEASE_MS
    process.env.INBOX_OPS_ATTACHMENT_LEASE_MS = '5'
    try {
      const intake = resolveInboundAttachmentIntake({ parts: [part({ id: 'a' })], attachmentServiceAvailable: true, listReaders: () => [] })
      expect(intake.kind).toBe('ingest')
      expect(mockReportError.mock.calls[0][1]).toMatchObject({ code: 'inbox_ops.attachment_config_invalid' })
    } finally {
      if (previous === undefined) delete process.env.INBOX_OPS_ATTACHMENT_LEASE_MS
      else process.env.INBOX_OPS_ATTACHMENT_LEASE_MS = previous
    }
  })
})

describe('truncateInboundAttachmentText', () => {
  it('truncates to the per-file limit and maps empty text to null', () => {
    expect(truncateInboundAttachmentText('abcdef', 4)).toBe('abcd')
    expect(truncateInboundAttachmentText('abc', 4)).toBe('abc')
    expect(truncateInboundAttachmentText('', 4)).toBeNull()
    expect(truncateInboundAttachmentText(null, 4)).toBeNull()
  })

  it('never splits a surrogate pair', () => {
    expect(truncateInboundAttachmentText('ab😀cd', 3)).toBe('ab')
  })
})

describe('classifyInboundUploadError', () => {
  const codeError = (code: string, status = 400) => new CrudHttpError(status, { error: 'translated', code })

  it.each([
    ['dangerous_executable', { kind: 'skipped', reason: 'dangerous_executable' }],
    ['active_content', { kind: 'skipped', reason: 'active_content' }],
    ['max_upload_size', { kind: 'skipped', reason: 'too_large' }],
    ['quota_exceeded', { kind: 'failed', reason: 'quota_exceeded' }],
    ['partition_unavailable', { kind: 'failed', reason: 'partition_unavailable' }],
    ['quota_target_exists', { kind: 'failed', reason: 'store_failed' }],
    ['quota_recovery_unsupported', { kind: 'failed', reason: 'store_failed' }],
    ['quota_unavailable', { kind: 'transient', code: 'quota_unavailable' }],
    ['storage_failed', { kind: 'transient', code: 'storage_failed' }],
    ['persistence_failed', { kind: 'transient', code: 'persistence_failed' }],
    ['inbox_claim_lost', { kind: 'aborted', code: 'inbox_claim_lost' }],
    ['inbox_part_already_stored', { kind: 'already_stored' }],
  ])('maps %s', (code, expected) => {
    expect(classifyInboundUploadError(codeError(code))).toEqual(expected)
  })

  it('treats errors without a code as transient', () => {
    expect(classifyInboundUploadError(new CrudHttpError(500, { error: 'The attachment upload service is not available.' })))
      .toEqual({ kind: 'transient', code: 'unknown' })
    expect(classifyInboundUploadError(new Error('boom'))).toEqual({ kind: 'transient', code: 'unknown' })
  })
})

type NativeUpdateCall = { entity: unknown; where: Record<string, unknown>; data: Record<string, unknown> }

function createHarness(options: {
  claimRows?: number
  partRows?: number
  extractedText?: string | null
  uploadError?: unknown
  persistedMimeType?: string
} = {}) {
  const nativeUpdates: NativeUpdateCall[] = []
  const tx = {
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
      nativeUpdates.push({ entity, where, data })
      if (entity === InboxEmail) return options.claimRows ?? 1
      if (entity === InboxEmailAttachment) return options.partRows ?? 1
      return 0
    }),
  } as unknown as EntityManager
  let committed = false
  const createScoped = jest.fn(async (input: CreateScopedAttachmentInput): Promise<CreatedScopedAttachment> => {
    if (options.uploadError) throw options.uploadError
    const persistLink = input.persistLink as AttachmentPersistLink
    const content = options.extractedText === undefined ? 'extracted text' : options.extractedText
    await persistLink(tx, ATTACHMENT_ID, input.textExtraction === 'return' ? { content } : undefined)
    committed = true
    return {
      id: ATTACHMENT_ID,
      url: `/api/attachments/file/${ATTACHMENT_ID}`,
      fileName: sanitizeUploadedFileName(input.fileName),
      mimeType: options.persistedMimeType ?? 'application/pdf',
      fileSize: input.buffer.length,
      ...(input.textExtraction === 'return' ? { content } : {}),
    }
  })
  const encryptEntityPayload = jest.fn(async (_entityId: string, payload: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...payload }
    if (typeof payload.extractedText === 'string') out.extractedText = `enc:v1:${Buffer.from(payload.extractedText).toString('base64')}`
    return out
  })
  const baseInput: PersistInboundPartInput = {
    attachmentService: { createScoped },
    encryptionService: { encryptEntityPayload },
    email: { id: EMAIL_ID, tenantId: TENANT, organizationId: ORG },
    claimToken: CLAIM_TOKEN,
    part: { id: PART_ROW_ID, status: 'pending', fileName: 'offer.pdf', declaredMimeType: 'application/pdf', position: 1 },
    buffer: Buffer.from('%PDF-1.7 test'),
    config: { maxFileBytes: 25 * MIB, maxTextCharsPerFile: 20_000 },
    now: () => new Date('2026-11-08T12:00:00.000Z'),
  }
  return { tx, nativeUpdates, createScoped, encryptEntityPayload, baseInput, isCommitted: () => committed }
}

describe('persistInboundPart', () => {
  it('stores the part under the email in the private partition and marks the ledger row', async () => {
    const harness = createHarness()
    const outcome = await persistInboundPart(harness.baseInput)

    expect(outcome).toEqual({ kind: 'stored', alreadyStored: false, attachmentId: ATTACHMENT_ID, mimeType: 'application/pdf', fileSize: 13 })
    expect(harness.createScoped).toHaveBeenCalledTimes(1)
    const input = harness.createScoped.mock.calls[0][0]
    expect(input).toMatchObject({
      entityId: 'inbox_ops:inbox_email',
      recordId: EMAIL_ID,
      tenantId: TENANT,
      organizationId: ORG,
      partitionCode: 'privateAttachments',
      fileName: 'offer.pdf',
      declaredMimeType: 'application/pdf',
      textExtraction: 'return',
    })
    expect(input.assignments).toBeUndefined()

    const [claim, mark] = harness.nativeUpdates
    expect(claim.entity).toBe(InboxEmail)
    expect(claim.where).toEqual({ id: EMAIL_ID, tenantId: TENANT, organizationId: ORG, attachmentsClaimToken: CLAIM_TOKEN, deletedAt: null })
    expect(claim.data).toEqual({ attachmentsClaimedAt: new Date('2026-11-08T12:00:00.000Z') })
    expect(mark.entity).toBe(InboxEmailAttachment)
    expect(mark.where).toEqual({ id: PART_ROW_ID, inboxEmailId: EMAIL_ID, tenantId: TENANT, organizationId: ORG, status: { $ne: 'stored' } })
    expect(mark.data).toMatchObject({ status: 'stored', reason: null, attachmentId: ATTACHMENT_ID })
  })

  it('stores extracted text as ciphertext, truncated to the per-file limit', async () => {
    const longText = 'x'.repeat(25_000)
    const harness = createHarness({ extractedText: longText })
    await persistInboundPart(harness.baseInput)

    expect(harness.encryptEntityPayload).toHaveBeenCalledWith(
      'inbox_ops:inbox_email_attachment',
      { extractedText: 'x'.repeat(20_000) },
      TENANT,
      ORG,
    )
    const mark = harness.nativeUpdates.find((call) => call.entity === InboxEmailAttachment)
    const stored = mark?.data.extractedText
    expect(typeof stored).toBe('string')
    expect(stored).not.toContain('xxxx')
    expect(Buffer.from(String(stored).replace('enc:v1:', ''), 'base64').toString()).toBe('x'.repeat(20_000))
  })

  it('passes text extraction "none" through and stores no text', async () => {
    const harness = createHarness()
    await persistInboundPart({ ...harness.baseInput, textExtraction: 'none' })

    expect(harness.createScoped.mock.calls[0][0].textExtraction).toBe('none')
    expect(harness.encryptEntityPayload).toHaveBeenCalledWith('inbox_ops:inbox_email_attachment', { extractedText: null }, TENANT, ORG)
    expect(harness.nativeUpdates.find((call) => call.entity === InboxEmailAttachment)?.data.extractedText).toBeNull()
  })

  it('uploads a nameless part under its fallback name and a non-ASCII name for the module to sanitize', async () => {
    const nameless = createHarness()
    await persistInboundPart({
      ...nameless.baseInput,
      part: { id: PART_ROW_ID, status: 'pending', fileName: null, declaredMimeType: 'application/pdf', position: 3 },
    })
    expect(nameless.createScoped.mock.calls[0][0].fileName).toBe('attachment-3.pdf')

    const nonAscii = createHarness()
    const outcome = await persistInboundPart({
      ...nonAscii.baseInput,
      part: { id: PART_ROW_ID, status: 'pending', fileName: 'Zamówienie żółć.pdf', declaredMimeType: 'application/pdf' },
    })
    expect(nonAscii.createScoped.mock.calls[0][0].fileName).toBe('Zamówienie żółć.pdf')
    expect(outcome.kind).toBe('stored')
    const stored = await nonAscii.createScoped.mock.results[0].value
    expect(stored.fileName).toMatch(/^[\x20-\x7e]+$/)
  })

  it('stores a forwarded message as an .eml file', async () => {
    const harness = createHarness()
    await persistInboundPart({
      ...harness.baseInput,
      part: { id: PART_ROW_ID, status: 'pending', fileName: 'Fwd: order', declaredMimeType: 'message/rfc822' },
    })
    expect(harness.createScoped.mock.calls[0][0].fileName).toBe('Fwd: order.eml')
  })

  it('skips an executable part without failing the email', async () => {
    const harness = createHarness({ uploadError: new CrudHttpError(400, { error: 'Executable file types are not allowed as attachments.', code: 'dangerous_executable' }) })
    await expect(persistInboundPart({
      ...harness.baseInput,
      part: { id: PART_ROW_ID, status: 'pending', fileName: 'invoice.pdf.exe', declaredMimeType: 'application/octet-stream' },
    })).resolves.toEqual({ kind: 'skipped', reason: 'dangerous_executable' })
  })

  it('skips an oversized download before uploading it', async () => {
    const harness = createHarness()
    const outcome = await persistInboundPart({ ...harness.baseInput, config: { maxFileBytes: 4, maxTextCharsPerFile: 20_000 } })
    expect(outcome).toEqual({ kind: 'skipped', reason: 'too_large' })
    expect(harness.createScoped).not.toHaveBeenCalled()
  })

  it('maps max_upload_size from the attachments module to too_large', async () => {
    const harness = createHarness({ uploadError: new CrudHttpError(413, { error: 'too big', code: 'max_upload_size' }) })
    await expect(persistInboundPart(harness.baseInput)).resolves.toEqual({ kind: 'skipped', reason: 'too_large' })
  })

  it('keeps the email when the quota is exceeded (failed/quota_exceeded, no throw)', async () => {
    const harness = createHarness({ uploadError: new CrudHttpError(413, { error: 'Attachment storage quota exceeded for this tenant.', code: 'quota_exceeded' }) })
    await expect(persistInboundPart(harness.baseInput)).resolves.toEqual({ kind: 'failed', reason: 'quota_exceeded' })
  })

  it('treats inbox_part_already_stored as stored and rolls the duplicate back', async () => {
    const harness = createHarness({ partRows: 0 })
    await expect(persistInboundPart(harness.baseInput)).resolves.toEqual({ kind: 'stored', alreadyStored: true })
    expect(harness.isCommitted()).toBe(false)
  })

  it('aborts when the claim is lost and never marks the part', async () => {
    const harness = createHarness({ claimRows: 0 })
    await expect(persistInboundPart(harness.baseInput)).resolves.toEqual({ kind: 'aborted', code: 'inbox_claim_lost' })
    expect(harness.nativeUpdates.filter((call) => call.entity === InboxEmailAttachment)).toHaveLength(0)
    expect(harness.isCommitted()).toBe(false)
  })

  it('returns transient outcomes for retryable upload failures', async () => {
    const storage = createHarness({ uploadError: new CrudHttpError(500, { error: 'x', code: 'storage_failed' }) })
    await expect(persistInboundPart(storage.baseInput)).resolves.toMatchObject({ kind: 'transient', code: 'storage_failed' })

    const unavailable = createHarness({ uploadError: new CrudHttpError(500, { error: 'The attachment upload service is not available.' }) })
    await expect(persistInboundPart(unavailable.baseInput)).resolves.toMatchObject({ kind: 'transient', code: 'unknown' })
  })

  it('does not upload a part whose row is already stored', async () => {
    const harness = createHarness()
    const outcome = await persistInboundPart({ ...harness.baseInput, part: { ...harness.baseInput.part, status: 'stored' } })
    expect(outcome).toEqual({ kind: 'stored', alreadyStored: true })
    expect(harness.createScoped).not.toHaveBeenCalled()
  })
})
