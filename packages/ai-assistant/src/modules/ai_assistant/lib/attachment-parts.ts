import { promises as fs } from 'fs'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type {
  AiAgentAcceptedMediaType,
  AiAgentDefinition,
} from './ai-agent-definition'
import type {
  AiChatRequestContext,
  AiResolvedAttachmentPart,
} from './attachment-bridge-types'

// Provider-native inline byte limit. Most AI providers accept inline image/PDF
// payloads comfortably under 4 MB; anything larger SHOULD travel as a short-lived
// signed URL (see AttachmentSigner below). Above this ceiling and with no signer
// configured, the helper downgrades to `metadata-only` so the model at least sees
// that the attachment exists.
const DEFAULT_MAX_INLINE_BYTES = 4 * 1024 * 1024

// Extracted text cap. The `content` column on the `attachments` table is the
// OCR/text-extraction output; we forward it verbatim up to this character count
// so the system prompt + messages combined do not blow past model context
// limits. Truncation is signaled to the model via a trailing `[... truncated]`
// marker.
const DEFAULT_MAX_TEXT_CHARS = 64 * 1024

/**
 * Optional attachment-signer. When the DI container resolves a value under
 * `attachmentSigner`, the resolver uses it to mint a short-lived URL for
 * images/PDFs that exceed the inline-bytes threshold. Phase 1 does not ship a
 * concrete signer; the hook exists so the `signed-url` branch of
 * {@link AiResolvedAttachmentPart} is reachable as soon as a provider wires one
 * up without requiring another runtime change.
 */
export interface AttachmentSigner {
  sign(input: {
    attachmentId: string
    fileName: string
    mediaType: string
    tenantId: string | null
    organizationId: string | null
  }): Promise<string | null>
}

export interface ResolveAttachmentPartsInput {
  attachmentIds: readonly string[]
  authContext: AiChatRequestContext
  acceptedMediaTypes?: readonly AiAgentAcceptedMediaType[]
  container?: AwilixContainer
  /**
   * Optional override for the inline bytes threshold. Callers SHOULD leave
   * this untouched; the default tracks a safe cross-provider ceiling.
   */
  maxInlineBytes?: number
  /**
   * Optional override for the extracted-text character cap.
   */
  maxTextChars?: number
}

function classifyMediaType(mimeType: string | null | undefined): AiAgentAcceptedMediaType {
  const normalized = (mimeType ?? '').toLowerCase().trim()
  if (normalized.startsWith('image/')) return 'image'
  if (normalized === 'application/pdf') return 'pdf'
  return 'file'
}

