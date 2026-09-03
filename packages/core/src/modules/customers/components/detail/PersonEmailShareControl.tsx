'use client'

import * as React from 'react'
import { Users } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SharedByEntry = {
  userId: string
  userName: string | null
  sharedAt: string | null
}

type ShareState = {
  sharedByMe: boolean
  canShare: boolean
  updatedAt: string | null
  sharedBy: SharedByEntry[]
}

type PersonEmailShareControlProps = {
  personId: string
  /** Called after a successful flip so the thread list can refetch. */
  onChanged?: () => void
}

const CONTEXT_ID = 'customers-person-email-share'

const EMPTY_STATE: ShareState = {
  sharedByMe: false,
  canShare: false,
  updatedAt: null,
  sharedBy: [],
}

/**
 * Owner-facing switch that hands the caller's whole email conversation with this
 * Person to the team, plus the teammate-facing "Shared by <name>" badge.
 *
 * Rendered above `EmailThreadsPanel` rather than inside it so the shared UI
 * package's panel contract stays untouched.
 */
export function PersonEmailShareControl({ personId, onChanged }: PersonEmailShareControlProps) {
  const t = useT()
  const [state, setState] = React.useState<ShareState>(EMPTY_STATE)
  const [busy, setBusy] = React.useState(false)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const load = React.useCallback(async () => {
    try {
      const response = await apiCall<ShareState>(
        `/api/customers/people/${encodeURIComponent(personId)}/email-share`,
        {
          method: 'GET',
          // Polled alongside the thread list: degrade quietly rather than
          // hijacking the page with a login redirect on an expired session.
          headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
        },
      )
      if (!response.ok || !response.result) {
        setState(EMPTY_STATE)
        return
      }
      const result = response.result
      setState({
        sharedByMe: !!result.sharedByMe,
        canShare: !!result.canShare,
        updatedAt: typeof result.updatedAt === 'string' ? result.updatedAt : null,
        sharedBy: Array.isArray(result.sharedBy) ? result.sharedBy : [],
      })
    } catch {
      // The control is additive — hide it rather than break the Emails tab.
      setState(EMPTY_STATE)
    }
  }, [personId])

  React.useEffect(() => {
    void load()
  }, [load])

  const applyShared = React.useCallback(
    async (nextShared: boolean) => {
      const operation = async () => {
        const response = await withScopedApiRequestHeaders(
          buildOptimisticLockHeader(state.updatedAt),
          () =>
            apiCall<{ ok?: boolean }>(
              `/api/customers/people/${encodeURIComponent(personId)}/email-share`,
              {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ shared: nextShared }),
              },
            ),
        )
        if (!response.ok) {
          const err = response.result as { error?: string } | null
          throw new Error(
            err?.error ??
              t('customers.email.conversationShare.errors.updateFailed', 'Could not update sharing'),
          )
        }
        return true
      }

      return runMutation({
        operation,
        context: {
          formId: CONTEXT_ID,
          resourceKind: 'customers.email_conversation_share',
          resourceId: personId,
          retryLastMutation,
        },
        mutationPayload: { shared: nextShared },
      })
    },
    [personId, state.updatedAt, runMutation, retryLastMutation, t],
  )

  const onToggle = React.useCallback(
    async (nextShared: boolean) => {
      if (busy) return
      // Only the privacy-widening direction needs a confirmation; un-sharing is
      // the safe direction and should stay one click.
      if (nextShared) {
        const confirmed = await confirm({
          title: t('customers.email.conversationShare.confirm.title', 'Share this conversation?'),
          text: t(
            'customers.email.conversationShare.confirm.text',
            'Your colleagues will be able to read your email history with this person, including messages already received. You can stop sharing at any time.',
          ),
          confirmText: t('customers.email.conversationShare.confirm.cta', 'Share with team'),
        })
        if (!confirmed) return
      }

      setBusy(true)
      try {
        const result = await applyShared(nextShared)
        if (!result) return
        flash(
          nextShared
            ? t('customers.email.conversationShare.flash.shared', 'Conversation shared with your team')
            : t('customers.email.conversationShare.flash.unshared', 'Conversation is private again'),
          'success',
        )
        await load()
        onChanged?.()
      } catch (err) {
        if (surfaceRecordConflict(err, t)) return
        flash(
          err instanceof Error
            ? err.message
            : t('customers.email.conversationShare.errors.updateFailed', 'Could not update sharing'),
          'error',
        )
      } finally {
        setBusy(false)
      }
    },
    [busy, confirm, applyShared, load, onChanged, t],
  )

  const sharedByLabel = React.useMemo(() => {
    if (state.sharedBy.length === 0) return null
    const names = state.sharedBy
      .map((entry) => entry.userName)
      .filter((name): name is string => !!name)
    if (names.length === 0) {
      return t('customers.email.conversationShare.sharedByTeammate', 'Shared by a teammate')
    }
    return t('customers.email.conversationShare.sharedBy', 'Shared by {{names}}', {
      names: names.join(', '),
    })
  }, [state.sharedBy, t])

  if (!state.canShare && !sharedByLabel) return null

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div className="flex flex-col">
          {state.canShare ? (
            <span className="text-sm font-medium">
              {t(
                'customers.email.conversationShare.label',
                'Share this conversation with my team',
              )}
            </span>
          ) : null}
          {sharedByLabel ? (
            <Badge variant="secondary" className="w-fit">
              {sharedByLabel}
            </Badge>
          ) : null}
          {state.canShare ? (
            <span className="text-xs text-muted-foreground">
              {state.sharedByMe
                ? t(
                    'customers.email.conversationShare.hint.on',
                    'Colleagues can read your email history with this person.',
                  )
                : t(
                    'customers.email.conversationShare.hint.off',
                    'Only you can read your email with this person.',
                  )}
            </span>
          ) : null}
        </div>
      </div>
      {state.canShare ? (
        <Switch
          checked={state.sharedByMe}
          disabled={busy}
          onCheckedChange={(next) => {
            void onToggle(next)
          }}
          aria-label={t(
            'customers.email.conversationShare.label',
            'Share this conversation with my team',
          )}
        />
      ) : null}
      {ConfirmDialogElement}
    </div>
  )
}

export default PersonEmailShareControl
