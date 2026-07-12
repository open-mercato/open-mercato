"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DOCUMENTS_COMMENT_LIST_PAGE_SIZE,
  DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT,
} from '../../../lib/historyPolicy'
import { readNumber, readRecord } from '../documentUi'
import type { CommentAnchor } from './CommentAnchorNavigation'
import {
  findCommentById,
  readCommentItems,
  readUserLabels,
  readWithoutAccess,
  type DocumentComment,
  type PendingMention,
  type UserLabels,
} from './commentTypes'

type CommentsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; comments: DocumentComment[]; userLabels: UserLabels }

type UseDocumentCommentsInput = {
  documentId: string
  editor: Editor | null
  canComment: boolean
  canShare: boolean
}

export function useDocumentComments({ documentId, editor, canComment, canShare }: UseDocumentCommentsInput) {
  const t = useT()
  const [state, setState] = React.useState<CommentsState>({ status: 'loading' })
  const [body, setBody] = React.useState('')
  const [pendingMentions, setPendingMentions] = React.useState<PendingMention[]>([])
  const [parentCommentId, setParentCommentId] = React.useState<string | null>(null)
  const [pendingAnchor, setPendingAnchor] = React.useState<CommentAnchor | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [resolvingCommentId, setResolvingCommentId] = React.useState<string | null>(null)
  const [grantAccessNames, setGrantAccessNames] = React.useState<string[] | null>(null)
  const grantResolver = React.useRef<((share: boolean) => void) | null>(null)
  const mutationContextId = `documents-comments:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const reload = React.useCallback(async () => {
    setState((current) => current.status === 'ready' ? current : { status: 'loading' })
    try {
      const maxPages = Math.ceil(DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT / DOCUMENTS_COMMENT_LIST_PAGE_SIZE)
      let comments: DocumentComment[] = []
      let userLabels: UserLabels = {}
      for (let page = 1; page <= maxPages; page += 1) {
        const call = await apiCall<unknown>(
          `/api/documents/${encodeURIComponent(documentId)}/comments?page=${page}&pageSize=${DOCUMENTS_COMMENT_LIST_PAGE_SIZE}`,
        )
        if (!call.ok) return setState({ status: 'error', message: t('documents.comments.error.load') })
        comments = [...readCommentItems(call.result), ...comments]
        userLabels = { ...userLabels, ...readUserLabels(call.result, t('documents.users.unknown')) }
        const root = readRecord(call.result)
        const totalPages = Math.max(1, root ? readNumber(root, 'totalPages', 'total_pages') ?? 1 : 1)
        if (page >= totalPages) break
      }
      setState({ status: 'ready', comments, userLabels })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : t('documents.comments.error.load') })
    }
  }, [documentId, t])

  React.useEffect(() => { void reload() }, [reload])
  React.useEffect(() => () => { grantResolver.current?.(false) }, [])

  const labelFor = React.useCallback((userId: string) => {
    const labels = state.status === 'ready' ? state.userLabels : {}
    return labels[userId.toLowerCase()]?.label ?? t('documents.users.unknown')
  }, [state, t])

  const resetComposer = React.useCallback(() => {
    setBody('')
    setPendingMentions([])
    setParentCommentId(null)
    setPendingAnchor(null)
  }, [])

  const chooseGrantAccess = React.useCallback((share: boolean) => {
    const resolve = grantResolver.current
    grantResolver.current = null
    setGrantAccessNames(null)
    resolve?.(share)
  }, [])

  const requestGrantAccess = React.useCallback((names: string[]) => new Promise<boolean>((resolve) => {
    grantResolver.current?.(false)
    grantResolver.current = resolve
    setGrantAccessNames(names)
  }), [])

  const resolveGrantAccessTo = React.useCallback(async (): Promise<string[] | undefined> => {
    const userIds = Array.from(new Set(pendingMentions.map((mention) => mention.userId.toLowerCase())))
    if (userIds.length === 0) return undefined
    // Intentionally outside useGuardedMutation: access-check is read-shaped
    // (a POST only to carry the user-id list in the body) and mutates nothing.
    const call = await apiCall<unknown>(
      `/api/documents/${encodeURIComponent(documentId)}/comments/access-check`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userIds }) },
    )
    if (!call.ok) throw new Error(t('documents.comments.error.save'))
    const withoutAccess = readWithoutAccess(call.result)
    if (withoutAccess.length === 0) return undefined
    if (!canShare) {
      flash(t('documents.comments.grant.noAccessInfo'), 'info')
      return []
    }
    const share = await requestGrantAccess(withoutAccess.map((user) => user.label ?? labelFor(user.userId)))
    return share ? withoutAccess.map((user) => user.userId) : []
  }, [canShare, documentId, labelFor, pendingMentions, requestGrantAccess, t])

  const submit = React.useCallback(async () => {
    const trimmedBody = body.trim()
    if (!trimmedBody || !canComment) return
    setIsSubmitting(true)
    try {
      const grantAccessTo = await resolveGrantAccessTo()
      const anchor = pendingAnchor ?? (editor
        ? (await import('./CommentAnchorNavigation')).captureCommentAnchor(editor)
        : null)
      const mentions = pendingMentions.map(({ userId }) => ({ userId }))
      await runMutation({
        operation: () => apiCallOrThrow(
          `/api/documents/${encodeURIComponent(documentId)}/comments`,
          {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body: trimmedBody, anchor, parentCommentId, mentions, grantAccessTo }),
          },
          { errorMessage: t('documents.comments.error.save') },
        ),
        context: { formId: mutationContextId, resourceKind: 'documents.document_comment', resourceId: documentId, retryLastMutation },
        mutationPayload: { body: trimmedBody, parentCommentId, mentions },
      })
      resetComposer()
      await reload()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('documents.comments.error.save'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [body, canComment, documentId, editor, mutationContextId, parentCommentId, pendingAnchor, pendingMentions, reload, resetComposer, resolveGrantAccessTo, retryLastMutation, runMutation, t])

  const resolveComment = React.useCallback(async (comment: DocumentComment) => {
    if (!comment.canResolve) return
    setResolvingCommentId(comment.id)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(comment.updatedAt),
          () => apiCallOrThrow(
            `/api/documents/${encodeURIComponent(documentId)}/comments`,
            { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: comment.id, resolved: comment.resolvedAt === null }) },
            { errorMessage: t('documents.comments.error.save') },
          ),
        ),
        context: { formId: mutationContextId, resourceKind: 'documents.document_comment', resourceId: comment.id, retryLastMutation },
        mutationPayload: { id: comment.id, resolved: comment.resolvedAt === null },
      })
      await reload()
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: () => { void reload() } })) {
        flash(error instanceof Error ? error.message : t('documents.comments.error.save'), 'error')
      }
    } finally {
      setResolvingCommentId(null)
    }
  }, [documentId, mutationContextId, reload, retryLastMutation, runMutation, t])

  const comments = state.status === 'ready' ? state.comments : []
  const parentComment = parentCommentId ? findCommentById(comments, parentCommentId) : null
  return {
    state, comments, body, setBody, pendingMentions, setPendingMentions, parentCommentId,
    pendingAnchor, setPendingAnchor, isSubmitting, resolvingCommentId, grantAccessNames,
    chooseGrantAccess, labelFor, resetComposer, reload, submit, resolveComment,
    startReply: (comment: DocumentComment) => { setPendingAnchor(null); setParentCommentId(comment.id) },
    replyToName: parentComment ? labelFor(parentComment.authorUserId) : null,
  }
}
