"use client"

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Paperclip } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { TASK_DRAWER_QUERY_ROOT } from './taskDrawerData'

const ENTITY_ID = 'staff:staff_time_task'
const CUSTOMER_VISIBLE_TAG = 'customer-visible'
const CUSTOMER_UPLOAD_PREFIX = 'customer-upload:'
const MUTATION_CONTEXT_ID = 'staff.task_drawer.support_attachments'
const ATTACHMENTS_MANAGE_FEATURE = 'attachments.manage'

type StaffAttachment = {
  id: string
  url: string
  fileName: string
  fileSize: number
  tags?: string[]
}

type SupportAttachmentsSectionProps = {
  taskId: string
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Files on a portal ticket. Customer uploads and files staff chose to share carry
 * the `customer-visible` tag and are the only ones the portal lists; everything
 * else stays internal. "Share with customer" is unchecked by default.
 */
export function SupportAttachmentsSection({ taskId }: SupportAttachmentsSectionProps) {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.support.attachments.uploadFailed', 'Could not upload the file.'),
  })
  const { payload } = useBackendChrome()
  const canUpload = hasFeature(payload?.grantedFeatures, ATTACHMENTS_MANAGE_FEATURE)
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [uploading, setUploading] = React.useState(false)
  const [share, setShare] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const attachmentsQueryKey = React.useMemo(
    () => [...TASK_DRAWER_QUERY_ROOT, 'attachments', `scope:${scopeVersion}`, taskId],
    [scopeVersion, taskId],
  )
  const attachmentsQuery = useQuery<StaffAttachment[]>({
    queryKey: attachmentsQueryKey,
    enabled: taskId.length > 0,
    queryFn: async () => {
      const response = await apiCall<{ items?: StaffAttachment[] }>(
        `/api/attachments?entityId=${encodeURIComponent(ENTITY_ID)}&recordId=${encodeURIComponent(taskId)}`,
      )
      if (!response.ok) throw new Error('[internal] attachments request failed')
      return response.result?.items ?? []
    },
  })
  const items = attachmentsQuery.data ?? []

  const refreshAttachments = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: attachmentsQueryKey })
  }, [attachmentsQueryKey, queryClient])

  const upload = React.useCallback(async (list: FileList | null) => {
    if (!list || !list.length || !canUpload) return
    setUploading(true)
    try {
      for (const file of Array.from(list)) {
        const form = new FormData()
        form.set('entityId', ENTITY_ID)
        form.set('recordId', taskId)
        form.set('file', file)
        if (share) form.set('tags', JSON.stringify([CUSTOMER_VISIBLE_TAG]))
        const result = await runMutation({
          operation: () => apiCall('/api/attachments', { method: 'POST', body: form }),
          // Like the rest of the task drawer, an upload carries no record-lock
          // resource: it adds a row rather than editing one.
          context: {
            formId: `${MUTATION_CONTEXT_ID}:${taskId}`,
            retryLastMutation,
          },
          mutationPayload: { taskId, fileName: file.name, shared: share },
        })
        if (!result.ok) flash(t('staff.support.attachments.uploadFailed', 'Could not upload the file.'), 'error')
      }
      await refreshAttachments()
    } catch {
      flash(t('staff.support.attachments.uploadFailed', 'Could not upload the file.'), 'error')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [canUpload, refreshAttachments, retryLastMutation, runMutation, share, t, taskId])

  return (
    <section className="space-y-2" data-testid="support-attachments-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t('staff.support.attachments.title', 'Ticket files')}</h3>
        {canUpload ? (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={share}
                onCheckedChange={(value) => setShare(value === true)}
                aria-label={t('staff.support.attachments.shareWithCustomer', 'Share with customer')}
              />
              {t('staff.support.attachments.shareWithCustomer', 'Share with customer')}
            </label>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="sr-only"
              data-testid="support-attachments-input"
              onChange={(event) => void upload(event.target.files)}
            />
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {uploading ? <Spinner className="mr-2 h-4 w-4" /> : <Paperclip className="mr-2 h-4 w-4" />}
              {t('staff.support.attachments.upload', 'Upload')}
            </Button>
          </div>
        ) : null}
      </div>
      {attachmentsQuery.isLoading ? (
        <LoadingMessage label={t('staff.support.attachments.loading', 'Loading files…')} />
      ) : attachmentsQuery.isError ? (
        <ErrorMessage
          label={t('staff.support.attachments.loadFailed', 'Could not load the ticket files.')}
          action={(
            <Button type="button" variant="outline" size="sm" onClick={() => { void attachmentsQuery.refetch() }}>
              {t('staff.support.attachments.retry', 'Try again')}
            </Button>
          )}
        />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('staff.support.attachments.empty', 'No files on this ticket.')}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => {
            const tags = item.tags ?? []
            const visible = tags.includes(CUSTOMER_VISIBLE_TAG)
            const fromCustomer = tags.some((tag) => tag.startsWith(CUSTOMER_UPLOAD_PREFIX))
            return (
              <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                <a className="flex min-w-0 items-center gap-2 text-foreground hover:underline" href={item.url}>
                  <Download className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.fileName}</span>
                  <span className="shrink-0 text-muted-foreground">{formatSize(item.fileSize)}</span>
                </a>
                <div className="flex shrink-0 gap-1">
                  {fromCustomer ? (
                    <Badge variant="outline">{t('staff.support.attachments.fromCustomer', 'From customer')}</Badge>
                  ) : null}
                  <Badge variant={visible ? 'secondary' : 'outline'}>
                    {visible
                      ? t('staff.support.attachments.visible', 'Visible to customer')
                      : t('staff.support.attachments.internal', 'Internal')}
                  </Badge>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
