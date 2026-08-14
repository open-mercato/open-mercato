"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, FolderOpen, MessageSquare, ShieldAlert } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export const MY_WORK_HREF = '/backend/staff/time-tracking'
export const ACCESS_REQUEST_ENDPOINT = '/api/staff/timesheets/access-requests'
const ACCESS_REQUEST_CONTEXT_ID = 'staff.time_tracking.access_request'

export type AccessRequestButtonProps = {
  /**
   * Sent with the request so a Team Leader lands on the right project team
   * drawer. It is never rendered — screen 17 note 1 forbids confirming that the
   * project exists to a user who has no right to it.
   */
  timeProjectId?: string | null
  label: string
  sentLabel: string
  variant?: 'default' | 'outline'
}

export function AccessRequestButton({
  timeProjectId,
  label,
  sentLabel,
  variant = 'outline',
}: AccessRequestButtonProps) {
  const t = useT()
  const [submitting, setSubmitting] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: ACCESS_REQUEST_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const requestAccess = React.useCallback(async () => {
    const payload = timeProjectId ? { timeProjectId } : {}
    setSubmitting(true)
    try {
      await runMutation({
        operation: () =>
          apiCallOrThrow(ACCESS_REQUEST_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        context: {
          formId: ACCESS_REQUEST_CONTEXT_ID,
          resourceKind: 'staff.timesheets.access_request',
          retryLastMutation,
        },
        mutationPayload: payload,
      })
      setSent(true)
      flash(
        t(
          'staff.time_tracking.access.request.success',
          'Your request has been sent to the Team Leaders.',
        ),
        'success',
      )
    } catch {
      flash(
        t('staff.time_tracking.access.request.error', 'Could not send the access request.'),
        'error',
      )
    } finally {
      setSubmitting(false)
    }
  }, [retryLastMutation, runMutation, t, timeProjectId])

  return (
    <Button type="button" variant={variant} onClick={requestAccess} disabled={submitting || sent}>
      <MessageSquare className="size-4" aria-hidden="true" />
      {sent ? sentLabel : label}
    </Button>
  )
}

export type NoProjectAccessProps = {
  timeProjectId?: string | null
  /** Where the "Back to My work" action returns to. */
  myWorkHref?: string
}

/**
 * Screen 17 — a project-scoped route the caller may not open. The copy names
 * neither the customer nor the project (note 1) and covers both "never had
 * access" and "access was revoked" (note 2); navigation stays untouched because
 * the caller still has other projects (note 3).
 */
export function NoProjectAccess({ timeProjectId, myWorkHref = MY_WORK_HREF }: NoProjectAccessProps) {
  const t = useT()
  return (
    <Page>
      <PageBody>
        <EmptyState
          variant="subtle"
          size="lg"
          icon={<ShieldAlert className="size-6" aria-hidden="true" />}
          title={t('staff.time_tracking.access.denied.title', 'You do not have access to this project')}
          description={t(
            'staff.time_tracking.access.denied.description',
            'Project access is granted one project at a time by a Team Leader. If you had access before, it may have been revoked — your earlier time entries stay saved.',
          )}
          actions={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button type="button" variant="default" asChild>
                <a href={myWorkHref}>
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  {t('staff.time_tracking.access.denied.back', 'Back to My work')}
                </a>
              </Button>
              <AccessRequestButton
                timeProjectId={timeProjectId}
                label={t('staff.time_tracking.access.denied.request', 'Request access')}
                sentLabel={t('staff.time_tracking.access.request.sent', 'Request sent')}
              />
            </div>
          }
        />
      </PageBody>
    </Page>
  )
}

/**
 * Screen 2 — the caller has no project assignments at all. Rendered inside the
 * host page (which keeps its own header), so it stays a bare empty state.
 */
export function NoTimeProjectAssignments() {
  const t = useT()
  return (
    <EmptyState
      variant="subtle"
      size="lg"
      icon={<FolderOpen className="size-6" aria-hidden="true" />}
      title={t('staff.time_tracking.access.empty.title', 'You have no projects assigned yet')}
      description={t(
        'staff.time_tracking.access.empty.description',
        'A Team Leader grants project access. Once you are added to a project it shows up here right away — no need to log in again.',
      )}
      actions={
        <AccessRequestButton
          variant="default"
          label={t('staff.time_tracking.access.empty.request', 'Ask a Team Leader for access')}
          sentLabel={t('staff.time_tracking.access.request.sent', 'Request sent')}
        />
      }
    />
  )
}

export default NoProjectAccess
