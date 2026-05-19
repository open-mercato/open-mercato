"use client"

import * as React from 'react'
import { MarkdownContent } from '../backend/markdown/MarkdownContent'
import { RecordCard } from './records/RecordCard'
import type {
  ActivityRecordPayload,
  CompanyRecordPayload,
  DealRecordPayload,
  PersonRecordPayload,
  ProductRecordPayload,
  RecordCardKind,
  RecordCardPayload,
} from './records/types'

/**
 * Info-string prefix recognised inside fenced code blocks. Anything matching
 * ```open-mercato:<kind>``` is parsed as JSON and rendered via the matching
 * record card. Unknown kinds fall back to a plain `<code>` block so the
 * transcript never crashes on a malformed widget payload.
 */
export const RECORD_CARD_FENCE_INFO_PREFIX = 'open-mercato:'

const KNOWN_KINDS: ReadonlySet<RecordCardKind> = new Set([
  'deal',
  'person',
  'company',
  'product',
  'activity',
])

export type AiMessageContentSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'record-card'; payload: RecordCardPayload; raw: string }
  | { kind: 'invalid-card'; info: string; raw: string }

interface FenceMatch {
  start: number
  end: number
  info: string
  body: string
  closed: boolean
}

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)(```|$)/g

function findFences(input: string): FenceMatch[] {
  const matches: FenceMatch[] = []
  FENCE_RE.lastIndex = 0
  for (;;) {
    const match = FENCE_RE.exec(input)
    if (!match) break
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      info: (match[1] ?? '').trim(),
      body: match[2] ?? '',
      closed: match[3] === '```',
    })
    if (match[0].length === 0) {
      FENCE_RE.lastIndex += 1
    }
  }
  return matches
}

function coerceKind(value: unknown): RecordCardKind | null {
  if (typeof value !== 'string') return null
  const normalized = value.toLowerCase().trim()
  return KNOWN_KINDS.has(normalized as RecordCardKind)
    ? (normalized as RecordCardKind)
    : null
}

function normalizeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      out.push(entry.trim())
    } else if (entry && typeof entry === 'object') {
      const maybeLabel = (entry as { label?: unknown; name?: unknown }).label
      const maybeName = (entry as { name?: unknown }).name
      if (typeof maybeLabel === 'string') out.push(maybeLabel)
      else if (typeof maybeName === 'string') out.push(maybeName)
    }
  }
  return out
}

