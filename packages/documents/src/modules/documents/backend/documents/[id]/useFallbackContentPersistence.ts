"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { Editor } from '@tiptap/core'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'

export const FALLBACK_AUTOSAVE_DELAY_MS = 1200

export type FallbackSaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

type ContentSnapshot = {
  contentHtml: string
  contentText: string
}

function resolveInternalNavigationTarget(target: string | URL | null | undefined): string | null {
  if (typeof window === 'undefined' || target == null) return null
  try {
    const url = target instanceof URL ? target : new URL(target, window.location.origin)
    if (url.origin !== window.location.origin) return null
    const currentPath = `${window.location.pathname}${window.location.search}`
    const nextPath = `${url.pathname}${url.search}`
    if (nextPath === currentPath) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

function readUpdatedAt(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const value = record.updatedAt ?? record.updated_at
  return typeof value === 'string' ? value : null
}

export function useFallbackContentPersistence(input: {
  documentId: string
  initialUpdatedAt: string | null
  enabled: boolean
  onConflictRefresh?: () => void
}) {
  const t = useT()
  const router = useRouter()
  const [status, setStatus] = React.useState<FallbackSaveStatus>('saved')
  const timerRef = React.useRef<number | null>(null)
  const latestSnapshotRef = React.useRef<ContentSnapshot | null>(null)
  const updatedAtRef = React.useRef<string | null>(input.initialUpdatedAt)
  const inFlightSaveRef = React.useRef<Promise<boolean> | null>(null)
  const conflictRef = React.useRef(false)
  const mountedRef = React.useRef(true)
  const enabledRef = React.useRef(input.enabled)
  const persistRef = React.useRef<() => Promise<boolean>>(async () => true)
  const navigationPendingRef = React.useRef(false)
  const popStateRollbackRef = React.useRef(false)
  const mutationContextId = `documents-editor:${input.documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const clearTimer = React.useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const schedulePendingSave = React.useCallback((delay = FALLBACK_AUTOSAVE_DELAY_MS) => {
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void persistRef.current()
    }, delay)
  }, [clearTimer])

  const persistLatest = React.useCallback(async (): Promise<boolean> => {
    if (!input.enabled) return true
    if (conflictRef.current) return false
    if (inFlightSaveRef.current) {
      const inFlightSave = inFlightSaveRef.current
      const saved = await inFlightSave
      if (!saved) return false
      if (inFlightSaveRef.current === inFlightSave) inFlightSaveRef.current = null
      return persistRef.current()
    }
    const snapshot = latestSnapshotRef.current
    if (!snapshot) return true
    clearTimer()
    latestSnapshotRef.current = null
    if (mountedRef.current) setStatus('saving')
    const operation = (async (): Promise<boolean> => {
      try {
        const call = await runMutation({
          operation: () => withScopedApiRequestHeaders(
            buildOptimisticLockHeader(updatedAtRef.current),
            async () => {
              const result = await apiCall<unknown>(
                `/api/documents/${encodeURIComponent(input.documentId)}/content`,
                {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(snapshot),
                },
              )
              if (!result.ok) {
                throw Object.assign(new Error(t('documents.editor.error.save')), {
                  status: result.status,
                  body: result.result,
                })
              }
              return result
            },
          ),
          context: {
            formId: mutationContextId,
            resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
            resourceId: input.documentId,
            retryLastMutation,
          },
          mutationPayload: snapshot,
        })
        updatedAtRef.current = readUpdatedAt(call.result) ?? updatedAtRef.current
        return true
      } catch (error) {
        const isConflict = surfaceRecordConflict(error, t, {
          onRefresh: input.onConflictRefresh ?? null,
        })
        if (isConflict) {
          conflictRef.current = true
          latestSnapshotRef.current = null
        } else {
          latestSnapshotRef.current ??= snapshot
          flash(error instanceof Error ? error.message : t('documents.editor.error.save'), 'error')
        }
        if (mountedRef.current) setStatus('error')
        return false
      }
    })()
    inFlightSaveRef.current = operation
    const saved = await operation
    if (inFlightSaveRef.current === operation) inFlightSaveRef.current = null
    if (!saved) return false
    if (input.enabled && !conflictRef.current && latestSnapshotRef.current) {
      return persistRef.current()
    }
    if (mountedRef.current) setStatus('saved')
    return true
  }, [clearTimer, input.documentId, input.enabled, input.onConflictRefresh, mutationContextId, retryLastMutation, runMutation, t])
  persistRef.current = persistLatest
  enabledRef.current = input.enabled

  const onEditorUpdate = React.useCallback((editor: Editor) => {
    if (!input.enabled || conflictRef.current) return
    latestSnapshotRef.current = {
      contentHtml: editor.getHTML(),
      contentText: editor.getText(),
    }
    setStatus('unsaved')
    schedulePendingSave()
  }, [input.enabled, schedulePendingSave])

  const saveNow = React.useCallback(async (): Promise<boolean> => {
    clearTimer()
    return persistRef.current()
  }, [clearTimer])

  React.useEffect(() => {
    updatedAtRef.current = input.initialUpdatedAt
    conflictRef.current = false
    latestSnapshotRef.current = null
    setStatus('saved')
  }, [input.documentId, input.initialUpdatedAt])

  React.useEffect(() => {
    if (input.enabled) return
    clearTimer()
    latestSnapshotRef.current = null
    setStatus('saved')
  }, [clearTimer, input.enabled])

  React.useEffect(() => {
    if (!input.enabled) return

    const hasUnsavedContent = () => (
      conflictRef.current
      || latestSnapshotRef.current !== null
      || inFlightSaveRef.current !== null
    )
    const flushBeforeNavigation = (navigate: () => void) => {
      if (navigationPendingRef.current) return
      navigationPendingRef.current = true
      clearTimer()
      void persistRef.current()
        .then((saved) => {
          if (saved && !hasUnsavedContent()) navigate()
        })
        .finally(() => {
          navigationPendingRef.current = false
        })
    }
    const beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedContent()) return
      event.preventDefault()
      event.returnValue = ''
    }
    const clickHandler = (event: MouseEvent) => {
      if (event.defaultPrevented || !hasUnsavedContent()) return
      const anchor = (event.target as HTMLElement)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
      if (anchor.target === '_blank' || anchor.hasAttribute('download') || event.metaKey || event.ctrlKey || event.shiftKey) return
      const target = resolveInternalNavigationTarget(href)
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      flushBeforeNavigation(() => router.push(target))
    }
    const originalPushState = window.history.pushState.bind(window.history)
    const originalReplaceState = window.history.replaceState.bind(window.history)
    const createHistoryInterceptor = (original: History['pushState']): History['pushState'] => (
      (data: unknown, unused: string, url?: string | URL | null) => {
        const target = resolveInternalNavigationTarget(url ?? null)
        if (!target || !hasUnsavedContent()) return original(data, unused, url)
        flushBeforeNavigation(() => original(data, unused, url))
        return undefined
      }
    ) as History['pushState']
    const popStateHandler = () => {
      if (popStateRollbackRef.current) {
        popStateRollbackRef.current = false
        return
      }
      if (!hasUnsavedContent()) return
      popStateRollbackRef.current = true
      window.history.go(1)
      flushBeforeNavigation(() => window.history.back())
    }

    window.addEventListener('beforeunload', beforeUnloadHandler)
    document.addEventListener('click', clickHandler, true)
    window.history.pushState = createHistoryInterceptor(originalPushState)
    window.history.replaceState = createHistoryInterceptor(originalReplaceState)
    window.addEventListener('popstate', popStateHandler)
    return () => {
      window.removeEventListener('beforeunload', beforeUnloadHandler)
      document.removeEventListener('click', clickHandler, true)
      window.removeEventListener('popstate', popStateHandler)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
    }
  }, [clearTimer, input.enabled, router])

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
      if (enabledRef.current && !conflictRef.current && (
        latestSnapshotRef.current !== null || inFlightSaveRef.current !== null
      )) {
        void persistRef.current()
      }
    }
  }, [clearTimer])

  return { status, onEditorUpdate, saveNow }
}
