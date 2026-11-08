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
  classifyInboundUploadError,
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