function normalizeRecordPayload(
  kind: RecordCardKind,
  raw: Record<string, unknown>,
): RecordCardPayload | null {
  const id = typeof raw.id === 'string' ? raw.id : undefined
  const href = typeof raw.href === 'string' ? raw.href : undefined
  const tags = normalizeStringList(raw.tags) ?? null
  const status = typeof raw.status === 'string' ? raw.status : null

  if (kind === 'deal') {
    const title =
      (typeof raw.title === 'string' && raw.title) ||
      (typeof raw.name === 'string' && raw.name) ||
      null
    if (!title) return null
    const payload: DealRecordPayload = {
      id,
      href,
      title,
      status,
      stage: typeof raw.stage === 'string' ? raw.stage : null,
      amount:
        typeof raw.amount === 'number' || typeof raw.amount === 'string'
          ? raw.amount
          : null,
      currency: typeof raw.currency === 'string' ? raw.currency : null,
      closeDate:
        typeof raw.closeDate === 'string'
          ? raw.closeDate
          : typeof (raw as { close_date?: unknown }).close_date === 'string'
            ? (raw as { close_date: string }).close_date
            : null,
      ownerName:
        typeof raw.ownerName === 'string'
          ? raw.ownerName
          : typeof (raw as { owner?: unknown }).owner === 'string'
            ? (raw as { owner: string }).owner
            : null,
      personName: typeof raw.personName === 'string' ? raw.personName : null,
      companyName: typeof raw.companyName === 'string' ? raw.companyName : null,
      description: typeof raw.description === 'string' ? raw.description : null,
      tags,
    }
    return { kind: 'deal', ...payload }
  }

  if (kind === 'person') {
    const name =
      (typeof raw.name === 'string' && raw.name) ||
      [
        typeof raw.firstName === 'string' ? raw.firstName : '',
        typeof raw.lastName === 'string' ? raw.lastName : '',
      ]
        .filter(Boolean)
        .join(' ')
        .trim() ||
      null
    if (!name) return null
    const payload: PersonRecordPayload = {
      id,
      href,
      name,
      title: typeof raw.title === 'string' ? raw.title : null,
      email: typeof raw.email === 'string' ? raw.email : null,
      phone: typeof raw.phone === 'string' ? raw.phone : null,
      companyName: typeof raw.companyName === 'string' ? raw.companyName : null,
      ownerName: typeof raw.ownerName === 'string' ? raw.ownerName : null,
      status,
      tags,
      avatarUrl:
        typeof raw.avatarUrl === 'string'
          ? raw.avatarUrl
          : typeof (raw as { avatar?: unknown }).avatar === 'string'
            ? (raw as { avatar: string }).avatar
            : null,
    }
    return { kind: 'person', ...payload }
  }

  if (kind === 'company') {
    const name = typeof raw.name === 'string' ? raw.name : null
    if (!name) return null
    const payload: CompanyRecordPayload = {
      id,
      href,
      name,
      industry: typeof raw.industry === 'string' ? raw.industry : null,
      website: typeof raw.website === 'string' ? raw.website : null,
      email: typeof raw.email === 'string' ? raw.email : null,
      phone: typeof raw.phone === 'string' ? raw.phone : null,
      city: typeof raw.city === 'string' ? raw.city : null,
      country: typeof raw.country === 'string' ? raw.country : null,
      ownerName: typeof raw.ownerName === 'string' ? raw.ownerName : null,
      status,
      tags,
      logoUrl:
        typeof raw.logoUrl === 'string'
          ? raw.logoUrl
          : typeof (raw as { logo?: unknown }).logo === 'string'
            ? (raw as { logo: string }).logo
            : null,
    }
    return { kind: 'company', ...payload }
  }

  if (kind === 'product') {
    const name =
      (typeof raw.name === 'string' && raw.name) ||
      (typeof raw.title === 'string' && raw.title) ||
      null
    if (!name) return null
    const payload: ProductRecordPayload = {
      id,
      href,
      name,
      sku: typeof raw.sku === 'string' ? raw.sku : null,
      price:
        typeof raw.price === 'number' || typeof raw.price === 'string'
          ? raw.price
          : null,
      currency: typeof raw.currency === 'string' ? raw.currency : null,
      status,
      category: typeof raw.category === 'string' ? raw.category : null,
      description: typeof raw.description === 'string' ? raw.description : null,
      imageUrl:
        typeof raw.imageUrl === 'string'
          ? raw.imageUrl
          : typeof (raw as { image?: unknown }).image === 'string'
            ? (raw as { image: string }).image
            : null,
      tags,
    }
    return { kind: 'product', ...payload }
  }

  if (kind === 'activity') {
    const title =
      (typeof raw.title === 'string' && raw.title) ||
      (typeof raw.subject === 'string' && raw.subject) ||
      null
    if (!title) return null
    const payload: ActivityRecordPayload = {
      id,
      href,
      title,
      type: typeof raw.type === 'string' ? raw.type : null,
      status,
      dueDate:
        typeof raw.dueDate === 'string'
          ? raw.dueDate
          : typeof (raw as { due_at?: unknown }).due_at === 'string'
            ? (raw as { due_at: string }).due_at
            : null,
      completedAt:
        typeof raw.completedAt === 'string'
          ? raw.completedAt
          : typeof (raw as { completed_at?: unknown }).completed_at === 'string'
            ? (raw as { completed_at: string }).completed_at
            : null,
      ownerName: typeof raw.ownerName === 'string' ? raw.ownerName : null,
      relatedTo:
        typeof raw.relatedTo === 'string'
          ? raw.relatedTo
          : typeof (raw as { related?: unknown }).related === 'string'
            ? (raw as { related: string }).related
            : null,
      description: typeof raw.description === 'string' ? raw.description : null,
      tags,
    }
    return { kind: 'activity', ...payload }
  }

  return null
}