function isTextLikeMime(mimeType: string | null | undefined): boolean {
  const normalized = (mimeType ?? '').toLowerCase().trim()
  if (!normalized) return false
  if (normalized.startsWith('text/')) return true
  if (normalized === 'application/json') return true
  if (normalized === 'application/xml') return true
  if (normalized === 'application/x-yaml' || normalized === 'text/yaml') return true
  if (normalized === 'application/csv') return true
  return false
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 16))}\n[... truncated]`
}

function resolveEm(container: AwilixContainer | undefined): EntityManager | null {
  if (!container) return null
  try {
    const candidate = container.resolve('em') as EntityManager | undefined
    return candidate ?? null
  } catch {
    return null
  }
}

function resolveSigner(container: AwilixContainer | undefined): AttachmentSigner | null {
  if (!container) return null
  try {
    const candidate = container.resolve('attachmentSigner') as AttachmentSigner | undefined
    if (candidate && typeof candidate.sign === 'function') {
      return candidate
    }
  } catch {
    return null
  }
  return null
}

type AttachmentRow = {
  id: string
  entityId: string
  fileName: string
  mimeType: string
  fileSize: number
  storagePath: string
  storageDriver: string
  partitionCode: string
  tenantId: string | null
  organizationId: string | null
  content: string | null
}

async function loadAttachmentRow(
  em: EntityManager,
  attachmentId: string,
  authContext: AiChatRequestContext,
): Promise<AttachmentRow | null> {
  // Attachment entity is imported lazily to keep ai-assistant isomorphic — the
  // core package owns the MikroORM metadata and is the only place tests would
  // need to bootstrap for real DB access.
  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
  const record = await findOneWithDecryption(
    em,
    Attachment as never,
    { id: attachmentId } as never,
    undefined,
    {
      tenantId: authContext.tenantId,
      organizationId: authContext.organizationId,
    },
  )
  if (!record) return null
  const row = record as unknown as AttachmentRow
  return {
    id: row.id,
    entityId: row.entityId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    storagePath: row.storagePath,
    storageDriver: row.storageDriver,
    partitionCode: row.partitionCode,
    tenantId: row.tenantId ?? null,
    organizationId: row.organizationId ?? null,
    content: row.content ?? null,
  }
}

function rowBelongsToCaller(row: AttachmentRow, authContext: AiChatRequestContext): boolean {
  if (authContext.isSuperAdmin) return true
  // Tenant scope: if the record is tenant-scoped, it MUST match the caller tenant.
  if (row.tenantId && row.tenantId !== authContext.tenantId) return false
  // Organization scope: if the record is org-scoped, it MUST match the caller org.
  if (row.organizationId && row.organizationId !== authContext.organizationId) return false
  return true
}

async function readAttachmentBytes(row: AttachmentRow): Promise<Uint8Array | null> {
  const { resolveAttachmentAbsolutePath } = await import(
    '@open-mercato/core/modules/attachments/lib/storage'
  )
  const absolutePath = resolveAttachmentAbsolutePath(
    row.partitionCode,
    row.storagePath,
    row.storageDriver,
  )
  try {
    const buffer = await fs.readFile(absolutePath)
    return new Uint8Array(buffer)
  } catch (error) {
    console.warn(
      `[AI Agents] Failed to read attachment ${row.id} from storage; falling back to metadata-only:`,
      error,
    )
    return null
  }
}

async function classifyAndBuildPart(
  row: AttachmentRow,
  mediaClass: AiAgentAcceptedMediaType,
  maxInlineBytes: number,
  maxTextChars: number,
  signer: AttachmentSigner | null,
  authContext: AiChatRequestContext,
): Promise<AiResolvedAttachmentPart> {
  const base: Pick<AiResolvedAttachmentPart, 'attachmentId' | 'fileName' | 'mediaType'> = {
    attachmentId: row.id,
    fileName: row.fileName,
    mediaType: row.mimeType || 'application/octet-stream',
  }

  // Text-like generic files — use the pre-extracted content column if present.
  if (mediaClass === 'file' && isTextLikeMime(row.mimeType) && typeof row.content === 'string' && row.content.length > 0) {
    return {
      ...base,
      source: 'text',
      textContent: truncateText(row.content, maxTextChars),
    }
  }

  // Images + PDFs — prefer inline bytes when small enough; otherwise signed URL
  // if the container registered an attachmentSigner; otherwise metadata-only.
  if (mediaClass === 'image' || mediaClass === 'pdf') {
    if (row.fileSize > 0 && row.fileSize <= maxInlineBytes) {
      const bytes = await readAttachmentBytes(row)
      if (bytes) {
        return {
          ...base,
          source: 'bytes',
          data: bytes,
        }
      }
    }
    if (signer) {
      try {
        const url = await signer.sign({
          attachmentId: row.id,
          fileName: row.fileName,
          mediaType: row.mimeType,
          tenantId: authContext.tenantId,
          organizationId: authContext.organizationId,
        })
        if (typeof url === 'string' && url.length > 0) {
          return {
            ...base,
            source: 'signed-url',
            url,
          }
        }
      } catch (error) {
        console.warn(
          `[AI Agents] attachmentSigner failed for ${row.id}; falling back to metadata-only:`,
          error,
        )
      }
    }
    return { ...base, source: 'metadata-only' }
  }

  // Generic file without extracted text — metadata-only so the model at least
  // knows the attachment is present.
  return { ...base, source: 'metadata-only' }
}

/**
 * Resolves each `attachmentId` into a model-ready {@link AiResolvedAttachmentPart}.
 *
 * Contract:
 *
 * - Tenant/org scope is enforced: records that don't belong to the caller are
 *   dropped with a `console.warn`. Super-admin callers bypass the scope check.
 * - When the agent declares `acceptedMediaTypes`, parts whose classified media
 *   type is not in the whitelist are dropped with a `console.warn`.
 *   `acceptedMediaTypes: undefined` means "no filter".
 * - When the DI container is missing or the attachments service is
 *   unavailable, the helper returns `[]` with a single `console.warn` and
 *   does NOT throw — the caller's `attachmentIds` pass-through to
 *   {@link resolveAiAgentTools} remains the Step 3.6 parity behavior.
 * - The returned parts are ordered to match `attachmentIds`. Any id that
 *   cannot be resolved (not found, out-of-scope, unreadable) is silently
 *   dropped from the result — the caller observes a shorter list.
 */
export async function resolveAttachmentParts(
  input: ResolveAttachmentPartsInput,
): Promise<AiResolvedAttachmentPart[]> {
  const ids = Array.from(input.attachmentIds ?? [])
  if (ids.length === 0) return []

  const em = resolveEm(input.container)
  if (!em) {
    console.warn(
      '[AI Agents] resolveAttachmentParts called without a DI container exposing `em`; skipping attachment resolution.',
    )
    return []
  }

  const maxInlineBytes = input.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES
  const maxTextChars = input.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS
  const signer = resolveSigner(input.container)
  const acceptedSet = input.acceptedMediaTypes
    ? new Set<AiAgentAcceptedMediaType>(input.acceptedMediaTypes)
    : null

  const parts: AiResolvedAttachmentPart[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) continue
    let row: AttachmentRow | null
    try {
      row = await loadAttachmentRow(em, id, input.authContext)
    } catch (error) {
      console.warn(
        `[AI Agents] Failed to load attachment ${id}; skipping:`,
        error,
      )
      continue
    }
    if (!row) {
      console.warn(`[AI Agents] Attachment ${id} not found; skipping.`)
      continue
    }
    if (!rowBelongsToCaller(row, input.authContext)) {
      console.warn(
        `[AI Agents] Attachment ${id} is out of scope for caller (tenant=${input.authContext.tenantId}, org=${input.authContext.organizationId}); skipping.`,
      )
      continue
    }
    const mediaClass = classifyMediaType(row.mimeType)
    if (acceptedSet && !acceptedSet.has(mediaClass)) {
      console.warn(
        `[AI Agents] Attachment ${id} (${row.mimeType}) is not in agent acceptedMediaTypes=${[...acceptedSet].join(',')}; skipping.`,
      )
      continue
    }
    try {
      const part = await classifyAndBuildPart(
        row,
        mediaClass,
        maxInlineBytes,
        maxTextChars,
        signer,
        input.authContext,
      )
      parts.push(part)
    } catch (error) {
      console.warn(
        `[AI Agents] Failed to build attachment part for ${id}; skipping:`,
        error,
      )
    }
  }

  return parts
}

/**
 * Helper used by {@link ./agent-runtime} to fan out attachment resolution for
 * an agent. Kept separate so the runtime helpers share identical semantics
 * (Step 3.6 parity invariant #7 widened: resolved parts flow into both the
 * chat and object paths through the same code).
 */
export async function resolveAttachmentPartsForAgent(input: {
  agent: AiAgentDefinition
  attachmentIds: readonly string[] | undefined
  authContext: AiChatRequestContext
  container?: AwilixContainer
}): Promise<AiResolvedAttachmentPart[]> {
  if (!input.attachmentIds || input.attachmentIds.length === 0) return []
  return resolveAttachmentParts({
    attachmentIds: input.attachmentIds,
    authContext: input.authContext,
    acceptedMediaTypes: input.agent.acceptedMediaTypes,
    container: input.container,
  })
}

/**
 * Converts resolved attachment parts into AI SDK v6 `FileUIPart` shapes so
 * they can be appended to the last user `UIMessage.parts`. `metadata-only`
 * parts are dropped — there is no provider-safe file-part shape for them;
 * their presence is surfaced through the system prompt instead by
 * {@link summarizeAttachmentPartsForPrompt}.
 */
export function attachmentPartsToUiFileParts(
  parts: readonly AiResolvedAttachmentPart[],
): Array<{ type: 'file'; mediaType: string; filename: string; url: string }> {
  const output: Array<{ type: 'file'; mediaType: string; filename: string; url: string }> = []
  for (const part of parts) {
    if (part.source === 'bytes' && part.data) {
      const base64 = toBase64(part.data)
      if (base64) {
        output.push({
          type: 'file',
          mediaType: part.mediaType,
          filename: part.fileName,
          url: `data:${part.mediaType};base64,${base64}`,
        })
      }
      continue
    }
    if (part.source === 'signed-url' && typeof part.url === 'string' && part.url.length > 0) {
      output.push({
        type: 'file',
        mediaType: part.mediaType,
        filename: part.fileName,
        url: part.url,
      })
    }
  }
  return output
}

/**
 * Renders a compact, human-readable attachment summary to append to the
 * system prompt. Covers `text`, `metadata-only`, and as a fallback the
 * `bytes`/`signed-url` kinds so the model can always reason about which
 * attachments are in scope. Keeping this as a string keeps provider-agnostic
 * behavior — object-mode and chat-mode both consume the same surface.
 */
export function summarizeAttachmentPartsForPrompt(
  parts: readonly AiResolvedAttachmentPart[],
): string | null {
  if (parts.length === 0) return null
  const lines: string[] = ['[ATTACHMENTS]']
  for (const part of parts) {
    const header = `- ${part.fileName} (${part.mediaType}, source=${part.source})`
    if (part.source === 'text' && typeof part.textContent === 'string' && part.textContent.length > 0) {
      lines.push(header)
      lines.push(part.textContent)
    } else {
      lines.push(header)
    }
  }
  return lines.join('\n')
}

function toBase64(data: Uint8Array | string): string | null {
  if (typeof data === 'string') return data
  try {
    return Buffer.from(data).toString('base64')
  } catch {
    return null
  }
}
