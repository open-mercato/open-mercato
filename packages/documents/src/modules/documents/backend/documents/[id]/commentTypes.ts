import type { DocumentCommentAnchor } from '../../../data/validators'
import { isChangedDocumentCommentAnchor, normalizeDocumentCommentAnchor } from '../../../lib/commentAnchors'
import {
  firstSafeDocumentsDisplayLabel,
  sanitizeDocumentsDisplayLabel,
} from '../../../lib/displayLabels'
import { readArrayPayload, readBoolean, readRecord, readString } from '../documentUi'

export type CommentMention = { userId: string }
export type UserLabel = { label: string; secondary?: string | null }
export type UserLabels = Record<string, UserLabel>
export type PendingMention = { userId: string; name: string }
export type AccessCheckUser = { userId: string; label: string | null; secondary: string | null }
export type NormalizedCommentAnchor = DocumentCommentAnchor | 'changed' | null

const MENTION_WORD_CHARACTER = /[\p{L}\p{N}_]/u

function isMentionTokenBoundary(body: string, index: number, tokenLength: number): boolean {
  const before = index > 0 ? body[index - 1] ?? '' : ''
  const after = body[index + tokenLength] ?? ''
  return !MENTION_WORD_CHARACTER.test(before) && !MENTION_WORD_CHARACTER.test(after)
}

export function bodyContainsPendingMention(body: string, mention: PendingMention): boolean {
  const token = `@${mention.name}`
  let index = body.indexOf(token)
  while (index >= 0) {
    if (isMentionTokenBoundary(body, index, token.length)) return true
    index = body.indexOf(token, index + token.length)
  }
  return false
}

export function removePendingMentionOccurrences(
  body: string,
  mention: PendingMention,
  pendingMentions: PendingMention[],
): string {
  const token = `@${mention.name}`
  const extendingTokens = pendingMentions
    .map((candidate) => `@${candidate.name}`)
    .filter((candidate) => candidate.length > token.length && candidate.startsWith(token))
    .sort((left, right) => right.length - left.length)
  let result = ''
  let cursor = 0
  while (cursor < body.length) {
    const extending = extendingTokens.find((candidate) => (
      body.startsWith(candidate, cursor) && isMentionTokenBoundary(body, cursor, candidate.length)
    ))
    if (extending) {
      result += extending
      cursor += extending.length
      continue
    }
    if (body.startsWith(token, cursor) && isMentionTokenBoundary(body, cursor, token.length)) {
      cursor += token.length
      continue
    }
    result += body[cursor]
    cursor += 1
  }
  return result
}

export type DocumentComment = {
  id: string
  documentId: string
  parentCommentId: string | null
  authorUserId: string
  body: string
  mentions: CommentMention[]
  anchor: NormalizedCommentAnchor
  resolvedAt: string | null
  resolvedByUserId: string | null
  createdAt: string
  updatedAt: string
  canResolve: boolean
  replies: DocumentComment[]
}

function readNullableString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (value === null) return null
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function readAnchor(value: unknown): NormalizedCommentAnchor {
  if (value === null || value === undefined) return null
  const normalized = normalizeDocumentCommentAnchor(value)
  return isChangedDocumentCommentAnchor(normalized) ? 'changed' : normalized
}

function readMentions(value: unknown): CommentMention[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const record = readRecord(entry)
    const userId = record ? readString(record, 'userId', 'user_id') : null
    return userId ? [{ userId: userId.toLowerCase() }] : []
  })
}

function normalizeComment(value: unknown): DocumentComment | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const documentId = readString(record, 'documentId', 'document_id')
  const authorUserId = readString(record, 'authorUserId', 'author_user_id')
  const createdAt = readString(record, 'createdAt', 'created_at')
  const updatedAt = readString(record, 'updatedAt', 'updated_at')
  if (!id || !documentId || !authorUserId || !createdAt || !updatedAt) return null
  const replies = Array.isArray(record.replies)
    ? record.replies.map(normalizeComment).filter((reply): reply is DocumentComment => reply !== null)
    : []
  return {
    id,
    documentId,
    parentCommentId: readNullableString(record, 'parentCommentId', 'parent_comment_id'),
    authorUserId,
    body: readString(record, 'body') ?? '',
    mentions: readMentions(record.mentions),
    anchor: readAnchor(record.anchor),
    resolvedAt: readNullableString(record, 'resolvedAt', 'resolved_at'),
    resolvedByUserId: readNullableString(record, 'resolvedByUserId', 'resolved_by_user_id'),
    createdAt,
    updatedAt,
    canResolve: readBoolean(record, 'canResolve', 'can_resolve') ?? false,
    replies,
  }
}

export function readCommentItems(payload: unknown): DocumentComment[] {
  return readArrayPayload(payload, 'items', 'data')
    .map(normalizeComment)
    .filter((comment): comment is DocumentComment => comment !== null)
}

export function readUserLabels(payload: unknown, fallbackLabel?: string): UserLabels {
  const record = readRecord(payload)
  const rawLabels = readRecord(record?.userLabels)
  if (!rawLabels) return {}
  const safeFallback = sanitizeDocumentsDisplayLabel(fallbackLabel)
  const labels: UserLabels = {}
  for (const [userId, value] of Object.entries(rawLabels)) {
    const labelRecord = readRecord(value)
    const label = labelRecord
      ? firstSafeDocumentsDisplayLabel(readString(labelRecord, 'label'), safeFallback)
      : safeFallback
    const secondary = labelRecord
      ? sanitizeDocumentsDisplayLabel(readNullableString(labelRecord, 'secondary'))
      : null
    if (label) labels[userId.toLowerCase()] = {
      label,
      secondary: secondary && secondary !== label ? secondary : null,
    }
  }
  return labels
}

export function readWithoutAccess(payload: unknown): AccessCheckUser[] {
  const record = readRecord(payload)
  if (!record) return []
  if (Array.isArray(record.withoutAccessUsers)) {
    return record.withoutAccessUsers.flatMap((value) => {
      const user = readRecord(value)
      const userId = user ? readString(user, 'userId', 'user_id', 'id') : null
      if (!userId || !user) return []
      const label = sanitizeDocumentsDisplayLabel(readNullableString(user, 'label'))
      const secondary = sanitizeDocumentsDisplayLabel(readNullableString(user, 'secondary'))
      return [{
        userId: userId.toLowerCase(),
        label,
        secondary: secondary && secondary !== label ? secondary : null,
      }]
    })
  }
  if (!Array.isArray(record.withoutAccess)) return []
  return record.withoutAccess.flatMap((value) => typeof value === 'string' ? [{
    userId: value.toLowerCase(), label: null, secondary: null,
  }] : [])
}

export function findCommentById(comments: DocumentComment[], commentId: string): DocumentComment | null {
  for (const comment of comments) {
    if (comment.id === commentId) return comment
    const reply = findCommentById(comment.replies, commentId)
    if (reply) return reply
  }
  return null
}
