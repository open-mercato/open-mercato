"use client"

import * as React from 'react'
import Link from 'next/link'
import { FileText, Link2, Unlink } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeDocuments, type DocumentRow } from '../documentsListTypes'
import {
  normalizeReviewReferences,
  REVIEW_PLAYBOOKS_API,
  type ReviewReferenceRow,
} from './reviewPlaybookModel'

const RESOURCE_KIND = 'documents.review_playbook_reference'
const SEARCH_PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 250
const MAX_GUIDANCE_DOCUMENTS = 20
const OPTIONAL_HEADERS = {
  'x-om-forbidden-redirect': '0',
  'x-om-unauthorized-redirect': '0',
}

export function GuidanceDocuments({ playbookId, onChanged }: { playbookId: string; onChanged: () => void }) {
  const t = useT()
  const searchInputId = React.useId()
  const referencesUrl = `${REVIEW_PLAYBOOKS_API}/${encodeURIComponent(playbookId)}/references`
  const mutationContextId = `documents-review-guidance:${playbookId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })
  const [references, setReferences] = React.useState<ReviewReferenceRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<DocumentRow[]>([])
  const [searching, setSearching] = React.useState(false)
  const [busyDocumentId, setBusyDocumentId] = React.useState<string | null>(null)
  const searchRequest = React.useRef(0)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    void apiCall<unknown>(referencesUrl, undefined, { fallback: { items: [] } })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setLoadError(true)
          return
        }
        setReferences(normalizeReviewReferences(call.result))
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [referencesUrl, reloadToken])

  React.useEffect(() => {
    const search = query.trim()
    const requestId = ++searchRequest.current
    if (!search) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ search, page: '1', pageSize: String(SEARCH_PAGE_SIZE) })
      void apiCall<unknown>(`/api/documents?${params.toString()}`, { headers: OPTIONAL_HEADERS, signal: controller.signal }, { fallback: { items: [] } })
        .then((call) => {
          if (searchRequest.current !== requestId) return
          setResults(call.ok ? normalizeDocuments(call.result, [], t('documents.list.unknownOwner')) : [])
        })
        .catch(() => { if (searchRequest.current === requestId && !controller.signal.aborted) setResults([]) })
        .finally(() => { if (searchRequest.current === requestId) setSearching(false) })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, t])

  const linkedIds = React.useMemo(() => new Set(references.map((reference) => reference.documentId)), [references])
  const candidates = results.filter((row) => !linkedIds.has(row.id))
  const atLimit = references.length >= MAX_GUIDANCE_DOCUMENTS

  const linkDocument = React.useCallback(async (row: DocumentRow) => {
    setBusyDocumentId(row.id)
    try {
      await runMutation({
        operation: () => apiCallOrThrow(referencesUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ documentId: row.id, sortOrder: references.length }),
        }, { errorMessage: t('documents.reviewPlaybooks.guidance.linkError') }),
        context: { formId: mutationContextId, resourceKind: RESOURCE_KIND, resourceId: playbookId, retryLastMutation },
        mutationPayload: { playbookId, documentId: row.id },
      })
      flash(t('documents.reviewPlaybooks.guidance.linked'), 'success')
      setQuery('')
      reload()
      onChanged()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('documents.reviewPlaybooks.guidance.linkError'), 'error')
    } finally {
      setBusyDocumentId(null)
    }
  }, [mutationContextId, onChanged, playbookId, references.length, referencesUrl, reload, retryLastMutation, runMutation, t])

  const unlinkDocument = React.useCallback(async (reference: ReviewReferenceRow) => {
    setBusyDocumentId(reference.documentId)
    try {
      const params = new URLSearchParams({ documentId: reference.documentId })
      await runMutation({
        operation: () => apiCallOrThrow(`${referencesUrl}?${params.toString()}`, { method: 'DELETE' }, {
          errorMessage: t('documents.reviewPlaybooks.guidance.unlinkError'),
        }),
        context: { formId: mutationContextId, resourceKind: RESOURCE_KIND, resourceId: playbookId, retryLastMutation },
        mutationPayload: { playbookId, documentId: reference.documentId },
      })
      flash(t('documents.reviewPlaybooks.guidance.unlinked'), 'success')
      reload()
      onChanged()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('documents.reviewPlaybooks.guidance.unlinkError'), 'error')
    } finally {
      setBusyDocumentId(null)
    }
  }, [mutationContextId, onChanged, playbookId, referencesUrl, reload, retryLastMutation, runMutation, t])

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-6" data-testid="documents-review-guidance">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('documents.reviewPlaybooks.guidance.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('documents.reviewPlaybooks.guidance.description')}</p>
      </div>
      {loading && references.length === 0 ? <LoadingMessage label={t('documents.reviewPlaybooks.guidance.loading')} /> : null}
      {loadError ? (
        <ErrorMessage
          label={t('documents.reviewPlaybooks.guidance.loadError')}
          action={<Button type="button" size="sm" variant="outline" onClick={reload}>{t('documents.actions.retry')}</Button>}
        />
      ) : null}
      {!loadError && !loading && references.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('documents.reviewPlaybooks.guidance.empty')}</p>
      ) : null}
      {references.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {references.map((reference) => (
            <li key={reference.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {reference.accessible && reference.title ? (
                  <Link href={`/backend/documents/${encodeURIComponent(reference.documentId)}`} className="truncate text-sm font-medium hover:underline">
                    {reference.title}
                  </Link>
                ) : (
                  <span className="truncate text-sm text-muted-foreground">{t('documents.reviewPlaybooks.guidance.restricted')}</span>
                )}
              </span>
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('documents.reviewPlaybooks.guidance.unlink')}
                disabled={busyDocumentId !== null}
                onClick={() => void unlinkDocument(reference)}
              >
                <Unlink className="size-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      <FormField
        id={searchInputId}
        label={t('documents.reviewPlaybooks.guidance.searchLabel')}
        description={atLimit ? t('documents.reviewPlaybooks.guidance.limitReached', { limit: MAX_GUIDANCE_DOCUMENTS }) : undefined}
      >
        <Input
          value={query}
          disabled={atLimit}
          placeholder={t('documents.reviewPlaybooks.guidance.searchPlaceholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </FormField>
      {query.trim() && !atLimit ? (
        <div className="space-y-2" aria-live="polite">
          {searching ? <LoadingMessage label={t('documents.reviewPlaybooks.guidance.searching')} /> : null}
          {!searching && candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('documents.reviewPlaybooks.guidance.noResults')}</p>
          ) : null}
          {!searching && candidates.length > 0 ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {candidates.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate text-sm">{row.title}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyDocumentId !== null}
                    onClick={() => void linkDocument(row)}
                  >
                    <Link2 className="size-4" aria-hidden="true" />
                    {t('documents.reviewPlaybooks.guidance.link')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export default GuidanceDocuments
