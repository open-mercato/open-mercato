"use client"

import * as React from 'react'
import { ArrowRight, History, Lock, Trash2, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { colorForSavedByRole } from './RowBadges'

export const SUBMISSION_DRAWER_HEADER_ACTIONS_SPOT = 'submission-drawer:header-actions'
export const SUBMISSION_DRAWER_ACCESS_AUDIT_SPOT = 'submission-drawer:access-audit'
export const SUBMISSION_DRAWER_FOOTER_SPOT = 'submission-drawer:footer'
export const SUBMISSION_DRAWER_ANONYMIZE_ACTION_SPOT = 'submission-drawer:anonymize-action'

export type DrawerSubmission = {
  id: string
  status: 'draft' | 'submitted' | 'reopened' | 'archived' | 'anonymized'
  formVersionNumber: number
  subjectType: string
  subjectId: string
  anonymizedAt: string | null
  pdfSnapshotAttachmentId: string | null
}

export type DrawerRevision = {
  id: string
  revisionNumber: number
  savedAt: string | null
  savedBy: string
  savedByRole: string | null
  changedFieldKeys: string[]
  anonymizedAt: string | null
}

export type DrawerActor = {
  id: string
  userId: string
  role: string
  assignedAt: string | null
  revokedAt: string | null
}

export type DrawerSubmissionDetail = {
  submission: DrawerSubmission
  revision: DrawerRevision
  decoded_data: Record<string, unknown>
  actors: DrawerActor[]
}

export type DrawerInjectionContext = {
  submissionId: string
  formId: string
  status: DrawerSubmission['status']
  isAnonymized: boolean
}

export type SubmissionDrawerProps = {
  formId: string
  submissionId: string
  formVersionRoles: string[]
  onClose: () => void
  onMutated?: () => void
}

export function SubmissionDrawer({
  formId,
  submissionId,
  formVersionRoles,
  onClose,
  onMutated,
}: SubmissionDrawerProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [detail, setDetail] = React.useState<DrawerSubmissionDetail | null>(null)
  const [revisions, setRevisions] = React.useState<DrawerRevision[]>([])
  const [activeRevisionId, setActiveRevisionId] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [actorOpen, setActorOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLDivElement | null>(null)

  const reload = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [detailResp, revisionsResp] = await Promise.all([
        apiCall<DrawerSubmissionDetail>(`/api/forms/submissions/${encodeURIComponent(submissionId)}`),
        apiCall<{ items: DrawerRevision[] }>(
          `/api/forms/submissions/${encodeURIComponent(submissionId)}/revisions`,
        ),
      ])
      if (!detailResp.ok || !detailResp.result) {
        throw new Error(`Failed to load submission (status ${detailResp.status}).`)
      }
      if (!revisionsResp.ok || !revisionsResp.result) {
        throw new Error(`Failed to load revisions (status ${revisionsResp.status}).`)
      }
      setDetail(detailResp.result)
      setRevisions(revisionsResp.result.items)
      setActiveRevisionId(detailResp.result.revision.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error.')
    } finally {
      setIsLoading(false)
    }
  }, [submissionId])

  React.useEffect(() => {
    void reload()
  }, [reload])

  React.useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleReopen = React.useCallback(async () => {
    if (!detail) return
    const ok = await confirm({
      title: t('forms.drawer.reopen.confirm', { fallback: 'Reopen this submission?' }),
      description: t('forms.drawer.reopen.body', {
        fallback: 'Reopening allows further edits and creates a new revision when changes are saved.',
      }),
    })
    if (!ok) return
    const resp = await apiCall(
      `/api/forms/submissions/${encodeURIComponent(detail.submission.id)}/reopen`,
      { method: 'POST' },
    )
    if (!resp.ok) {
      flash('forms.drawer.reopen.failed', 'error')
      return
    }
    flash('forms.drawer.reopen.success', 'success')
    onMutated?.()
    void reload()
  }, [confirm, detail, onMutated, reload, t])

  const handleRevokeActor = React.useCallback(
    async (actor: DrawerActor) => {
      if (!detail) return
      const ok = await confirm({
        title: t('forms.actor.revoke.confirm', { fallback: 'Revoke this actor?' }),
        variant: 'destructive',
      })
      if (!ok) return
      const resp = await apiCall(
        `/api/forms/submissions/${encodeURIComponent(detail.submission.id)}/actors/${encodeURIComponent(actor.id)}`,
        { method: 'DELETE' },
      )
      if (!resp.ok) {
        flash('forms.actor.revoke.failed', 'error')
        return
      }
      flash('forms.actor.revoke.success', 'success')
      onMutated?.()
      void reload()
    },
    [confirm, detail, onMutated, reload, t],
  )

  if (isLoading) {
    return (
      <DrawerShell onClose={onClose} title={t('forms.drawer.loading', { fallback: 'Loading…' })}>
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-5 w-5" />
        </div>
        {ConfirmDialogElement}
      </DrawerShell>
    )
  }

  if (error || !detail) {
    return (
      <DrawerShell onClose={onClose} title={t('forms.drawer.error', { fallback: 'Error' })}>
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Submission not available.'}</AlertDescription>
        </Alert>
        {ConfirmDialogElement}
      </DrawerShell>
    )
  }

  const isAnonymized = !!detail.submission.anonymizedAt
  const canReopen = detail.submission.status === 'submitted' && !isAnonymized
  const activeRevision = revisions.find((rev) => rev.id === activeRevisionId) ?? detail.revision
  const isViewingLatest = activeRevisionId === detail.revision.id
  const injectionContext: DrawerInjectionContext = {
    submissionId: detail.submission.id,
    formId,
    status: detail.submission.status,
    isAnonymized,
  }

  return (
    <DrawerShell
      ref={triggerRef}
      onClose={onClose}
      title={`${t('forms.drawer.title', { fallback: 'Submission' })} · v${detail.submission.formVersionNumber}`}
      headerExtras={
        <div className="flex items-center gap-2">
          <Tag variant={isAnonymized ? 'error' : 'success'} dot>
            {detail.submission.status}
          </Tag>
          {canReopen ? (
            <Button type="button" variant="outline" size="sm" onClick={handleReopen}>
              {t('forms.drawer.actions.reopen', { fallback: 'Reopen' })}
            </Button>
          ) : null}
          <InjectionSpot
            spotId={SUBMISSION_DRAWER_HEADER_ACTIONS_SPOT}
            context={injectionContext}
          />
          <InjectionSpot
            spotId={SUBMISSION_DRAWER_ANONYMIZE_ACTION_SPOT}
            context={injectionContext}
          />
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr_240px]">
        <RevisionTimeline
          revisions={revisions}
          activeRevisionId={activeRevisionId ?? null}
          onSelect={setActiveRevisionId}
        />

        <section className="flex flex-col gap-3">
          {!isViewingLatest ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span>
                {t('forms.drawer.replay_footer', {
                  fallback: 'Viewing as of rev {n}',
                  n: String(activeRevision.revisionNumber),
                })}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setActiveRevisionId(detail.revision.id)}
              >
                {t('forms.drawer.jump_to_latest', { fallback: 'Jump to latest' })}
              </Button>
            </div>
          ) : null}

          {activeRevision.anonymizedAt ? (
            <Alert variant="default">
              <AlertDescription>
                {t('forms.drawer.anonymized_revision', {
                  fallback: 'This revision has been anonymized — content unavailable.',
                })}
              </AlertDescription>
            </Alert>
          ) : (
            <DataReadOnly data={detail.decoded_data} />
          )}

          <InjectionSpot
            spotId={SUBMISSION_DRAWER_ACCESS_AUDIT_SPOT}
            context={injectionContext}
          />
        </section>

        <ActorPanel
          actors={detail.actors.filter((actor) => !actor.revokedAt)}
          formVersionRoles={formVersionRoles}
          submissionId={detail.submission.id}
          onAssigned={() => {
            setActorOpen(false)
            onMutated?.()
            void reload()
          }}
          onRevoke={handleRevokeActor}
          isOpen={actorOpen}
          onOpen={() => setActorOpen(true)}
          onClose={() => setActorOpen(false)}
        />
      </div>

      <footer className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        <p>
          {t('forms.drawer.audit_note', {
            fallback: 'This view is being written to the access audit log — purpose: view.',
          })}
        </p>
        <InjectionSpot
          spotId={SUBMISSION_DRAWER_FOOTER_SPOT}
          context={injectionContext}
        />
      </footer>

      {ConfirmDialogElement}
    </DrawerShell>
  )
}

