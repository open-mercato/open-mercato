/**
 * PDF snapshot service — W3 (CN-5 / CN-6 / DP-11; revives deferred phase 2b).
 *
 * Produces an immutable, exportable PDF that reproduces exactly what the
 * participant saw and signed, suitable for legal retention. The snapshot is
 * built ONCE — at submit time (via the `forms.submission.submitted` subscriber)
 * or lazily on first download — and stored as an encrypted `FormAttachment`
 * (`kind = 'snapshot'`). `FormSubmission.pdfSnapshotAttachmentId` links it.
 *
 * Idempotency: when `pdfSnapshotAttachmentId` is already set, the existing
 * attachment is returned and NO regeneration occurs (submissions are immutable
 * post-submit).
 *
 * Encryption-at-rest: snapshot bytes are wrapped with the per-tenant
 * `EncryptionService` — identical posture to user uploads (DP-1). The stored
 * `content_type` / `filename` / `size_bytes` are recorded verbatim.
 *
 * The renderer is split in two:
 *   - `buildSnapshotDocument(...)` — a PURE function that produces the
 *     rendering-engine-agnostic document model (form name, version, sections,
 *     field labels + human-readable answers, signature evidence, audit block).
 *     This is what the unit tests assert against.
 *   - `renderDocumentToPdf(...)` — lays the model out with `pdf-lib`
 *     (pure-JS, no native deps) and embeds any drawn signature PNG.
 */

import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'
import {
  Form,
  FormAttachment,
  FormSubmission,
  FormSubmissionRevision,
  FormVersion,
} from '../data/entities'
import type { EncryptionService } from './encryption-service'
import {
  defaultFieldTypeRegistry,
  type FieldTypeRegistry,
  type FieldNode,
} from '../schema/field-type-registry'
import { SIGNATURE_TYPE_KEY, type SignatureValue } from '../schema/signature-field'

type Scope = {
  organizationId: string
  tenantId: string
}

export type PdfSnapshotServiceErrorCode = 'NOT_FOUND' | 'NOT_SUBMITTED'

export class PdfSnapshotServiceError extends Error {
  readonly code: PdfSnapshotServiceErrorCode
  readonly httpStatus: number

