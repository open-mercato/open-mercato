'use client'

import * as React from 'react'
import { Building2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { E } from '#generated/entities.ids.generated'
import {
  buildPersonPayload,
  createPersonFormFields,
  createPersonFormGroups,
  createPersonFormSchema,
  type PersonFormValues,
} from '../formConfig'

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

interface CreatePersonDialogProps {
  open: boolean
  onClose: () => void
  companyId: string
  companyName: string
  runGuardedMutation?: GuardedMutationRunner
  onPersonCreated?: () => void
}

export function CreatePersonDialog({
  open,
  onClose,
  companyId,
  companyName,
  runGuardedMutation,
  onPersonCreated,
}: CreatePersonDialogProps) {
  const t = useT()
  const { organizationId } = useOrganizationScopeDetail()
  const [formInstanceKey, setFormInstanceKey] = React.useState(0)

  React.useEffect(() => {
    if (open) {
      setFormInstanceKey((current) => current + 1)
    }
  }, [open])

  const formSchema = React.useMemo(() => createPersonFormSchema(), [])

  const fields = React.useMemo<CrudField[]>(() => {
    return createPersonFormFields(t)
      .filter((field) => field.id !== 'addresses')
      .map((field) => {
        if (field.id !== 'companyEntityId') {
          return field
        }
        return {
          id: field.id,
          label: field.label,
          type: 'custom',
          layout: field.layout,
          required: field.required,
          description: field.description,
          disabled: field.disabled,
          readOnly: true,
          component: () => (
            <div className="space-y-2">
              <div className="flex min-h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <Building2 className="size-4 text-muted-foreground" />
                <span className="font-medium text-foreground">{companyName}</span>
                <Badge variant="secondary" className="ml-auto rounded-full px-2 py-0 text-xs font-semibold">
                  {t('customers.people.createDialog.auto', 'auto')}
                </Badge>
              </div>
            </div>
          ),
        } satisfies CrudField
      })
  }, [companyName, t])

  const groups = React.useMemo(
    () => createPersonFormGroups(t).filter((group) => group.id !== 'addresses'),
    [t],
  )

  const initialValues = React.useMemo<Partial<PersonFormValues>>(
    () => ({
      companyEntityId: companyId,
    }),
    [companyId],
  )

  const handleSubmit = React.useCallback(async (values: PersonFormValues) => {
    let payload: Record<string, unknown>
    try {
      payload = buildPersonPayload(values, organizationId)
    } catch (err) {
      if (err instanceof Error && err.message === 'DISPLAY_NAME_REQUIRED') {
        const message = t('customers.people.form.displayName.error')
        throw createCrudFormError(message, { displayName: message })
      }
      throw err
    }

    const operation = () => createCrud<{ id?: string; entityId?: string }>('customers/people', payload)
    if (runGuardedMutation) {
      await runGuardedMutation(operation, payload)
    } else {
      await operation()
    }

    flash(t('customers.people.createDialog.success', 'Person created and linked to company'), 'success')
    onPersonCreated?.()
    onClose()
  }, [onClose, onPersonCreated, organizationId, runGuardedMutation, t])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[1028px]">
        <DialogHeader>
          <DialogTitle>{t('customers.people.createDialog.title', 'Add new person')}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="size-3.5" />
            <span>{companyName}</span>
            <span className="text-xs">·</span>
            <span>{t('customers.people.createDialog.autoLink', 'auto-linked to company')}</span>
          </div>
        </DialogHeader>

        <CrudForm<PersonFormValues>
          key={`${companyId}:${formInstanceKey}`}
          embedded
          entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('customers.people.createDialog.submit', 'Create person')}
          schema={formSchema}
          onSubmit={handleSubmit}
          extraActions={(
            <Button type="button" variant="outline" onClick={onClose}>
              {t('customers.people.createDialog.cancel', 'Cancel')}
            </Button>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
