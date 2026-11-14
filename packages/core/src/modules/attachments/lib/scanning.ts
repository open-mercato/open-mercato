import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AttachmentQuarantineStore } from './quarantine'
import { LocalAttachmentQuarantineStore } from './quarantine'

export const attachmentScanStatusSchema = z.enum([
  'clean',
  'rejected',
  'quarantined',
  'scanner_unavailable',
])

export const attachmentScanPolicySchema = z.enum(['required', 'optional', 'disabled'])

const attachmentScanResultSchema = z.object({
  status: attachmentScanStatusSchema,
  reasonCode: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/).nullable().optional(),
}).strict()

export type AttachmentScanStatus = z.infer<typeof attachmentScanStatusSchema>
export type AttachmentScanPolicy = z.infer<typeof attachmentScanPolicySchema>
export type AttachmentScanResult = z.infer<typeof attachmentScanResultSchema>

export type AttachmentScanInput = {
  tenantId: string
  organizationId: string
  fileName: string
  mimeType: string
  source: string
  buffer: Buffer
  signal: AbortSignal
}

export interface AttachmentScanner {
  readonly id: string
  scan(input: AttachmentScanInput): Promise<AttachmentScanResult>
}

export const attachmentScanReceiptSchema = z.object({
  status: attachmentScanStatusSchema,
  scanner: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  policy: attachmentScanPolicySchema,
  checkedAt: z.string().datetime(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reasonCode: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/).nullable(),
}).strict()

export type AttachmentScanReceipt = z.infer<typeof attachmentScanReceiptSchema>

export type AttachmentScanRequest = Omit<AttachmentScanInput, 'signal'>

export interface AttachmentScanGate {
  scan(input: AttachmentScanRequest): Promise<AttachmentScanReceipt>
}

export type AttachmentScanErrorCode =
  | 'rejected'
  | 'quarantined'
  | 'scanner_unavailable'
  | 'quarantine_failed'

export class AttachmentScanError extends Error {
  constructor(
    readonly code: AttachmentScanErrorCode,
    readonly receipt: AttachmentScanReceipt,
    readonly quarantineId?: string,
    options?: ErrorOptions,
  ) {
    super(`[internal] attachment scan blocked: ${code}`, options)
    this.name = 'AttachmentScanError'
  }
}

export type AttachmentScanHttpError = {
  status: 422 | 503
  translationKey: string
  fallback: string
}

type ReceiptContext = Pick<
  AttachmentScanRequest,
  'tenantId' | 'organizationId' | 'fileName' | 'mimeType' | 'source'
> & {
  contentSha256: string
}

const receiptContexts = new WeakMap<AttachmentScanReceipt, ReceiptContext>()

function contentSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function normalizeScannerId(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  return normalized || 'unknown'
}

function buildReceipt(
  input: AttachmentScanRequest,
  policy: AttachmentScanPolicy,
  scanner: string,
  result: AttachmentScanResult,
): AttachmentScanReceipt {
  const receipt: AttachmentScanReceipt = {
    status: result.status,
    scanner: normalizeScannerId(scanner),
    policy,
    checkedAt: new Date().toISOString(),
    contentSha256: contentSha256(input.buffer),
    reasonCode: result.reasonCode ?? null,
  }
  receiptContexts.set(receipt, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    source: input.source,
    contentSha256: receipt.contentSha256,
  })
  return receipt
}

function receiptMatchesInput(receipt: AttachmentScanReceipt, input: AttachmentScanRequest): boolean {
  const context = receiptContexts.get(receipt)
  if (!context) return false
  return context.tenantId === input.tenantId
    && context.organizationId === input.organizationId
    && context.fileName === input.fileName
    && context.mimeType === input.mimeType
    && context.source === input.source
    && context.contentSha256 === contentSha256(input.buffer)
}

export function resolveAttachmentScanPolicy(env: NodeJS.ProcessEnv = process.env): AttachmentScanPolicy {
  const parsed = attachmentScanPolicySchema.safeParse(env.OM_ATTACHMENT_SCAN_POLICY?.trim().toLowerCase())
  return parsed.success ? parsed.data : 'optional'
}

export function resolveAttachmentScanTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.OM_ATTACHMENT_SCAN_TIMEOUT_MS)
  if (!Number.isFinite(parsed)) return 15_000
  return Math.min(120_000, Math.max(1_000, Math.trunc(parsed)))
}

export class UnavailableAttachmentScanner implements AttachmentScanner {
  readonly id = 'unavailable'

  async scan(): Promise<AttachmentScanResult> {
    return { status: 'scanner_unavailable', reasonCode: 'scanner_not_configured' }
  }
}

