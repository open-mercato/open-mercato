import type { z } from 'zod'
import type { InboxProposalActionSourceRef } from '../data/entities'
import {
  INBOX_SOURCE_REFS_MAX_PER_ACTION,
  INBOX_SOURCE_REF_FILE_NAME_MAX_CHARS,
  INBOX_SOURCE_REF_SHEET_MAX_CHARS,
  INBOX_SOURCE_REF_SNIPPET_MAX_CHARS,
  inboxProposalActionSourceRefSchema,
  type extractedSourceRefSchema,
} from '../data/validators'
import { codePointSafeEnd, renderAttachmentPromptName, unescapePromptAttribute } from './extractionPrompt'

/** One model-output ref after the lenient parse; `undefined` marks a malformed ref. */
export type ExtractedSourceRef = NonNullable<z.infer<typeof extractedSourceRefSchema>>

/** A stored part of the email that an `attachment` reference may cite. */
export type CitableAttachmentPart = {
  attachmentId: string
  fileName: string | null
}

function clip(value: string | undefined, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, codePointSafeEnd(trimmed, max)) : trimmed
}

function positiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.trunc(value)
  return rounded > 0 ? rounded : undefined
}

function resolveCitedPart(
  ref: ExtractedSourceRef,
  partsById: Map<string, CitableAttachmentPart>,
  nameForms: () => ReadonlyArray<{ part: CitableAttachmentPart; forms: Set<string> }>,
): CitableAttachmentPart | null {
  const attachmentId = ref.attachmentId?.trim().toLowerCase()
  if (attachmentId) return partsById.get(attachmentId) ?? null
  // Models sometimes drop the id but keep the file name: accept it only when it names exactly one part.
  const fileName = ref.fileName?.trim()
  if (!fileName) return null
  const echoed = [fileName, unescapePromptAttribute(fileName)]
  const matches = nameForms().filter(({ forms }) => echoed.some((form) => forms.has(form)))
  return matches.length === 1 ? matches[0].part : null
}

/**
 * The forms of a ledger file name a model may echo, unescaped: the prompt showed the name escaped
 * and clipped (`renderAttachmentPromptName`), so the echo is compared against that rendered form
 * (entities decoded, since models tend to decode them) as well as against the raw ledger name.
 */
function promptNameForms(fileName: string | null): Set<string> {
  const rendered = unescapePromptAttribute(renderAttachmentPromptName(fileName))
  const forms = new Set([rendered])
  if (rendered.endsWith('…')) forms.add(rendered.slice(0, -1).trimEnd())
  const raw = fileName?.trim()
  if (raw) forms.add(raw)
  return forms
}

/**
 * Turns the LLM's `sourceRefs` of one action into the stored shape: whitespace is collapsed,
 * strings are clipped to their bounds, at most {@link INBOX_SOURCE_REFS_MAX_PER_ACTION} refs are
 * kept, malformed refs are dropped, and an `attachment` ref survives only when it cites a stored part of this email (its id,
 * or a file name that names exactly one part). The cited part's own id and file name replace the
 * model's copy, so a ref never carries a name the ledger does not hold. `email_body` refs keep
 * only their snippet.
 */
export function normalizeSourceRefs(
  refs: ReadonlyArray<ExtractedSourceRef | null | undefined> | null | undefined,
  storedParts: CitableAttachmentPart[],
): InboxProposalActionSourceRef[] {
  if (!Array.isArray(refs) || refs.length === 0) return []
  const partsById = new Map(storedParts.map((part) => [part.attachmentId.toLowerCase(), part]))
  // Rendered once per call, not once per ref: the model controls how many refs it returns.
  let nameForms: Array<{ part: CitableAttachmentPart; forms: Set<string> }> | null = null
  const getNameForms = () => (nameForms ??= storedParts.map((part) => ({ part, forms: promptNameForms(part.fileName) })))
  const normalized: InboxProposalActionSourceRef[] = []
  for (const ref of refs) {
    if (normalized.length >= INBOX_SOURCE_REFS_MAX_PER_ACTION) break
    // The lenient model-output schema turns a malformed ref into `undefined`.
    if (!ref || typeof ref !== 'object') continue
    const snippet = clip(ref.snippet, INBOX_SOURCE_REF_SNIPPET_MAX_CHARS)
    if (!snippet) continue
    let candidate: InboxProposalActionSourceRef
    if (ref.kind === 'attachment') {
      const part = resolveCitedPart(ref, partsById, getNameForms)
      if (!part) continue
      const fileName = clip(part.fileName ?? undefined, INBOX_SOURCE_REF_FILE_NAME_MAX_CHARS)
      const page = positiveInteger(ref.page)
      const sheet = clip(ref.sheet, INBOX_SOURCE_REF_SHEET_MAX_CHARS)
      const row = positiveInteger(ref.row)
      candidate = {
        kind: 'attachment',
        attachmentId: part.attachmentId,
        ...(fileName ? { fileName } : {}),
        ...(page !== undefined ? { page } : {}),
        ...(sheet ? { sheet } : {}),
        ...(row !== undefined ? { row } : {}),
        snippet,
      }
    } else if (ref.kind === 'email_body') {
      candidate = { kind: 'email_body', snippet }
    } else {
      continue
    }
    if (inboxProposalActionSourceRefSchema.safeParse(candidate).success) normalized.push(candidate)
  }
  return normalized
}
