"use client"

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { DOCUMENT_SECTION_PAGE_BASE_PATH } from '../../../../../../lib/documentStructure/sectionLink'

type CitedSection = {
  numberLabel: string | null
  heading: string | null
  headingPath: string[]
  text?: string
  textTruncated: boolean
  pageStart: number | null
  pageEnd: number | null
  citation: string
}

type SectionsResponse = { items?: CitedSection[] }

type LoadState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ready'; section: CitedSection }

const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ANCHOR_KEY_PATTERN = /^[0-9a-f]{32}$/
const SECTION_MAX_CHARS = 16000

function buildFileHref(attachmentId: string, pageStart: number | null): string {
  const base = `/api/attachments/file/${encodeURIComponent(attachmentId)}`
  return pageStart !== null ? `${base}#page=${pageStart}` : base
}

export default function AttachmentDocumentSectionPage({
  params,
}: {
  params?: { id?: string; anchorKey?: string }
}) {
  const t = useT()
  const attachmentId = typeof params?.id === 'string' ? params.id : ''
  const anchorKey = typeof params?.anchorKey === 'string' ? params.anchorKey : ''
  const validParams = ATTACHMENT_ID_PATTERN.test(attachmentId) && ANCHOR_KEY_PATTERN.test(anchorKey)
  const [state, setState] = React.useState<LoadState>(validParams ? { status: 'loading' } : { status: 'not_found' })

  React.useEffect(() => {
    if (!validParams) {
      setState({ status: 'not_found' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    const query = new URLSearchParams({
      anchorKey,
      limit: '1',
      includeText: 'true',
      maxCharsPerSection: String(SECTION_MAX_CHARS),
    })
    apiCall<SectionsResponse>(
      `/api/attachments/structure/${encodeURIComponent(attachmentId)}/sections?${query.toString()}`,
    )
      .then((call) => {
        if (cancelled) return
        if (call.status === 404) {
          setState({ status: 'not_found' })
          return
        }
        if (!call.ok) {
          setState({ status: 'error' })
          return
        }
        const section = call.result?.items?.[0]
        setState(section ? { status: 'ready', section } : { status: 'not_found' })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [anchorKey, attachmentId, validParams])

  const backLabel = t('attachments.structure.citation.back', 'Back to attachments')

  if (state.status === 'loading') {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('attachments.structure.citation.loading', 'Loading the cited section…')} />
        </PageBody>
      </Page>
    )
  }
  if (state.status === 'not_found') {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('attachments.structure.citation.notFound', 'Cited section not found')}
            description={t(
              'attachments.structure.citation.notFoundDescription',
              'The document may have been removed or re-extracted, or you may not have access to it.',
            )}
            backHref={DOCUMENT_SECTION_PAGE_BASE_PATH}
            backLabel={backLabel}
          />
        </PageBody>
      </Page>
    )
  }
  if (state.status === 'error') {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={t('attachments.structure.citation.loadError', 'Failed to load the cited section.')} />
        </PageBody>
      </Page>
    )
  }

  const { section } = state
  const title =
    section.citation ||
    [section.numberLabel, section.heading].filter(Boolean).join(' ') ||
    t('attachments.structure.outline.untitled', 'Untitled section')
  const pages =
    section.pageStart === null
      ? null
      : section.pageEnd !== null && section.pageEnd !== section.pageStart
        ? t('attachments.structure.outline.pageRange', 'pp. {start}–{end}', { start: section.pageStart, end: section.pageEnd })
        : t('attachments.structure.outline.page', 'p. {page}', { page: section.pageStart })

  return (
    <Page>
      <PageHeader
        title={title}
        description={section.headingPath.length > 0 ? section.headingPath.join(' › ') : undefined}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={DOCUMENT_SECTION_PAGE_BASE_PATH}>{backLabel}</Link>
            </Button>
            <Button asChild>
              <a href={buildFileHref(attachmentId, section.pageStart)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" aria-hidden />
                {section.pageStart !== null
                  ? t('attachments.structure.citation.openFileAtPage', 'Open document at page {page}', { page: section.pageStart })
                  : t('attachments.structure.citation.openFile', 'Open document')}
              </a>
            </Button>
          </>
        }
      />
      <PageBody>
        <section
          className="space-y-3 rounded-md border border-border bg-card p-4"
          data-testid="attachment-cited-section"
        >
          {pages ? <p className="text-xs text-muted-foreground">{pages}</p> : null}
          {section.text ? (
            <div className="whitespace-pre-wrap break-words text-sm text-foreground">{section.text}</div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('attachments.structure.citation.noText', 'This section has no extracted text.')}
            </p>
          )}
          {section.textTruncated ? (
            <p className="text-xs text-muted-foreground">
              {t('attachments.structure.citation.truncated', 'The section text is shortened. Open the document to read all of it.')}
            </p>
          ) : null}
        </section>
      </PageBody>
    </Page>
  )
}