function tryParseRecordCard(
  info: string,
  body: string,
): RecordCardPayload | null {
  if (!info.startsWith(RECORD_CARD_FENCE_INFO_PREFIX)) return null
  const kind = coerceKind(info.slice(RECORD_CARD_FENCE_INFO_PREFIX.length))
  if (!kind) return null
  const trimmed = body.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (Array.isArray(parsed)) {
    // Take the first entry; multiple cards can be emitted as multiple fences.
    if (parsed.length === 0) return null
    parsed = parsed[0]
  }
  if (!parsed || typeof parsed !== 'object') return null
  return normalizeRecordPayload(kind, parsed as Record<string, unknown>)
}

/**
 * Recognise an `open-mercato:<kind> { ... }` token the model emitted
 * WITHOUT triple backticks and pull the JSON object out by counting
 * matching braces. Returns the parsed payload + the slice that should be
 * removed from the surrounding text.
 *
 * Models routinely drop the fence on this pattern (especially when the
 * card is one of many in a list) and the fallback renders the line as
 * plain prose, which is the user-visible bug we are guarding against.
 */
function tryParseFencelessRecordCard(
  text: string,
  startInfoIndex: number,
): { payload: RecordCardPayload; rawStart: number; rawEnd: number } | null {
  const infoPrefix = text.slice(startInfoIndex)
  if (!infoPrefix.startsWith(RECORD_CARD_FENCE_INFO_PREFIX)) return null
  // Read the kind up to the first whitespace, brace, or end-of-line.
  const afterPrefix = startInfoIndex + RECORD_CARD_FENCE_INFO_PREFIX.length
  let kindEnd = afterPrefix
  while (kindEnd < text.length) {
    const ch = text[kindEnd]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '{') break
    kindEnd += 1
  }
  const kind = coerceKind(text.slice(afterPrefix, kindEnd))
  if (!kind) return null
  // Skip whitespace/newlines until we find the opening brace.
  let braceStart = kindEnd
  while (braceStart < text.length) {
    const ch = text[braceStart]
    if (ch === '{') break
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') return null
    braceStart += 1
  }
  if (braceStart >= text.length || text[braceStart] !== '{') return null
  // Walk forward counting brace depth, respecting strings.
  let depth = 0
  let inString = false
  let escaped = false
  let braceEnd = -1
  for (let i = braceStart; i < text.length; i += 1) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') { inString = false; continue }
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) { braceEnd = i + 1; break }
    }
  }
  if (braceEnd < 0) return null
  const jsonSlice = text.slice(braceStart, braceEnd)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonSlice)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const payload = normalizeRecordPayload(kind, parsed as Record<string, unknown>)
  if (!payload) return null
  return { payload, rawStart: startInfoIndex, rawEnd: braceEnd }
}

/**
 * Walk through a markdown segment and pull every `open-mercato:<kind>
 * { ... }` token (whether or not the model wrapped it in backticks) into
 * a record-card segment. Trailing/leading whitespace around the lifted
 * card is normalised so the surrounding prose stays clean.
 */
function liftFencelessCards(text: string): AiMessageContentSegment[] {
  const out: AiMessageContentSegment[] = []
  let cursor = 0
  while (cursor < text.length) {
    const next = text.indexOf(RECORD_CARD_FENCE_INFO_PREFIX, cursor)
    if (next < 0) break
    const recovered = tryParseFencelessRecordCard(text, next)
    if (!recovered) {
      // Skip this occurrence to avoid an infinite loop.
      cursor = next + RECORD_CARD_FENCE_INFO_PREFIX.length
      continue
    }
    if (recovered.rawStart > cursor) {
      const head = text.slice(cursor, recovered.rawStart)
      if (head.trim().length > 0 || head.length > 0) {
        // Keep whitespace so list separators between cards survive.
        out.push({ kind: 'markdown', text: head })
      }
    }
    out.push({
      kind: 'record-card',
      payload: recovered.payload,
      raw: text.slice(recovered.rawStart, recovered.rawEnd),
    })
    cursor = recovered.rawEnd
  }
  if (cursor < text.length) {
    out.push({ kind: 'markdown', text: text.slice(cursor) })
  }
  return out.length > 0 ? out : [{ kind: 'markdown', text }]
}

