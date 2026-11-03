"use client"

import * as React from 'react'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

function readUpdatedAt(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const value = record.updatedAt ?? record.updated_at
  return typeof value === 'string' ? value : null
}

export function useDocumentTitle(input: {
  documentId: string
  title: string
  updatedAt: string | null
  readOnly: boolean
  onTitleChange?: (title: string, updatedAt: string | null) => void
}) {
  const t = useT()
  const committed = React.useRef(input.title)
  const version = React.useRef(input.updatedAt)
  const draft = React.useRef(input.title)
  const [value, setValueState] = React.useState(input.title)
  const [saving, setSaving] = React.useState(false)
  const setValue = React.useCallback((next: string) => {
    draft.current = next
    setValueState(next)
  }, [])
  const mutationContextId = `documents-title:${input.documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })
  React.useEffect(() => { committed.current = input.title; setValue(input.title) }, [input.title, setValue])
  React.useEffect(() => { version.current = input.updatedAt }, [input.updatedAt])

  const commit = React.useCallback(async () => {
    const title = draft.current.trim()
    if (input.readOnly || saving || !title || title === committed.current) { setValue(committed.current); return }
    setSaving(true)
    try {
      const call = await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(version.current), async () => {
          const result = await apiCall<unknown>(
            `/api/documents/${encodeURIComponent(input.documentId)}`,
            { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: input.documentId, title }) },
          )
          if (!result.ok) throw Object.assign(new Error(t('documents.editor.error.rename')), { status: result.status, body: result.result })
          return result
        }),
        context: { formId: mutationContextId, resourceKind: 'documents.document', resourceId: input.documentId, retryLastMutation },
        mutationPayload: { id: input.documentId, title },
      })
      version.current = readUpdatedAt(call.result) ?? version.current
      committed.current = title
      setValue(title)
      input.onTitleChange?.(title, version.current)
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) flash(error instanceof Error ? error.message : t('documents.editor.error.rename'), 'error')
      setValue(committed.current)
    } finally { setSaving(false) }
  }, [input.documentId, input.onTitleChange, input.readOnly, mutationContextId, retryLastMutation, runMutation, saving, setValue, t])

  const onKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
    if (event.key === 'Escape') { event.preventDefault(); setValue(committed.current); event.currentTarget.blur() }
  }, [setValue])
  return { value, setValue, saving, commit, onKeyDown }
}
