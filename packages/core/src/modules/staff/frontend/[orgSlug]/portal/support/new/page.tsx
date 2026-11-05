"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Paperclip, Trash2 } from 'lucide-react'
import { replaceWithPageReload } from '@open-mercato/shared/lib/navigation/pageReload'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard } from '@open-mercato/ui/portal/components/PortalCard'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  ATTACHMENT_ACCEPT_TYPES,
  resolvePortalMaxUploadBytes,
  validateAttachmentFile,
} from '@open-mercato/core/modules/staff/lib/support-ui/portalAttachmentValidation'
import { rememberFailedUploads } from '@open-mercato/core/modules/staff/lib/support-ui/portalPendingUploads'
import {
  formatFileSize,
  isPortalSupportAccountNotLinked,
  type PortalSupportOptions,
} from '@open-mercato/core/modules/staff/lib/support-ui/portalSupport'
import { PortalSupportNotLinked } from '@open-mercato/core/modules/staff/lib/support-ui/PortalSupportNotLinked'

type Props = { params: { orgSlug: string } }

type CreateResponse = { ok?: boolean; id?: string; supportReference?: string; error?: string }


const MUTATION_CONTEXT_ID = 'staff-portal-support-new'

export default function PortalSupportNewTicketPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const guardedMutation = useGuardedMutation<Record<string, unknown>>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.portal.support.blocked', 'This action is not available right now.'),
  })

  const [options, setOptions] = React.useState<PortalSupportOptions | null>(null)
  const [optionsLoading, setOptionsLoading] = React.useState(true)
  const [optionsError, setOptionsError] = React.useState<string | null>(null)
  const [notLinked, setNotLinked] = React.useState(false)
  const [optionsAttempt, setOptionsAttempt] = React.useState(0)
  const [categoryValue, setCategoryValue] = React.useState('')
  const [subject, setSubject] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [files, setFiles] = React.useState<File[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!loading && !user) replaceWithPageReload(`/${params.orgSlug}/portal/login`)
  }, [loading, user, params.orgSlug])

  React.useEffect(() => {
    if (!user) return
    let cancelled = false
    void (async () => {
      setOptionsLoading(true)
      setOptionsError(null)
      try {
        const response = await apiCall<PortalSupportOptions>('/api/staff/portal/support-tickets/options', { credentials: 'include' })
        if (cancelled) return
        setNotLinked(isPortalSupportAccountNotLinked(response))
        if (response.ok && response.result) {
          setOptions(response.result)
        } else {
          setOptions(null)
          if (!isPortalSupportAccountNotLinked(response)) {
            setOptionsError(t('staff.portal.support.new.optionsLoadFailed', 'Could not load the support form.'))
          }
        }
      } catch (err) {
        if (cancelled) return
        getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_support_options_failed' })
        setOptions(null)
        setOptionsError(t('staff.portal.support.new.optionsLoadFailed', 'Could not load the support form.'))
      } finally {
        if (!cancelled) setOptionsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, optionsAttempt, t])

  const maxUploadBytes = resolvePortalMaxUploadBytes(options?.maxUploadBytes)

  const addFiles = React.useCallback(async (list: FileList | null) => {
    if (!list) return
    const accepted: File[] = []
    for (const file of Array.from(list)) {
      const validationError = await validateAttachmentFile(file, t, maxUploadBytes)
      if (validationError) {
        flash(`${file.name}: ${validationError}`, 'error')
        continue
      }
      accepted.push(file)
    }
    if (accepted.length) setFiles((current) => [...current, ...accepted])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [t, maxUploadBytes])

  const subjectValid = subject.trim().length >= 3
  const descriptionValid = description.trim().length >= 1
  const canSubmit = Boolean(categoryValue) && subjectValid && descriptionValid && !submitting

  const submit = React.useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const payload = { categoryValue, subject: subject.trim(), description: description.trim() }
    try {
      const created = await guardedMutation.runMutation({
        operation: () =>
          apiCall<CreateResponse>('/api/staff/portal/support-tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
          }),
        context: {
          moduleId: 'staff',
          entityId: 'staff.support_ticket',
          operation: 'portal_support_ticket_create',
          formId: MUTATION_CONTEXT_ID,
          retryLastMutation: guardedMutation.retryLastMutation,
        },
        mutationPayload: payload,
      })
      const ticketId = created.ok ? created.result?.id ?? null : null
      if (!ticketId) {
        if (created.status === 429) {
          setError(t('staff.portal.support.new.rateLimited', 'You have filed many tickets recently. Please try again later.'))
        } else if (created.status === 422) {
          setError(t('staff.support.errors.categoryUnavailable', 'Support requests in this category are not available right now.'))
        } else {
          setError(t('staff.portal.support.new.createFailed', 'Could not file the ticket. Please try again.'))
        }
        return
      }
      const failed: File[] = []
      for (const file of files) {
        const form = new FormData()
        form.set('file', file)
        try {
          const uploaded = await guardedMutation.runMutation({
            operation: () =>
              apiCall(`/api/staff/portal/support-tickets/${encodeURIComponent(ticketId)}/attachments`, {
                method: 'POST',
                credentials: 'include',
                body: form,
              }),
            context: {
              moduleId: 'staff',
              entityId: 'attachments.attachment',
              operation: 'portal_support_attachment_upload',
              formId: MUTATION_CONTEXT_ID,
              ticketId,
              retryLastMutation: guardedMutation.retryLastMutation,
            },
            mutationPayload: { ticketId, fileName: file.name },
          })
          if (!uploaded.ok) failed.push(file)
        } catch (err) {
          getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_support_upload_failed' })
          failed.push(file)
        }
      }
      rememberFailedUploads(ticketId, failed)
      flash(
        t('staff.portal.support.new.created', 'Ticket {reference} filed.', { reference: created.result?.supportReference ?? '' }),
        'success',
      )
      router.push(`/${params.orgSlug}/portal/support/${ticketId}`)
    } catch (err) {
      getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_support_create_failed' })
      setError(t('staff.portal.support.new.createFailed', 'Could not file the ticket. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, categoryValue, subject, description, files, guardedMutation, params.orgSlug, router, t])

  if (loading || optionsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }
  if (!user) return null

  const categories = options?.categories ?? []

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" asChild>
          <Link href={`/${params.orgSlug}/portal/support`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('staff.portal.support.backToList', 'All tickets')}
          </Link>
        </Button>
      </div>
      <PortalPageHeader
        title={t('staff.portal.support.new.title', 'New support ticket')}
        description={t('staff.portal.support.new.description', 'Tell us what you need. Please do not include passwords or other secrets.')}
      />
      {error ? <ErrorMessage label={error} /> : null}
      {notLinked ? (
        <PortalSupportNotLinked />
      ) : optionsError ? (
        <ErrorMessage
          label={optionsError}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setOptionsAttempt((attempt) => attempt + 1)}>
              {t('staff.portal.support.retry', 'Try again')}
            </Button>
          }
        />
      ) : !options?.canCreate || categories.length === 0 ? (
        <EmptyState
          variant="subtle"
          size="lg"
          title={t('staff.portal.support.unavailableTitle', 'Support requests are not available yet')}
          description={t('staff.portal.support.unavailableDescription', 'Please contact us directly until support requests are enabled.')}
        />
      ) : (
        <PortalCard>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="support-category">{t('staff.portal.support.new.category', 'Category')}</Label>
              <Select value={categoryValue} onValueChange={setCategoryValue}>
                <SelectTrigger id="support-category" aria-label={t('staff.portal.support.new.category', 'Category')}>
                  <SelectValue placeholder={t('staff.portal.support.new.categoryPlaceholder', 'Choose a category')} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-subject">{t('staff.portal.support.new.subject', 'Subject')}</Label>
              <Input
                id="support-subject"
                value={subject}
                maxLength={200}
                onChange={(event) => setSubject(event.target.value)}
                placeholder={t('staff.portal.support.new.subjectPlaceholder', 'Short summary of the problem')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-description">{t('staff.portal.support.new.descriptionLabel', 'Description')}</Label>
              <Textarea
                id="support-description"
                rows={6}
                value={description}
                maxLength={10000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('staff.portal.support.new.descriptionPlaceholder', 'What happened, and what did you expect?')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('staff.portal.support.attachments.title', 'Files')}</Label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT_TYPES}
                className="sr-only"
                data-testid="support-new-file-input"
                onChange={(event) => void addFiles(event.target.files)}
              />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="mr-2 h-4 w-4" />
                {t('staff.portal.support.attachments.add', 'Add files')}
              </Button>
              {files.length ? (
                <ul className="space-y-1">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">
                        {file.name} · {formatFileSize(t, file.size)}
                      </span>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('staff.portal.support.attachments.remove', 'Remove file')}
                        onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href={`/${params.orgSlug}/portal/support`}>{t('staff.portal.support.new.cancel', 'Cancel')}</Link>
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {t('staff.portal.support.new.submit', 'File ticket')}
              </Button>
            </div>
          </form>
        </PortalCard>
      )}
    </div>
  )
}