const DrawerShell = React.forwardRef<HTMLDivElement, {
  onClose: () => void
  title: string
  headerExtras?: React.ReactNode
  children: React.ReactNode
}>(function DrawerShell({ onClose, title, headerExtras, children }, ref) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-foreground/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={ref}
        role="dialog"
        aria-label={title}
        aria-modal="true"
        className="relative flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto border-l border-border bg-background p-4 shadow-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <div className="flex items-center gap-2">
            {headerExtras}
            <IconButton
              type="button"
              variant="ghost"
              size="default"
              onClick={onClose}
              aria-label="Close drawer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  )
})

function RevisionTimeline({
  revisions,
  activeRevisionId,
  onSelect,
}: {
  revisions: DrawerRevision[]
  activeRevisionId: string | null
  onSelect: (id: string) => void
}) {
  const t = useT()
  return (
    <nav
      aria-label={t('forms.drawer.timeline.title', { fallback: 'Revisions' })}
      className="flex flex-col gap-2"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('forms.drawer.timeline.title', { fallback: 'Revisions' })}
      </h3>
      <ol className="flex flex-col gap-1">
        {revisions.map((rev) => {
          const tone = colorForSavedByRole(rev.savedByRole)
          const active = rev.id === activeRevisionId
          return (
            <li key={rev.id}>
              <button
                type="button"
                onClick={() => onSelect(rev.id)}
                className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted'
                }`}
                aria-current={active ? 'true' : undefined}
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    tone === 'primary'
                      ? 'bg-primary'
                      : tone === 'success'
                        ? 'bg-status-success-foreground'
                        : tone === 'info'
                          ? 'bg-status-info-foreground'
                          : tone === 'warning'
                            ? 'bg-status-warning-foreground'
                            : 'bg-muted-foreground'
                  }`}
                />
                <span className="font-mono">#{rev.revisionNumber}</span>
                <span className="truncate text-muted-foreground">
                  {rev.savedByRole ?? 'system'}
                </span>
                {rev.anonymizedAt ? (
                  <Lock className="ml-auto h-3 w-3 text-muted-foreground" aria-hidden="true" />
                ) : null}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function DataReadOnly({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  const t = useT()
  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        {t('forms.drawer.body.empty', { fallback: 'No answers recorded yet.' })}
      </p>
    )
  }
  return (
    <dl className="grid grid-cols-1 gap-2 rounded-md border border-border bg-card p-3 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-1 gap-1 sm:grid-cols-3 sm:items-baseline">
          <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
          <dd className="col-span-1 text-foreground sm:col-span-2">
            {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ActorPanel({
  actors,
  formVersionRoles,
  submissionId,
  isOpen,
  onOpen,
  onClose,
  onAssigned,
  onRevoke,
}: {
  actors: DrawerActor[]
  formVersionRoles: string[]
  submissionId: string
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  onAssigned: () => void
  onRevoke: (actor: DrawerActor) => void
}) {
  const t = useT()
  const [userId, setUserId] = React.useState('')
  const [role, setRole] = React.useState(formVersionRoles[0] ?? '')
  const [submitting, setSubmitting] = React.useState(false)

  const handleAssign = React.useCallback(async () => {
    if (!userId || !role) return
    setSubmitting(true)
    try {
      const resp = await apiCall(
        `/api/forms/submissions/${encodeURIComponent(submissionId)}/actors`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user_id: userId, role }),
        },
      )
      if (!resp.ok) {
        flash('forms.actor.assign.failed', 'error')
        return
      }
      flash('forms.actor.assign.success', 'success')
      setUserId('')
      onAssigned()
    } finally {
      setSubmitting(false)
    }
  }, [onAssigned, role, submissionId, userId])

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleAssign()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    },
    [handleAssign, onClose],
  )

  return (
    <aside
      aria-label={t('forms.actor.panel.title', { fallback: 'Actors' })}
      className="flex flex-col gap-2"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('forms.actor.panel.title', { fallback: 'Actors' })}
        </h3>
        <Button type="button" size="sm" variant="outline" onClick={onOpen}>
          {t('forms.actor.assign', { fallback: 'Assign' })}
        </Button>
      </header>
      <ul className="flex flex-col gap-1">
        {actors.map((actor) => (
          <li
            key={actor.id}
            className="flex items-center justify-between rounded-md border border-border bg-card px-2 py-1.5 text-xs"
          >
            <div className="flex flex-col">
              <span className="font-mono text-muted-foreground">{actor.userId.slice(0, 8)}…</span>
              <Tag variant="info" dot>
                {actor.role}
              </Tag>
            </div>
            <IconButton
              type="button"
              variant="ghost"
              size="default"
              aria-label={t('forms.actor.revoke', { fallback: 'Revoke actor' })}
              onClick={() => onRevoke(actor)}
            >
              <Trash2 className="h-4 w-4 text-status-error-foreground" aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ul>
      {isOpen ? (
        <div
          className="rounded-md border border-border bg-muted/30 p-3"
          onKeyDown={onKeyDown}
        >
          <FormField label={t('forms.actor.user_id', { fallback: 'User ID' })} required>
            <Input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="UUID"
            />
          </FormField>
          <FormField label={t('forms.actor.role', { fallback: 'Role' })} required>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formVersionRoles.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              {t('forms.actor.cancel', { fallback: 'Cancel' })}
            </Button>
            <Button type="button" size="sm" disabled={submitting || !userId || !role} onClick={handleAssign}>
              {t('forms.actor.assign', { fallback: 'Assign' })}{' '}
              <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