/**
 * Split assistant text into ordered segments: markdown chunks interleaved
 * with parsed record-card payloads. Open / closing fences are matched
 * greedily — an unterminated fence is treated as still-in-flight markdown
 * (so partial streaming output never renders a half-built card). After
 * the fence pass, any remaining markdown segment is scanned for
 * `open-mercato:<kind> { ... }` tokens the model emitted without
 * backticks (a common LLM drift) and those are lifted into card segments
 * as well.
 */
export function parseAiContentSegments(content: string): AiMessageContentSegment[] {
  if (!content) return []
  const fences = findFences(content)
  const fenceSegments: AiMessageContentSegment[] = []
  if (fences.length === 0) {
    fenceSegments.push({ kind: 'markdown', text: content })
  } else {
    let cursor = 0
    for (const fence of fences) {
      if (!fence.info.startsWith(RECORD_CARD_FENCE_INFO_PREFIX)) {
        // Plain code fence — leave it for the markdown renderer.
        continue
      }
      if (!fence.closed) {
        // Streaming a card body: keep the leading text rendered, swallow the
        // half-arrived block until it closes.
        if (fence.start > cursor) {
          fenceSegments.push({ kind: 'markdown', text: content.slice(cursor, fence.start) })
        }
        cursor = content.length
        break
      }
      if (fence.start > cursor) {
        fenceSegments.push({ kind: 'markdown', text: content.slice(cursor, fence.start) })
      }
      const payload = tryParseRecordCard(fence.info, fence.body)
      if (payload) {
        fenceSegments.push({
          kind: 'record-card',
          payload,
          raw: content.slice(fence.start, fence.end),
        })
      } else {
        fenceSegments.push({
          kind: 'invalid-card',
          info: fence.info,
          raw: content.slice(fence.start, fence.end),
        })
      }
      cursor = fence.end
    }
    if (cursor < content.length) {
      fenceSegments.push({ kind: 'markdown', text: content.slice(cursor) })
    }
  }
  // Recovery pass: lift fenceless `open-mercato:<kind> { ... }` tokens out
  // of any remaining markdown segments. The model often forgets the
  // triple-backtick wrapper, especially when emitting many cards in a row.
  const out: AiMessageContentSegment[] = []
  for (const segment of fenceSegments) {
    if (segment.kind !== 'markdown') {
      out.push(segment)
      continue
    }
    if (!segment.text.includes(RECORD_CARD_FENCE_INFO_PREFIX)) {
      out.push(segment)
      continue
    }
    out.push(...liftFencelessCards(segment.text))
  }
  return out
}

export interface AiMessageContentProps {
  content: string
  className?: string
}

export function AiMessageContent({ content, className }: AiMessageContentProps) {
  const segments = React.useMemo(() => parseAiContentSegments(content), [content])
  if (segments.length === 0) {
    return null
  }
  return (
    <div className={className} data-ai-message-content="">
      {segments.map((segment, index) => {
        if (segment.kind === 'record-card') {
          return <RecordCard key={`card-${index}`} data={segment.payload} />
        }
        if (segment.kind === 'invalid-card') {
          return (
            <pre
              key={`raw-${index}`}
              className="my-2 max-h-60 overflow-auto rounded-md border border-dashed border-border bg-muted p-2 text-xs"
            >
              {segment.raw}
            </pre>
          )
        }
        if (!segment.text.trim()) {
          return null
        }
        return (
          <MarkdownContent
            key={`md-${index}`}
            body={segment.text}
            format="markdown"
            className="ai-markdown text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_a:hover]:text-primary/80 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold"
          />
        )
      })}
    </div>
  )
}

export default AiMessageContent
