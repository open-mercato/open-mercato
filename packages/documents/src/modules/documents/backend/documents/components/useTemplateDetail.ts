"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { normalizeTemplateDetail, type TemplateRow } from './templateUi'

export function useTemplateDetail(open: boolean, templateId: string | null) {
  const requestId = React.useRef(0)
  const [loadAttempt, setLoadAttempt] = React.useState(0)
  const [state, setState] = React.useState<{
    templateId: string | null
    template: TemplateRow | null
    status: 'idle' | 'loading' | 'ready' | 'error'
  }>({ templateId: null, template: null, status: 'idle' })

  React.useEffect(() => {
    const currentRequestId = ++requestId.current
    if (!open || !templateId) {
      setState({ templateId: null, template: null, status: 'idle' })
      return
    }

    const controller = new AbortController()
    setState({ templateId, template: null, status: 'loading' })
    void apiCall<unknown>(
      `/api/documents/templates/${encodeURIComponent(templateId)}`,
      { signal: controller.signal },
      { fallback: null },
    ).then((call) => {
      if (controller.signal.aborted || requestId.current !== currentRequestId) return
      const detail = call.ok ? normalizeTemplateDetail(call.result) : null
      if (!detail || detail.id !== templateId) throw new Error('[internal] failed to load document template detail')
      setState({ templateId, template: detail, status: 'ready' })
    }).catch(() => {
      if (!controller.signal.aborted && requestId.current === currentRequestId) {
        setState({ templateId, template: null, status: 'error' })
      }
    })

    return () => { controller.abort() }
  }, [loadAttempt, open, templateId])

  const retry = React.useCallback(() => {
    setLoadAttempt((current) => current + 1)
  }, [])

  const matchesRequest = state.templateId === templateId
  return {
    template: matchesRequest ? state.template : null,
    isLoading: Boolean(open && templateId) && (!matchesRequest || state.status === 'loading'),
    error: matchesRequest && state.status === 'error',
    retry,
  }
}