  constructor(code: PdfSnapshotServiceErrorCode, message: string, httpStatus: number) {
    super(message)
    this.name = 'PdfSnapshotServiceError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

/** One rendered question/answer pair inside a section. */
export type SnapshotField = {
  key: string
  label: string
  type: string
  answer: string
  /** Signature evidence — present only for `signature`-typed fields. */
  signature?: SnapshotSignature
}

export type SnapshotSignature = {
  mode: 'drawn' | 'typed'
  typedName: string | null
  /** PNG data URL for drawn mode (decoded + embedded by the renderer). */
  imageDataUrl: string | null
  clauseText: string | null
  clauseSha256: string
  signedAt: string
}

export type SnapshotSection = {
  key: string
  title: string
  fields: SnapshotField[]
}

export type SnapshotAuditBlock = {
  submissionId: string
  submittedBy: string | null
  submittedAtUtc: string | null
  ip: string | null
  userAgent: string | null
  formVersionId: string
  schemaHash: string
  organizationId: string
}

/** Rendering-engine-agnostic snapshot model — the unit-tested contract. */
export type SnapshotDocument = {
  formName: string
  versionNumber: number
  locale: string
  sections: SnapshotSection[]
  audit: SnapshotAuditBlock
}

export type StoredSnapshot = {
  attachmentId: string
  filename: string
  contentType: string
  sizeBytes: number
  bytes: Buffer
}

export type PdfSnapshotServiceOptions = {
  emFactory: () => EntityManager
  encryptionService: EncryptionService
  registry?: FieldTypeRegistry
  emitEvent?: (
    eventId: 'forms.attachment.uploaded',
    payload: { attachmentId: string; submissionId: string },
  ) => Promise<void> | void
}

const SNAPSHOT_FIELD_KEY = '__snapshot__'
const SNAPSHOT_CONTENT_TYPE = 'application/pdf'

export class PdfSnapshotService {
  private readonly emFactory: () => EntityManager
  private readonly encryption: EncryptionService
  private readonly registry: FieldTypeRegistry
  private readonly emitEvent?: PdfSnapshotServiceOptions['emitEvent']

  constructor(options: PdfSnapshotServiceOptions) {
    this.emFactory = options.emFactory
    this.encryption = options.encryptionService
    this.registry = options.registry ?? defaultFieldTypeRegistry
    this.emitEvent = options.emitEvent
  }

  /**
   * Ensures a snapshot exists for the submission and returns the decrypted
   * bytes. Idempotent: if `pdfSnapshotAttachmentId` is already set, the stored
   * snapshot is returned verbatim (never re-rendered). Otherwise the snapshot
   * is built, encrypted, persisted, linked, and `forms.attachment.uploaded` is
   * emitted.
   */
  async ensureSnapshot(args: Scope & { submissionId: string }): Promise<StoredSnapshot> {
    const em = this.emFactory()
    const submission = await em.findOne(FormSubmission, {
      id: args.submissionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
    })
    if (!submission) {
      throw new PdfSnapshotServiceError('NOT_FOUND', 'Submission not found.', 404)
    }
    if (submission.status !== 'submitted') {
      throw new PdfSnapshotServiceError('NOT_SUBMITTED', 'Submission is not submitted.', 409)
    }

    if (submission.pdfSnapshotAttachmentId) {
      const existing = await this.readStored(em, args, submission.pdfSnapshotAttachmentId)
      if (existing) return existing
      // Linked attachment row vanished — treat as unset and regenerate.
    }

    const built = await this.buildAndStore(em, args, submission)
    return built
  }

  /**
   * Reads + decrypts an already-generated snapshot. Returns null when no
   * snapshot exists (caller decides whether to generate). Cross-tenant ids and
   * removed rows resolve to null (no enumeration signal).
   */
  async readSnapshot(args: Scope & { submissionId: string }): Promise<StoredSnapshot | null> {
    const em = this.emFactory()
    const submission = await em.findOne(FormSubmission, {
      id: args.submissionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
      deletedAt: null,
    })
    if (!submission || !submission.pdfSnapshotAttachmentId) return null
    return this.readStored(em, args, submission.pdfSnapshotAttachmentId)
  }

  private async readStored(
    em: EntityManager,
    args: Scope,
    attachmentId: string,
  ): Promise<StoredSnapshot | null> {
    const attachment = await em.findOne(FormAttachment, {
      id: attachmentId,
      organizationId: args.organizationId,
      kind: 'snapshot',
      removedAt: null,
    })
    if (!attachment || !attachment.payloadInline) return null
    const ciphertext = Buffer.isBuffer(attachment.payloadInline)
      ? attachment.payloadInline
      : Buffer.from(attachment.payloadInline as Uint8Array)
    const bytes = await this.encryption.decrypt(args.organizationId, ciphertext)
    return {
      attachmentId: attachment.id,
      filename: attachment.filename ?? `submission-${attachment.submissionId}.pdf`,
      contentType: attachment.contentType ?? SNAPSHOT_CONTENT_TYPE,
      sizeBytes: attachment.sizeBytes ?? bytes.length,
      bytes,
    }
  }

  private async buildAndStore(
    em: EntityManager,
    args: Scope & { submissionId: string },
    submission: FormSubmission,
  ): Promise<StoredSnapshot> {
    const formVersion = await em.findOne(FormVersion, {
      id: submission.formVersionId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
    })
    if (!formVersion) {
      throw new PdfSnapshotServiceError('NOT_FOUND', 'Form version not found.', 404)
    }
    const form = await em.findOne(Form, {
      id: formVersion.formId,
      organizationId: args.organizationId,
      tenantId: args.tenantId,
    })
    const revision = submission.currentRevisionId
      ? await em.findOne(FormSubmissionRevision, {
          id: submission.currentRevisionId,
          submissionId: submission.id,
          organizationId: args.organizationId,
        })
      : null
    if (!revision) {
      throw new PdfSnapshotServiceError('NOT_FOUND', 'Current revision not found.', 404)
    }
    const answers = await this.decodeRevision(args.organizationId, revision)

    const document = buildSnapshotDocument({
      form,
      formVersion,
      submission,
      answers,
      registry: this.registry,
    })
    const bytes = await renderDocumentToPdf(document)

    const filename = `submission-${submission.id}-v${formVersion.versionNumber}.pdf`
    const ciphertext = await this.encryption.encrypt(args.organizationId, bytes)
    const attachmentId = randomUUID()
    const attachment = em.create(FormAttachment, {
      id: attachmentId,
      submissionId: submission.id,
      organizationId: args.organizationId,
      fieldKey: SNAPSHOT_FIELD_KEY,
      kind: 'snapshot',
      payloadInline: ciphertext,
      contentType: SNAPSHOT_CONTENT_TYPE,
      filename,
      sizeBytes: bytes.length,
      uploadedBy: submission.submittedBy ?? null,
      uploadedAt: new Date(),
    })
    em.persist(attachment)
    submission.pdfSnapshotAttachmentId = attachmentId
    await em.flush()

    if (this.emitEvent) {
      await this.emitEvent('forms.attachment.uploaded', {
        attachmentId,
        submissionId: submission.id,
      })
    }

    return {
      attachmentId,
      filename,
      contentType: SNAPSHOT_CONTENT_TYPE,
      sizeBytes: bytes.length,
      bytes,
    }
  }

  private async decodeRevision(
    organizationId: string,
    revision: FormSubmissionRevision,
  ): Promise<Record<string, unknown>> {
    const ciphertext = Buffer.isBuffer(revision.data)
      ? revision.data
      : Buffer.from(revision.data as unknown as Uint8Array)
    if (ciphertext.length === 0) return {}
    const plain = await this.encryption.decrypt(organizationId, ciphertext)
    if (plain.length === 0) return {}
    try {
      const parsed: unknown = JSON.parse(plain.toString('utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
}

// ============================================================================
// Document model builder (pure — unit-tested)
// ============================================================================

export type BuildSnapshotDocumentArgs = {
  form: Form | null
  formVersion: FormVersion
  submission: FormSubmission
  answers: Record<string, unknown>
  registry?: FieldTypeRegistry
}

type SchemaSection = {
  key: string
  title: Record<string, string> | undefined
  fieldKeys: string[]
}

/**
 * Builds the rendering-engine-agnostic snapshot model from the version-pinned
 * schema + decrypted answers + submit metadata. Field order follows the form's
 * `x-om-sections` declaration order; un-sectioned properties are appended in
 * `properties` order under a synthetic section so nothing is dropped.
 */
export function buildSnapshotDocument(args: BuildSnapshotDocumentArgs): SnapshotDocument {
  const { formVersion, submission, answers } = args
  const registry = args.registry ?? defaultFieldTypeRegistry
  const schema = (formVersion.schema ?? {}) as Record<string, unknown>
  const locale = resolveDefaultLocale(args.form, schema)
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const sections = readSchemaSections(schema)

  const seen = new Set<string>()
  const renderedSections: SnapshotSection[] = []

  for (const section of sections) {
    const fields: SnapshotField[] = []
    for (const fieldKey of section.fieldKeys) {
      seen.add(fieldKey)
      const node = isRecord(properties[fieldKey]) ? (properties[fieldKey] as FieldNode) : null
      if (!node) continue
      const field = buildSnapshotField(fieldKey, node, answers[fieldKey], locale, registry)
      if (field) fields.push(field)
    }
    if (fields.length > 0) {
      renderedSections.push({
        key: section.key,
        title: resolveLocalized(section.title, locale) || section.key,
        fields,
      })
    }
  }

  const leftover: SnapshotField[] = []
  for (const fieldKey of Object.keys(properties)) {
    if (seen.has(fieldKey)) continue
    const node = isRecord(properties[fieldKey]) ? (properties[fieldKey] as FieldNode) : null
    if (!node) continue
    const field = buildSnapshotField(fieldKey, node, answers[fieldKey], locale, registry)
    if (field) leftover.push(field)
  }
  if (leftover.length > 0) {
    renderedSections.push({ key: '__fields__', title: '', fields: leftover })
  }

  return {
    formName: args.form?.name ?? schemaTitle(schema) ?? 'Form',
    versionNumber: formVersion.versionNumber,
    locale,
    sections: renderedSections,
    audit: buildAuditBlock(submission, formVersion),
  }
}

function buildSnapshotField(
  fieldKey: string,
  node: FieldNode,
  rawValue: unknown,
  locale: string,
  registry: FieldTypeRegistry,
): SnapshotField | null {
  const type = typeof node['x-om-type'] === 'string' ? (node['x-om-type'] as string) : 'text'
  const spec = registry.get(type)
  if (spec?.category === 'layout') return null
  const label = resolveLocalized(node['x-om-label'] as Record<string, string> | undefined, locale) || fieldKey

  if (type === SIGNATURE_TYPE_KEY) {
    return {
      key: fieldKey,
      label,
      type,
      answer: spec ? spec.exportAdapter(rawValue, node) : '',
      signature: buildSignatureEvidence(node, rawValue, locale),
    }
  }

  const answer = spec ? spec.exportAdapter(rawValue, node) : stringifyFallback(rawValue)
  return { key: fieldKey, label, type, answer }
}

function buildSignatureEvidence(
  node: FieldNode,
  rawValue: unknown,
  locale: string,
): SnapshotSignature | undefined {
  if (!isRecord(rawValue)) return undefined
  const value = rawValue as Partial<SignatureValue>
  if (value.mode !== 'drawn' && value.mode !== 'typed') return undefined
  const clause = resolveLocalized(
    node['x-om-consent-clause'] as Record<string, string> | undefined,
    locale,
  )
  return {
    mode: value.mode,
    typedName: typeof value.typedName === 'string' ? value.typedName : null,
    imageDataUrl: typeof value.image === 'string' && value.image.length > 0 ? value.image : null,
    clauseText: clause.length > 0 ? clause : null,
    clauseSha256: typeof value.clauseSha256 === 'string' ? value.clauseSha256 : '',
    signedAt: typeof value.signedAt === 'string' ? value.signedAt : '',
  }
}

function buildAuditBlock(submission: FormSubmission, formVersion: FormVersion): SnapshotAuditBlock {
  const metadata = isRecord(submission.submitMetadata) ? submission.submitMetadata : {}
  const submittedAtUtc = submission.submittedAt
    ? submission.submittedAt.toISOString()
    : readString(metadata.serverSubmittedAt)
  return {
    submissionId: submission.id,
    submittedBy: submission.submittedBy ?? null,
    submittedAtUtc: submittedAtUtc ?? null,
    ip: readString(metadata.ip),
    userAgent: readString(metadata.userAgent),
    formVersionId: formVersion.id,
    schemaHash: formVersion.schemaHash,
    organizationId: submission.organizationId,
  }
}

// ============================================================================
// pdf-lib renderer
// ============================================================================

const PAGE_WIDTH = 595.28 // A4 portrait
const PAGE_HEIGHT = 841.89
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

type RenderCursor = {
  doc: PDFDocument
  page: PDFPage
  y: number
  font: PDFFont
  bold: PDFFont
  /** Pre-embedded drawn-signature images keyed by their data URL. */
  images: Map<string, PDFImage>
}

export async function renderDocumentToPdf(document: SnapshotDocument): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const images = await embedSignatureImages(doc, document)
  const cursor: RenderCursor = { doc, page: addPage(doc), y: PAGE_HEIGHT - MARGIN, font, bold, images }

  drawText(cursor, document.formName, { size: 18, font: bold })
  drawText(cursor, `Version ${document.versionNumber}`, { size: 10, color: rgb(0.4, 0.4, 0.4) })
  drawText(cursor, `Organization ${document.audit.organizationId}`, {
    size: 9,
    color: rgb(0.4, 0.4, 0.4),
  })
  advance(cursor, 8)

  for (const section of document.sections) {
    ensureSpace(cursor, 60)
    if (section.title) {
      drawDivider(cursor)
      drawText(cursor, section.title, { size: 13, font: bold })
      advance(cursor, 2)
    }
    for (const field of section.fields) {
      renderField(cursor, field)
    }
    advance(cursor, 6)
  }

  drawDivider(cursor)
  drawText(cursor, 'Audit', { size: 13, font: bold })
  advance(cursor, 2)
  renderAuditLine(cursor, 'Submission ID', document.audit.submissionId)
  renderAuditLine(cursor, 'Submitted by', document.audit.submittedBy ?? '—')
  renderAuditLine(cursor, 'Submitted at (UTC)', document.audit.submittedAtUtc ?? '—')
  renderAuditLine(cursor, 'IP address', document.audit.ip ?? '—')
  renderAuditLine(cursor, 'User agent', document.audit.userAgent ?? '—')
  renderAuditLine(cursor, 'Form version ID', document.audit.formVersionId)
  renderAuditLine(cursor, 'Schema hash', document.audit.schemaHash)

  const saved = await doc.save()
  return Buffer.from(saved)
}

function renderField(cursor: RenderCursor, field: SnapshotField): void {
  ensureSpace(cursor, 40)
  drawText(cursor, field.label, { size: 10, font: cursor.bold })
  if (field.signature) {
    renderSignature(cursor, field.signature)
    return
  }
  const answer = field.answer.trim().length > 0 ? field.answer : '—'
  drawText(cursor, answer, { size: 10 })
  advance(cursor, 4)
}

function renderSignature(cursor: RenderCursor, signature: SnapshotSignature): void {
  if (signature.clauseText) {
    drawText(cursor, signature.clauseText, { size: 9, color: rgb(0.3, 0.3, 0.3) })
  }
  if (signature.mode === 'drawn' && signature.imageDataUrl) {
    const embedded = cursor.images.get(signature.imageDataUrl)
    if (embedded) {
      const maxWidth = 220
      const scaled = embedded.scaleToFit(maxWidth, 90)
      ensureSpace(cursor, scaled.height + 8)
      cursor.page.drawImage(embedded, {
        x: MARGIN,
        y: cursor.y - scaled.height,
        width: scaled.width,
        height: scaled.height,
      })
      cursor.y -= scaled.height + 4
    } else {
      drawText(cursor, '[signature image]', { size: 9, color: rgb(0.4, 0.4, 0.4) })
    }
  } else {
    drawText(cursor, `Signed (typed): ${signature.typedName ?? ''}`, { size: 10 })
  }
  drawText(cursor, `Signed at: ${signature.signedAt || '—'}`, {
    size: 8,
    color: rgb(0.4, 0.4, 0.4),
  })
  drawText(cursor, `Clause SHA-256: ${signature.clauseSha256 || '—'}`, {
    size: 8,
    color: rgb(0.4, 0.4, 0.4),
  })
  advance(cursor, 6)
}

/**
 * Pre-embeds every drawn-signature image so the synchronous layout pass can
 * place them by data-URL lookup. Undecodable / unsupported images are skipped
 * (the renderer falls back to a `[signature image]` placeholder) so a malformed
 * data URL can never fail the whole snapshot.
 */
async function embedSignatureImages(
  doc: PDFDocument,
  document: SnapshotDocument,
): Promise<Map<string, PDFImage>> {
  const images = new Map<string, PDFImage>()
  for (const section of document.sections) {
    for (const field of section.fields) {
      const dataUrl = field.signature?.imageDataUrl
      if (!dataUrl || images.has(dataUrl)) continue
      const embedded = await embedSignatureImage(doc, dataUrl)
      if (embedded) images.set(dataUrl, embedded)
    }
  }
  return images
}

async function embedSignatureImage(doc: PDFDocument, dataUrl: string): Promise<PDFImage | null> {
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) return null
  const kind = match[1].toLowerCase()
  let bytes: Buffer
  try {
    bytes = Buffer.from(match[2], 'base64')
  } catch {
    return null
  }
  try {
    return kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch {
    return null
  }
}

function renderAuditLine(cursor: RenderCursor, label: string, value: string): void {
  ensureSpace(cursor, 16)
  drawText(cursor, `${label}: ${value}`, { size: 9, color: rgb(0.25, 0.25, 0.25) })
}

type DrawOptions = {
  size: number
  font?: PDFFont
  color?: ReturnType<typeof rgb>
}

function drawText(cursor: RenderCursor, text: string, options: DrawOptions): void {
  const font = options.font ?? cursor.font
  const lines = wrapText(text, font, options.size, CONTENT_WIDTH)
  const lineHeight = options.size + 4
  for (const line of lines) {
    ensureSpace(cursor, lineHeight)
    cursor.page.drawText(line, {
      x: MARGIN,
      y: cursor.y - options.size,
      size: options.size,
      font,
      color: options.color ?? rgb(0.1, 0.1, 0.1),
    })
    cursor.y -= lineHeight
  }
}

function drawDivider(cursor: RenderCursor): void {
  ensureSpace(cursor, 12)
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: PAGE_WIDTH - MARGIN, y: cursor.y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  })
  cursor.y -= 10
}

function advance(cursor: RenderCursor, amount: number): void {
  cursor.y -= amount
}

function ensureSpace(cursor: RenderCursor, needed: number): void {
  if (cursor.y - needed < MARGIN) {
    cursor.page = addPage(cursor.doc)
    cursor.y = PAGE_HEIGHT - MARGIN
  }
}

function addPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
}

/**
 * Greedy word-wrap. Falls back to hard character splitting for tokens wider
 * than the content width (e.g. long hashes / user agents) so nothing overflows.
 */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const sanitized = sanitizeForWinAnsi(text)
  const result: string[] = []
  for (const rawLine of sanitized.split('\n')) {
    const words = rawLine.split(/\s+/).filter((entry) => entry.length > 0)
    if (words.length === 0) {
      result.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate
        continue
      }
      if (current.length > 0) result.push(current)
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word
      } else {
        for (const chunk of splitWideToken(word, font, size, maxWidth)) result.push(chunk)
        current = ''
      }
    }
    if (current.length > 0) result.push(current)
  }
  return result.length > 0 ? result : ['']
}