class AttachmentScanTimeoutError extends Error {}

async function scanWithTimeout(
  scanner: AttachmentScanner,
  input: AttachmentScanRequest,
  timeoutMs: number,
): Promise<AttachmentScanResult> {
  const controller = new AbortController()
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(new AttachmentScanTimeoutError('[internal] attachment scanner timed out'))
    }, timeoutMs)
    timeoutHandle.unref?.()
  })

  try {
    return await Promise.race([
      scanner.scan({ ...input, signal: controller.signal }),
      timeout,
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

export class DefaultAttachmentScanGate implements AttachmentScanGate {
  constructor(
    private readonly scanner: AttachmentScanner,
    private readonly quarantineStore: AttachmentQuarantineStore,
    private readonly policy: AttachmentScanPolicy = resolveAttachmentScanPolicy(),
    private readonly timeoutMs: number = resolveAttachmentScanTimeoutMs(),
  ) {}

  async scan(input: AttachmentScanRequest): Promise<AttachmentScanReceipt> {
    let scannerId = this.scanner.id
    let rawResult: unknown

    if (this.policy === 'disabled') {
      scannerId = 'disabled'
      rawResult = { status: 'scanner_unavailable', reasonCode: 'scan_disabled' }
    } else {
      try {
        rawResult = await scanWithTimeout(this.scanner, input, this.timeoutMs)
      } catch (error) {
        rawResult = {
          status: 'scanner_unavailable',
          reasonCode: error instanceof AttachmentScanTimeoutError ? 'scanner_timeout' : 'scanner_error',
        }
      }
    }

    const parsed = attachmentScanResultSchema.safeParse(rawResult)
    const result: AttachmentScanResult = parsed.success
      ? parsed.data
      : { status: 'scanner_unavailable', reasonCode: 'invalid_scanner_response' }
    const receipt = buildReceipt(input, this.policy, scannerId, result)

    if (result.status === 'clean') return receipt
    if (result.status === 'scanner_unavailable' && this.policy !== 'required') return receipt
    if (result.status === 'rejected') throw new AttachmentScanError('rejected', receipt)

    try {
      const quarantined = await this.quarantineStore.quarantine({ ...input, receipt })
      throw new AttachmentScanError(result.status, receipt, quarantined.quarantineId)
    } catch (error) {
      if (error instanceof AttachmentScanError) throw error
      throw new AttachmentScanError('quarantine_failed', receipt, undefined, { cause: error })
    }
  }
}

export async function ensureAttachmentScanReceipt(input: {
  gate?: AttachmentScanGate | null
  request: AttachmentScanRequest
  receipt?: AttachmentScanReceipt | null
}): Promise<AttachmentScanReceipt> {
  if (input.receipt && receiptMatchesInput(input.receipt, input.request)) return input.receipt
  const receipt = await (input.gate ?? createDefaultAttachmentScanGate()).scan(input.request)
  attachmentScanReceiptSchema.parse(receipt)
  if (receipt.contentSha256 !== contentSha256(input.request.buffer)) {
    throw new Error('[internal] attachment scan receipt does not match content')
  }
  return receipt
}

export function createDefaultAttachmentScanGate(): AttachmentScanGate {
  return new DefaultAttachmentScanGate(
    new UnavailableAttachmentScanner(),
    new LocalAttachmentQuarantineStore(),
  )
}

type AttachmentScanContainer = {
  resolve(name: string): unknown
}

export function resolveAttachmentScanGate(container?: AttachmentScanContainer | null): AttachmentScanGate {
  try {
    const resolved = container?.resolve('attachmentScanGate') as AttachmentScanGate | null | undefined
    if (resolved && typeof resolved.scan === 'function') return resolved
  } catch {
    return createDefaultAttachmentScanGate()
  }
  return createDefaultAttachmentScanGate()
}

export function resolveAttachmentScanHttpError(error: unknown): AttachmentScanHttpError | null {
  if (!(error instanceof AttachmentScanError)) return null
  if (error.code === 'rejected') {
    return {
      status: 422,
      translationKey: 'attachments.errors.scanRejected',
      fallback: 'Attachment was rejected by the configured security scanner.',
    }
  }
  if (error.code === 'quarantined') {
    return {
      status: 422,
      translationKey: 'attachments.errors.scanQuarantined',
      fallback: 'Attachment was isolated by the configured security scanner.',
    }
  }
  return {
    status: 503,
    translationKey: 'attachments.errors.scanUnavailable',
    fallback: 'Attachment scanning is temporarily unavailable.',
  }
}
