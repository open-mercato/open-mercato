"use client"

/**
 * Phase 2b — AnonymizeButton injection widget.
 *
 * Mounts into the submission drawer's `submission-drawer:anonymize-action`
 * spot. Renders a destructive "Anonymize" button that opens a typed-confirmation
 * dialog (the operator types `DELETE`) and then POSTs to
 * `/api/forms/submissions/:submissionId/anonymize` with `{ confirm: 'DELETE' }`.
 *
 * - Feature-gated behind `forms.submissions.anonymize` (declared in metadata;
 *   the API route enforces it server-side too — fail-closed).
 * - Hidden once the submission is already anonymized (irreversible; no re-run).
 * - Writes go through `useGuardedMutation(...).runMutation(...)` per the
 *   non-CrudForm mutation contract, with `apiCall` (never raw fetch).
 * - On success flashes and asks the host drawer to refresh via a DOM event so
 *   the drawer reloads the now-anonymized state.
 */

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  FORMS_DRAWER_REFRESH_EVENT,
  type FormsDrawerWidgetContext,
} from '../context'

const CONFIRM_TOKEN = 'DELETE'

type AnonymizeButtonProps = {
  context: FormsDrawerWidgetContext
}

export function AnonymizeButtonWidget({ context }: AnonymizeButtonProps) {
  const t = useT()
  const submissionId = typeof context?.submissionId === 'string' ? context.submissionId : null
  const isAnonymized = context?.isAnonymized === true
  const [open, setOpen] = React.useState(false)
  const [confirmText, setConfirmText] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const { runMutation } = useGuardedMutation({ contextId: 'forms.submission.anonymize' })

  const canSubmit = confirmText === CONFIRM_TOKEN && !submitting && !!submissionId

  const handleSubmit = React.useCallback(async () => {
    if (!submissionId || confirmText !== CONFIRM_TOKEN) return
    setSubmitting(true)
    try {
      await runMutation({
        operation: () =>
          apiCall(`/api/forms/submissions/${encodeURIComponent(submissionId)}/anonymize`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ confirm: CONFIRM_TOKEN }),
          }),
        context: { submissionId },
        mutationPayload: { confirm: CONFIRM_TOKEN },
      }).then((resp) => {
        if (!resp.ok) {
          throw new Error('forms.compliance.anonymize.failed')
        }
      })
      flash(t('forms.compliance.anonymize.success', { fallback: 'Submission anonymized.' }), 'success')
      setOpen(false)
      setConfirmText('')
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(FORMS_DRAWER_REFRESH_EVENT, { detail: { submissionId } }))
      }
    } catch {
      flash(t('forms.compliance.anonymize.failed', { fallback: 'Failed to anonymize submission.' }), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [confirmText, runMutation, submissionId, t])

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (canSubmit) void handleSubmit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    },
    [canSubmit, handleSubmit],
  )

  if (!submissionId || isAnonymized) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-forms-anonymize-trigger=""
      >
        <Trash2 className="mr-1 h-4 w-4 text-status-error-foreground" aria-hidden="true" />
        {t('forms.compliance.anonymize.action', { fallback: 'Anonymize' })}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onKeyDown={onKeyDown} data-forms-anonymize-dialog="">
          <DialogHeader>
            <DialogTitle>
              {t('forms.compliance.anonymize.title', { fallback: 'Anonymize submission' })}
            </DialogTitle>
            <DialogDescription>
              {t('forms.compliance.anonymize.warning', {
                fallback:
                  'This is irreversible. All sensitive answers will be replaced with a tombstone token. Audit rows and actor assignments survive.',
              })}
            </DialogDescription>
          </DialogHeader>
          <FormField
            label={t('forms.compliance.anonymize.typed_confirmation', { fallback: 'Type DELETE to confirm' })}
            required
          >
            <Input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={CONFIRM_TOKEN}
              autoComplete="off"
              data-forms-anonymize-confirm=""
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('forms.actor.cancel', { fallback: 'Cancel' })}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!canSubmit}
              onClick={handleSubmit}
              data-forms-anonymize-submit=""
            >
              {t('forms.compliance.anonymize.action', { fallback: 'Anonymize' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const widget: InjectionWidgetModule<FormsDrawerWidgetContext> = {
  metadata: {
    id: 'forms.injection.anonymize-button',
    title: 'Forms Submission Anonymize Button',
    description:
      'Typed-confirmation anonymize action mounted in the submission drawer; POSTs to the anonymize endpoint and refreshes the drawer on success.',
    features: ['forms.submissions.anonymize'],
    priority: 100,
    enabled: true,
  },
  Widget: AnonymizeButtonWidget,
}

export default widget
