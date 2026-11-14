"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  normalizeFinding,
  normalizeFindingList,
  normalizeFindingSummary,
  type DocumentFindingItem,
  type FindingResolution,
  type FindingSummary,
} from './findingModel'

type DecorationsModule = typeof import('./findingDecorations')

type FindingListState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready' }

type FindingDecision = 'apply' | 'keep' | 'reopen'

type FindingFocusRequest = { findingId: string; sequence: number }

type UseDocumentFindingsInput = {
  documentId: string
  editor: Editor | null
  listEnabled: boolean
  canDecide: boolean
  onDecorationFocus?: (findingId: string) => void
}

export const FINDINGS_LIST_PAGE_SIZE = 100
const FINDING_RESOLVE_DELAY_MS = 200

function findingsUrl(documentId: string, suffix = ''): string {
  return `/api/documents/${encodeURIComponent(documentId)}/findings${suffix}`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function useDocumentFindings({
  documentId,
  editor,
  listEnabled,
  canDecide,
  onDecorationFocus,
}: UseDocumentFindingsInput) {
  const t = useT()
  const [summary, setSummary] = React.useState<FindingSummary | null>(null)
  const [summaryLoaded, setSummaryLoaded] = React.useState(false)
  const [listState, setListState] = React.useState<FindingListState>({ status: 'idle' })
  const [findings, setFindings] = React.useState<DocumentFindingItem[]>([])
  const [resolutions, setResolutions] = React.useState<Record<string, FindingResolution>>({})
  const [activeFindingId, setActiveFindingId] = React.useState<string | null>(null)
  const [focusRequest, setFocusRequest] = React.useState<FindingFocusRequest | null>(null)
  const [pendingFindingId, setPendingFindingId] = React.useState<string | null>(null)
  const [revertableFindingId, setRevertableFindingId] = React.useState<string | null>(null)
  const decorationsModule = React.useRef<Promise<DecorationsModule> | null>(null)
  const summarySequence = React.useRef(0)
  const listSequence = React.useRef(0)
  const onDecorationFocusRef = React.useRef(onDecorationFocus)
  onDecorationFocusRef.current = onDecorationFocus
  const mutationContextId = `documents-findings:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const loadDecorations = React.useCallback((): Promise<DecorationsModule> => {
    if (!decorationsModule.current) decorationsModule.current = import('./findingDecorations')
    return decorationsModule.current
  }, [])

  const reloadSummary = React.useCallback(async () => {
    const sequence = ++summarySequence.current
    const call = await apiCall<unknown>(findingsUrl(documentId, '/summary'))
    if (summarySequence.current !== sequence) return
    setSummary(call.ok ? normalizeFindingSummary(call.result) : null)
    setSummaryLoaded(true)
  }, [documentId])

  const reloadList = React.useCallback(async () => {
    const sequence = ++listSequence.current
    setListState({ status: 'loading' })
    try {
      const call = await apiCall<unknown>(findingsUrl(documentId, `?page=1&pageSize=${FINDINGS_LIST_PAGE_SIZE}`))
      if (listSequence.current !== sequence) return
      if (!call.ok) {
        setListState({ status: 'error' })
        return
      }
      setFindings(normalizeFindingList(call.result))
      setListState({ status: 'ready' })
    } catch {
      if (listSequence.current === sequence) setListState({ status: 'error' })
    }
  }, [documentId])

  const reload = React.useCallback(async () => {
    await Promise.all([reloadSummary(), reloadList()])
  }, [reloadList, reloadSummary])

  React.useEffect(() => {
    void reloadSummary().catch(() => setSummaryLoaded(true))
    return () => { summarySequence.current += 1 }
  }, [reloadSummary])

  React.useEffect(() => {
    if (!listEnabled) return
    void reloadList()
    return () => { listSequence.current += 1 }
  }, [listEnabled, reloadList])

  const resolveNow = React.useCallback(async () => {
    if (!editor || editor.isDestroyed) {
      setResolutions({})
      return
    }
    const decorations = await loadDecorations()
    if (editor.isDestroyed) return
    const result = decorations.syncFindingDecorations(editor, findings, activeFindingId)
    setResolutions(result.resolutions)
  }, [activeFindingId, editor, findings, loadDecorations])

  React.useEffect(() => {
    if (!listEnabled || listState.status !== 'ready') return
    void resolveNow()
  }, [listEnabled, listState.status, resolveNow])

  React.useEffect(() => {
    if (!editor || !listEnabled) return
    let timer: number | null = null
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        void resolveNow()
      }, FINDING_RESOLVE_DELAY_MS)
    }
    editor.on('update', schedule)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      editor.off('update', schedule)
    }
  }, [editor, listEnabled, resolveNow])

  React.useEffect(() => {
    if (!editor || !listEnabled) return
    return () => {
      void loadDecorations().then((decorations) => decorations.setFindingDecorations(editor, [], null))
    }
  }, [editor, listEnabled, loadDecorations])

  React.useEffect(() => {
    if (!editor || editor.isDestroyed || !listEnabled) return
    let root: HTMLElement
    try {
      root = editor.view.dom
    } catch {
      return
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-finding-id]') : null
      const findingId = target?.getAttribute('data-finding-id')
      if (!findingId) return
      setActiveFindingId(findingId)
      setFocusRequest((current) => ({ findingId, sequence: (current?.sequence ?? 0) + 1 }))
      onDecorationFocusRef.current?.(findingId)
    }
    root.addEventListener('click', handleClick)
    return () => root.removeEventListener('click', handleClick)
  }, [editor, listEnabled])

  const locateFinding = React.useCallback(async (finding: DocumentFindingItem) => {
    setActiveFindingId(finding.id)
    const resolution = resolutions[finding.id]
    if (resolution?.kind !== 'located') return
    const decorations = await loadDecorations()
    decorations.selectFindingRange(editor, resolution)
  }, [editor, loadDecorations, resolutions])

  const revealFinding = React.useCallback((findingId: string) => {
    setActiveFindingId(findingId)
    setFocusRequest((current) => ({ findingId, sequence: (current?.sequence ?? 0) + 1 }))
  }, [])

  const replaceFinding = React.useCallback((updated: DocumentFindingItem) => {
    setFindings((current) => current.map((finding) => (finding.id === updated.id ? updated : finding)))
  }, [])

  const postDecision = React.useCallback(async (
    decision: FindingDecision,
    finding: DocumentFindingItem,
    payload: Record<string, unknown>,
  ): Promise<DocumentFindingItem | null> => {
    const body = { expectedUpdatedAt: finding.updatedAt, ...payload }
    const call = await runMutation({
      operation: () => apiCallOrThrow<unknown>(
        findingsUrl(documentId, `/${encodeURIComponent(finding.id)}/${decision}`),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        { errorMessage: t('documents.findings.error.decision') },
      ),
      context: {
        formId: mutationContextId,
        resourceKind: 'documents.document_finding',
        resourceId: finding.id,
        retryLastMutation,
      },
      mutationPayload: { decision, findingId: finding.id, ...body },
    })
    return normalizeFinding(call?.result)
  }, [documentId, mutationContextId, retryLastMutation, runMutation, t])

  const finishDecision = React.useCallback(async (updated: DocumentFindingItem | null) => {
    if (updated) replaceFinding(updated)
    else await reloadList()
    await reloadSummary()
  }, [reloadList, reloadSummary, replaceFinding])

  const surfaceDecisionError = React.useCallback((error: unknown) => {
    if (!surfaceRecordConflict(error, t, { onRefresh: () => { void reload() } })) {
      flash(errorMessage(error, t('documents.findings.error.decision')), 'error')
    }
  }, [reload, t])

  const applyFinding = React.useCallback(async (finding: DocumentFindingItem) => {
    if (!canDecide || finding.status !== 'open' || finding.suggestedText === null || pendingFindingId) return
    const decorations = await loadDecorations()
    const resolution = decorations.resolveFindingsInEditor(editor, [finding]).resolutions[finding.id]
    if (resolution?.kind !== 'located' || !resolution.matches) {
      flash(t('documents.findings.error.textChanged'), 'error')
      void resolveNow()
      return
    }
    if (!decorations.replaceFindingText(editor, resolution, finding.suggestedText)) {
      flash(t('documents.findings.error.editorUnavailable'), 'error')
      return
    }
    setPendingFindingId(finding.id)
    setRevertableFindingId(null)
    try {
      const updated = await postDecision('apply', finding, { appliedText: finding.suggestedText })
      await finishDecision(updated)
      flash(t('documents.findings.flash.applied'), 'success')
    } catch (error) {
      setRevertableFindingId(finding.id)
      surfaceDecisionError(error)
    } finally {
      setPendingFindingId(null)
    }
  }, [canDecide, editor, finishDecision, loadDecorations, pendingFindingId, postDecision, resolveNow, surfaceDecisionError, t])

  const revertFinding = React.useCallback(async () => {
    const decorations = await loadDecorations()
    if (decorations.revertLastEditorChange(editor)) {
      flash(t('documents.findings.flash.reverted'), 'success')
    } else {
      flash(t('documents.findings.error.editorUnavailable'), 'error')
    }
    setRevertableFindingId(null)
  }, [editor, loadDecorations, t])

  const keepFinding = React.useCallback(async (finding: DocumentFindingItem, note: string): Promise<boolean> => {
    if (!canDecide || finding.status !== 'open' || pendingFindingId) return false
    setPendingFindingId(finding.id)
    try {
      const trimmed = note.trim()
      const updated = await postDecision('keep', finding, { note: trimmed.length > 0 ? trimmed : null })
      await finishDecision(updated)
      flash(t('documents.findings.flash.kept'), 'success')
      return true
    } catch (error) {
      surfaceDecisionError(error)
      return false
    } finally {
      setPendingFindingId(null)
    }
  }, [canDecide, finishDecision, pendingFindingId, postDecision, surfaceDecisionError, t])

  const reopenFinding = React.useCallback(async (finding: DocumentFindingItem) => {
    if (!canDecide || finding.status === 'open' || finding.status === 'superseded' || pendingFindingId) return
    setPendingFindingId(finding.id)
    try {
      const updated = await postDecision('reopen', finding, {})
      await finishDecision(updated)
      flash(t('documents.findings.flash.reopened'), 'success')
    } catch (error) {
      surfaceDecisionError(error)
    } finally {
      setPendingFindingId(null)
    }
  }, [canDecide, finishDecision, pendingFindingId, postDecision, surfaceDecisionError, t])

  return {
    summary,
    summaryLoaded,
    listState,
    findings,
    resolutions,
    activeFindingId,
    focusRequest,
    pendingFindingId,
    revertableFindingId,
    reload,
    locateFinding,
    revealFinding,
    applyFinding,
    keepFinding,
    reopenFinding,
    revertFinding,
  }
}

export type DocumentFindingsModel = ReturnType<typeof useDocumentFindings>
