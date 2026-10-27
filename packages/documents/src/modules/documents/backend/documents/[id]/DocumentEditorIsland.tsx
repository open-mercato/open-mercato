"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DocumentEditorSurface } from './DocumentEditorSurface'
import { resolveEditorMode, type DocumentEditorIslandProps, type EditorMode } from './editorTypes'
import { useDocumentCollaboration } from './useDocumentCollaboration'

export default function DocumentEditorIsland(props: DocumentEditorIslandProps) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const collaboration = useDocumentCollaboration(props.documentId)
  const requestedMode: EditorMode = searchParams.get('mode') === 'preview' ? 'preview' : 'edit'
  const serverReadOnly = collaboration.mode === 'collab'
    ? collaboration.serverReadOnly
    : collaboration.mode === 'fallback'
      ? collaboration.readOnly
      : false
  const forcedReadOnly = props.readOnly || serverReadOnly
  const mode = resolveEditorMode(props.readOnly, serverReadOnly, requestedMode)
  const changeMode = React.useCallback((nextMode: EditorMode) => {
    if (forcedReadOnly) return
    const next = new URLSearchParams(searchParams.toString())
    if (nextMode === 'preview') next.set('mode', 'preview')
    else next.delete('mode')
    const query = next.toString()
    router.replace(query ? `?${query}` : '?', { scroll: false })
  }, [forcedReadOnly, router, searchParams])

  if (collaboration.mode === 'connecting') return <LoadingMessage label={t('documents.editor.loading')} />
  if (collaboration.mode === 'fallback') {
    return <DocumentEditorSurface {...props} readOnly={forcedReadOnly} key={`fallback:${props.documentId}`} transport="fallback" connectionStatus="offline" presenceUsers={[]} mode={mode} onModeChange={changeMode} />
  }
  return (
    <DocumentEditorSurface
      {...props}
      readOnly={forcedReadOnly}
      key={`collab:${props.documentId}`}
      transport="collab"
      collabResources={collaboration.resources}
      connectionStatus={collaboration.connectionStatus}
      presenceUsers={collaboration.presenceUsers}
      mode={mode}
      onModeChange={changeMode}
    />
  )
}