function splitWideToken(token: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const chunks: string[] = []
  let current = ''
  for (const char of token) {
    const candidate = current + char
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current.length > 0) {
      chunks.push(current)
      current = char
    } else {
      current = candidate
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * The Helvetica standard font is WinAnsi-encoded; characters outside that set
 * (emoji, CJK, etc.) would throw at draw time. Replace anything non-encodable
 * with `?` so a snapshot can never fail to render on exotic answer text.
 */
function sanitizeForWinAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^ -ÿ]/g, '?')
}

// ============================================================================
// Helpers
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stringifyFallback(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function resolveLocalized(map: Record<string, string> | undefined, locale: string): string {
  if (!isRecord(map)) return ''
  const exact = map[locale]
  if (typeof exact === 'string' && exact.length > 0) return exact
  const en = map.en
  if (typeof en === 'string' && en.length > 0) return en
  for (const value of Object.values(map)) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

function resolveDefaultLocale(form: Form | null, schema: Record<string, unknown>): string {
  if (form?.defaultLocale) return form.defaultLocale
  const fromSchema = schema['x-om-default-locale']
  if (typeof fromSchema === 'string' && fromSchema.length > 0) return fromSchema
  return 'en'
}

function schemaTitle(schema: Record<string, unknown>): string | null {
  return readString(schema.title)
}

function readSchemaSections(schema: Record<string, unknown>): SchemaSection[] {
  const raw = schema['x-om-sections']
  if (!Array.isArray(raw)) return []
  const result: SchemaSection[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    if (typeof entry.key !== 'string') continue
    result.push({
      key: entry.key,
      title: isRecord(entry.title) ? (entry.title as Record<string, string>) : undefined,
      fieldKeys: Array.isArray(entry.fieldKeys)
        ? entry.fieldKeys.filter((value): value is string => typeof value === 'string')
        : [],
    })
  }
  return result
}
