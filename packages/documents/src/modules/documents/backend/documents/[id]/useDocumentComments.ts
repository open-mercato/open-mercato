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
  bodyContainsPendingMention,
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

type GrantAccessDecision = 'share' | 'skip' | 'cancel'

type GrantAccessResolution =
  | { cancelled: true }
  | { cancelled: false; grantAccessTo?: string[] }

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
  const grantResolver = React.useRef<((decision: GrantAccessDecision) => void) | null>(null)
  const submissionContextSequence = React.useRef(0)
  const reloadSequence = React.useRef(0)
  const activeReload = React.useRef<AbortController | null>(null)
  const activeDocumentId = React.useRef<string | null>(null)
  const mutationContextId = `documents-comments:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })
  const activePendingMentions = React.useMemo(
    () => pendingMentions.filter((mention) => bodyContainsPendingMention(body, mention)),
    [body, pendingMentions],
  )

  const reload = React.useCallback(async () => {
    const reloadId = ++reloadSequence.current
    const controller = new AbortController()
    activeReload.current?.abort()
    activeReload.current = controller
    const isCurrent = () => reloadSequence.current === reloadId && !controller.signal.aborted
    const documentChanged = activeDocumentId.current !== documentId
    activeDocumentId.current = documentId
    setState((current) => !documentChanged && current.status === 'ready' ? current : { status: 'loading' })
    try {
      const maxPages = Math.ceil(DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT / DOCUMENTS_COMMENT_LIST_PAGE_SIZE)
      const pathForPage = (page: number) => (
        `/api/documents/${encodeURIComponent(documentId)}/comments?page=${page}&pageSize=${DOCUMENTS_COMMENT_LIST_PAGE_SIZE}`
      )
      const firstCall = await apiCall<unknown>(pathForPage(1), { signal: controller.signal })
      if (!isCurrent()) return
      if (!firstCall.ok) {
        setState({ status: 'error', message: t('documents.comments.error.load') })
        return
      }

      const firstRoot = readRecord(firstCall.result)
      const totalPages = Math.min(
        maxPages,
        Math.max(1, firstRoot ? readNumber(firstRoot, 'totalPages', 'total_pages') ?? 1 : 1),
      )
      const remainingCalls = totalPages > 1
        ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => (
            apiCall<unknown>(pathForPage(index + 2), { signal: controller.signal })
          )))
        : []
      if (!isCurrent()) return
      if (remainingCalls.some((call) => !call.ok)) {
        setState({ status: 'error', message: t('documents.comments.error.load') })
        return
      }

      const calls = [firstCall, ...remainingCalls]
      const comments = [...calls].reverse().flatMap((call) => readCommentItems(call.result))
      const userLabels = calls.reduce<UserLabels>((labels, call) => ({
        ...labels,
        ...readUserLabels(call.result, t('documents.users.unknown')),
      }), {})
      setState({ status: 'ready', comments, userLabels })
    } catch (error) {
      if (isCurrent()) {
        setState({ status: 'error', message: error instanceof Error ? error.message : t('documents.comments.error.load') })
      }
    } finally {
      if (activeReload.current === controller) activeReload.current = null
    }
  }, [documentId, t])

  React.useEffect(() => {
    void reload()
    return () => {
      reloadSequence.current += 1
      activeReload.current?.abort()
      activeReload.current = null
    }
  }, [reload])

  const cancelPendingGrantAccess = React.useCallback(() => {
    const resolve = grantResolver.current
    grantResolver.current = null
    resolve?.('cancel')
  }, [])

  React.useEffect(() => {
    setGrantAccessNames(null)
    setIsSubmitting(false)
    return () => {
      submissionContextSequence.current += 1
      cancelPendingGrantAccess()
    }
  }, [cancelPendingGrantAccess, documentId])

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
    resolve?.(share ? 'share' : 'skip')
  }, [])

  const requestGrantAccess = React.useCallback((names: string[]) => new Promise<GrantAccessDecision>((resolve) => {
    cancelPendingGrantAccess()
    grantResolver.current = resolve
    setGrantAccessNames(names)
  }), [cancelPendingGrantAccess])

  const resolveGrantAccessTo = React.useCallback(async (
    isCurrentSubmission: () => boolean,
  ): Promise<GrantAccessResolution> => {
    const userIds = Array.from(new Set(activePendingMentions.map((mention) => mention.userId.toLowerCase())))
    if (userIds.length === 0) return { cancelled: false }
    // Intentionally outside useGuardedMutation: access-check is read-shaped
    // (a POST only to carry the user-id list in the body) and mutates nothing.
    const call = await apiCall<unknown>(
      `/api/documents/${encodeURIComponent(documentId)}/comments/access-check`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userIds }) },
    )
    if (!isCurrentSubmission()) return { cancelled: true }
    if (!call.ok) throw new Error(t('documents.comments.error.save'))
    const withoutAccess = readWithoutAccess(call.result)
    if (withoutAccess.length === 0) return { cancelled: false }
    if (!canShare) {
      flash(t('documents.comments.grant.noAccessInfo'), 'info')
      return { cancelled: false, grantAccessTo: [] }
    }
    const pendingMentionNames = new Map(
      activePendingMentions.map((mention) => [mention.userId.toLowerCase(), mention.name]),
    )
    const decision = await requestGrantAccess(withoutAccess.map((user) => (
      pendingMentionNames.get(user.userId) ?? user.label ?? labelFor(user.userId)
    )))
    if (decision === 'cancel' || !isCurrentSubmission()) return { cancelled: true }
    return {
      cancelled: false,
      grantAccessTo: decision === 'share' ? withoutAccess.map((user) => user.userId) : [],
    }
  }, [activePendingMentions, canShare, documentId, labelFor, requestGrantAccess, t])

  const submit = React.useCallback(async () => {
    const trimmedBody = body.trim()
    if (!trimmedBody || !canComment) return
    const submissionSequence = submissionContextSequence.current
    const isCurrentSubmission = () => submissionContextSequence.current === submissionSequence
    setIsSubmitting(true)
    try {
      const grantResolution = await resolveGrantAccessTo(isCurrentSubmission)
      if (grantResolution.cancelled || !isCurrentSubmission()) return
      const anchor = pendingAnchor ?? (editor
        ? (await import('./CommentAnchorNavigation')).captureCommentAnchor(editor)
        : null)
      if (!isCurrentSubmission()) return
      const mentions = activePendingMentions.map(({ userId }) => ({ userId }))
      await runMutation({
        operation: () => apiCallOrThrow(
          `/api/documents/${encodeURIComponent(documentId)}/comments`,
          {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              body: trimmedBody,
              anchor,
              parentCommentId,
              mentions,
              grantAccessTo: grantResolution.grantAccessTo,
            }),
          },
          { errorMessage: t('documents.comments.error.save') },
        ),
        context: { formId: mutationContextId, resourceKind: 'documents.document_comment', resourceId: documentId, retryLastMutation },
        mutationPayload: { body: trimmedBody, parentCommentId, mentions },
      })
      if (!isCurrentSubmission()) return
      resetComposer()
      await reload()
    } catch (error) {
      if (isCurrentSubmission()) {
        flash(error instanceof Error ? error.message : t('documents.comments.error.save'), 'error')
      }
    } finally {
      if (isCurrentSubmission()) setIsSubmitting(false)
    }
  }, [activePendingMentions, body, canComment, documentId, editor, mutationContextId, parentCommentId, pendingAnchor, reload, resetComposer, resolveGrantAccessTo, retryLastMutation, runMutation, t])

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
