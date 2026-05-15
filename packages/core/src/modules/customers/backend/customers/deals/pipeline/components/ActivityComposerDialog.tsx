"use client"

import * as React from 'react'
import { Mail, Phone, StickyNote, type LucideIcon } from 'lucide-react'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export type ActivityComposerType = 'call' | 'email' | 'note'

export type ActivityComposerContext = {
  dealId: string
  dealTitle: string
  type: ActivityComposerType
  entityId: string
}

type ActivityComposerDialogProps = {
  open: boolean
  context: ActivityComposerContext | null
  onClose: () => void
  onCreated: () => void
}

type ActivityComposerFormValues = {
  title: string
  phoneNumber: string
  body: string
}

const ACTIVITY_CONTEXT_ID = 'customers-deals-kanban:activity-composer'

const TYPE_META: Record<
  ActivityComposerType,
  {
    titleKey: string
    titleFallback: string
    interactionType: string
    icon: LucideIcon
  }
> = {
  call: {
    titleKey: 'customers.deals.kanban.activityComposer.call',
    titleFallback: 'Log a call',
    interactionType: 'call',
    icon: Phone,
  },
  email: {
    titleKey: 'customers.deals.kanban.activityComposer.email',
    titleFallback: 'Send email',
    interactionType: 'email',
    icon: Mail,
  },
  note: {
    titleKey: 'customers.deals.kanban.activityComposer.note',
    titleFallback: 'Add a note',
    interactionType: 'note',
    icon: StickyNote,
  },
}

export function ActivityComposerDialog({
  open,
  context,
  onClose,
  onCreated,
}: ActivityComposerDialogProps): React.ReactElement | null {
  const t = useT()
  // Re-mount CrudForm whenever the dialog opens, or when the deal/type changes — these
  // identify what we're logging activity FOR, and CrudForm's internal state must reset.
  const [formInstanceKey, setFormInstanceKey] = React.useState(0)
  React.useEffect(() => {
    if (open) setFormInstanceKey((c) => c + 1)
  }, [open])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: ACTIVITY_CONTEXT_ID,
    blockedMessage: translateWithFallback(t, 'ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const eitherRequiredMessage = translateWithFallback(
    t,
    'customers.deals.kanban.activityComposer.required',
    'Add a title or body before saving.',
  )

  const formSchema = React.useMemo(
    () =>
      z
        .object({
          title: z.string().optional(),
          phoneNumber: z.string().optional(),
          body: z.string().optional(),
        })
        // Activity must carry at least a title OR a body — purely empty saves are
        // useless and they previously surfaced as a confusing inline error.
        .refine((v) => (v.title?.trim().length || v.body?.trim().length) ? true : false, {
          message: eitherRequiredMessage,
          path: ['title'],
        }),
    [eitherRequiredMessage],
  ) as unknown as z.ZodType<ActivityComposerFormValues>

  const initialValues = React.useMemo<Partial<ActivityComposerFormValues>>(
    () => ({ title: '', phoneNumber: '', body: '' }),
    [],
  )

  const isCall = context?.type === 'call'

  const fields = React.useMemo<CrudField[]>(() => {
    const list: CrudField[] = [
      {
        // CrudForm auto-focuses the first field on mount; explicit `autoFocus` is rejected
        // by CrudBuiltinField's type and would shadow CrudForm's own focus management.
        id: 'title',
        label: translateWithFallback(t, 'customers.deals.kanban.activityComposer.title', 'Subject'),
        type: 'text',
        placeholder: translateWithFallback(
          t,
          'customers.deals.kanban.activityComposer.title.placeholder',
          'Short summary (optional)',
        ),
      },
    ]
    if (isCall) {
      list.push({
        id: 'phoneNumber',
        label: translateWithFallback(t, 'customers.deals.kanban.activityComposer.phone', 'Phone number'),
        type: 'text',
        placeholder: '+48 ...',
      })
    }
    list.push({
      id: 'body',
      label: translateWithFallback(t, 'customers.deals.kanban.activityComposer.body', 'Notes'),
      type: 'textarea',
      rows: 4,
      placeholder: translateWithFallback(
        t,
        'customers.deals.kanban.activityComposer.body.placeholder',
        'What happened? Markdown supported.',
      ),
    })
    return list
  }, [isCall, t])

  const handleSubmit = React.useCallback(
    async (values: ActivityComposerFormValues) => {
      if (!context) return
      const trimmedTitle = (values.title ?? '').trim()
      const trimmedBody = (values.body ?? '').trim()
      if (!trimmedTitle.length && !trimmedBody.length) {
        // Zod refine already handles this, but we surface a field-level error too so the
        // inline indicator stays anchored on the Subject input.
        throw createCrudFormError(eitherRequiredMessage, { title: eitherRequiredMessage })
      }
      const meta = TYPE_META[context.type]
      const payload: Record<string, unknown> = {
        entityId: context.entityId,
        interactionType: meta.interactionType,
        dealId: context.dealId,
        status: 'planned',
      }
      if (trimmedTitle.length) payload.title = trimmedTitle
      if (trimmedBody.length) payload.body = trimmedBody
      if (context.type === 'call' && (values.phoneNumber ?? '').trim().length) {
        payload.phoneNumber = values.phoneNumber!.trim()
      }
      const operation = () =>
        createCrud('customers/interactions', payload, {
          errorMessage: translateWithFallback(
            t,
            'customers.deals.kanban.activityComposer.error',
            'Failed to save activity.',
          ),
        })
      await runMutation({
        operation,
        context: {
          formId: ACTIVITY_CONTEXT_ID,
          resourceKind: 'customers.interaction',
          resourceId: context.dealId,
          retryLastMutation,
        },
      })
      flash(
        translateWithFallback(t, 'customers.deals.kanban.activityComposer.success', 'Activity saved.'),
        'success',
      )
      onCreated()
      onClose()
    },
    [context, eitherRequiredMessage, onClose, onCreated, retryLastMutation, runMutation, t],
  )

  if (!context) return null
  const meta = TYPE_META[context.type]
  const Icon = meta.icon
  const dialogTitle = translateWithFallback(t, meta.titleKey, meta.titleFallback)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4" aria-hidden="true" />
            {dialogTitle}
          </DialogTitle>
          <DialogDescription>
            {translateWithFallback(
              t,
              'customers.deals.kanban.activityComposer.context',
              'Deal: {title}',
              { title: context.dealTitle },
            )}
          </DialogDescription>
        </DialogHeader>

        <CrudForm<ActivityComposerFormValues>
          key={`${context.dealId}:${context.type}:${formInstanceKey}`}
          embedded
          fields={fields}
          initialValues={initialValues}
          schema={formSchema}
          submitLabel={translateWithFallback(
            t,
            'customers.deals.kanban.activityComposer.submit',
            'Save activity',
          )}
          onSubmit={handleSubmit}
          extraActions={
            <Button type="button" variant="outline" onClick={onClose}>
              {translateWithFallback(t, 'customers.deals.kanban.quickDeal.cancel', 'Cancel')}
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

export default ActivityComposerDialog
