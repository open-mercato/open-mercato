"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  MARKDOWN_IMPORT_MAX_FILES,
  validateMarkdownImportFile,
  validateMarkdownImportSource,
  type MarkdownImportRejection,
} from '../../lib/markdownImportValidation'
import { readCreatedId } from './documentsListTypes'

export type MarkdownImportProgress = { current: number; total: number }

type ImportOutcome = { ok: true; id: string } | { ok: false; message: string }

const MUTATION_CONTEXT_ID = 'documents-list:markdown-import'

function formatMegabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

export function useMarkdownImport(input: { folderId: string | null; enabled: boolean; onImported: () => void }) {
  const t = useT()
  const router = useRouter()
  const [progress, setProgress] = React.useState<MarkdownImportProgress | null>(null)
  const inFlight = React.useRef(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: MUTATION_CONTEXT_ID, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const describeRejection = React.useCallback((name: string, rejection: MarkdownImportRejection): string => {
    if (rejection.code === 'tooLarge') return t('documents.import.markdown.error.tooLarge', { name, max: formatMegabytes(rejection.maxBytes) })
    if (rejection.code === 'empty') return t('documents.import.markdown.error.empty', { name })
    return t('documents.import.markdown.error.unsupported', { name })
  }, [t])

  const importOne = React.useCallback(async (file: File, folderId: string | null): Promise<ImportOutcome> => {
    const fileRejection = validateMarkdownImportFile(file)
    if (fileRejection) return { ok: false, message: describeRejection(file.name, fileRejection) }
    let source: string
    try {
      source = await file.text()
    } catch {
      return { ok: false, message: t('documents.import.markdown.error.read', { name: file.name }) }
    }
    const sourceRejection = validateMarkdownImportSource(source)
    if (sourceRejection) return { ok: false, message: describeRejection(file.name, sourceRejection) }
    let converter: typeof import('../../lib/markdownImport')
    try {
      converter = await import('../../lib/markdownImport')
    } catch {
      return { ok: false, message: t('documents.import.markdown.error.read', { name: file.name }) }
    }
    const converted = converter.convertMarkdownImport(file.name, source)
    if (!converter.isConvertedHtmlWithinLimit(converted.contentHtml)) {
      return { ok: false, message: t('documents.import.markdown.error.convertedTooLarge', { name: file.name }) }
    }

    let documentId: string | null = null
    try {
      const created = await runMutation({
        operation: () => apiCallOrThrow<unknown>(
          '/api/documents',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: converted.title, folderId }) },
          { errorMessage: t('documents.import.markdown.error.create', { name: file.name }) },
        ),
        context: { formId: MUTATION_CONTEXT_ID, resourceKind: 'documents.document', resourceId: folderId ?? 'new', retryLastMutation },
        mutationPayload: { action: 'import-markdown', title: converted.title, folderId },
      })
      documentId = readCreatedId(created.result)
    } catch {
      return { ok: false, message: t('documents.import.markdown.error.create', { name: file.name }) }
    }
    if (!documentId) return { ok: false, message: t('documents.import.markdown.error.create', { name: file.name }) }

    const createdId = documentId
    try {
      await runMutation({
        operation: () => apiCallOrThrow(
          `/api/documents/${encodeURIComponent(createdId)}/content`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contentHtml: converted.contentHtml, contentText: converted.contentText }),
          },
          { errorMessage: t('documents.import.markdown.error.content', { name: file.name }) },
        ),
        context: { formId: MUTATION_CONTEXT_ID, resourceKind: 'documents.document_content', resourceId: createdId, retryLastMutation },
        mutationPayload: { action: 'import-markdown', id: createdId },
      })
    } catch {
      await apiCallOrThrow(`/api/documents/${encodeURIComponent(createdId)}`, { method: 'DELETE' }).catch(() => undefined)
      return { ok: false, message: t('documents.import.markdown.error.content', { name: file.name }) }
    }
    return { ok: true, id: createdId }
  }, [describeRejection, retryLastMutation, runMutation, t])

  const importFiles = React.useCallback(async (files: File[]) => {
    if (!input.enabled || inFlight.current || files.length === 0) return
    if (files.length > MARKDOWN_IMPORT_MAX_FILES) {
      flash(t('documents.import.markdown.error.tooMany', { max: MARKDOWN_IMPORT_MAX_FILES }), 'error')
      return
    }
    inFlight.current = true
    const folderId = input.folderId
    const importedIds: string[] = []
    const errors: string[] = []
    try {
      for (const [index, file] of files.entries()) {
        setProgress({ current: index + 1, total: files.length })
        const outcome = await importOne(file, folderId)
        if (outcome.ok) importedIds.push(outcome.id)
        else errors.push(outcome.message)
      }
    } finally {
      inFlight.current = false
      setProgress(null)
    }

    if (errors.length === 0) {
      flash(
        importedIds.length === 1
          ? t('documents.import.markdown.success.one')
          : t('documents.import.markdown.success.many', { count: importedIds.length }),
        'success',
      )
    } else if (importedIds.length === 0) {
      flash(t('documents.import.markdown.error.none', { details: errors.join(' ') }), 'error')
    } else {
      flash(t('documents.import.markdown.partial', { imported: importedIds.length, total: files.length, details: errors.join(' ') }), 'warning')
    }
    if (files.length === 1 && importedIds.length === 1) {
      router.push(`/backend/documents/${encodeURIComponent(importedIds[0])}`)
      return
    }
    if (importedIds.length > 0) input.onImported()
  }, [importOne, input, router, t])

  return { importFiles, progress, isImporting: progress !== null }
}
