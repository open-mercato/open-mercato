"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  EMPTY_COLLECTION_CAPABILITIES,
  normalizeCollectionCapabilities,
  normalizeDocuments,
  type CollectionCapabilities,
  type DocumentRow,
} from '../../../backend/documents/documentsListTypes'
import type { RelatedDocumentContext } from './context'

type State = {
  context: string | null
  status: 'loading' | 'ready' | 'error' | 'hidden'
  items: DocumentRow[]
  capabilities: CollectionCapabilities
}

const OPTIONAL_HEADERS = {
  'x-om-forbidden-redirect': '0',
  'x-om-unauthorized-redirect': '0',
}

function buildTargetContext(target: RelatedDocumentContext | null): string | null {
  return target ? JSON.stringify([target.entityType, target.entityId]) : null
}

function emptyState(context: string | null, status: State['status']): State {
  return { context, status, items: [], capabilities: EMPTY_COLLECTION_CAPABILITIES }
}

export function useRelatedDocuments(target: RelatedDocumentContext | null) {
  const t = useT()
  const request = React.useRef(0)
  const activeRequest = React.useRef<AbortController | null>(null)
  const targetContext = buildTargetContext(target)
  const activeContext = React.useRef<string | null>(targetContext)
  activeContext.current = targetContext
  const [state, setState] = React.useState<State>(() => emptyState(targetContext, target ? 'loading' : 'hidden'))
  const [reload, setReload] = React.useState(0)

  React.useEffect(() => {
    activeRequest.current?.abort()
    activeRequest.current = null
    if (!target || !targetContext) {
      request.current += 1
      setState(emptyState(null, 'hidden'))
      return
    }
    const requestId = ++request.current
    const requestContext = targetContext
    const controller = new AbortController()
    activeRequest.current = controller
    const params = new URLSearchParams({
      entityType: target.entityType,
      entityId: target.entityId,
      page: '1',
      pageSize: '10',
    })
    setState(emptyState(requestContext, 'loading'))
    void apiCall<unknown>(
      `/api/documents?${params.toString()}`,
      { headers: OPTIONAL_HEADERS, signal: controller.signal },
      { fallback: { items: [] } },
    ).then((call) => {
      if (request.current !== requestId || activeContext.current !== requestContext) return
      if (call.status === 401 || call.status === 403 || call.status === 404) {
        setState(emptyState(requestContext, 'hidden'))
        return
      }
      if (!call.ok) { setState(emptyState(requestContext, 'error')); return }
      setState({
        context: requestContext,
        status: 'ready',
        items: normalizeDocuments(call.result, [], t('documents.list.unknownOwner')),
        capabilities: normalizeCollectionCapabilities(call.result),
      })
    }).catch(() => {
      if (!controller.signal.aborted && request.current === requestId && activeContext.current === requestContext) {
        setState(emptyState(requestContext, 'error'))
      }
    }).finally(() => {
      if (activeRequest.current === controller) activeRequest.current = null
    })
    return () => {
      request.current += 1
      controller.abort()
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }, [reload, t, targetContext])

  React.useEffect(() => () => { activeRequest.current?.abort() }, [])

  const visibleState = state.context === targetContext
    ? state
    : emptyState(targetContext, targetContext ? 'loading' : 'hidden')

  const retry = React.useCallback(() => {
    request.current += 1
    activeRequest.current?.abort()
    activeRequest.current = null
    setState(emptyState(targetContext, targetContext ? 'loading' : 'hidden'))
    setReload((value) => value + 1)
  }, [targetContext])

  return { ...visibleState, retry }
}

export { OPTIONAL_HEADERS }
