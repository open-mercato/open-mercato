"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'

type TeamRoleFormValues = {
  name: string
  description?: string
} & Record<string, unknown>

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  const normalized = normalizeCustomFieldValues({ value })
  return normalized.value
}

export default function BookingTeamRoleCreatePage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('booking.teamRoles.form.fields.name', 'Name'), type: 'text', required: true },
    { id: 'description', label: t('booking.teamRoles.form.fields.description', 'Description'), type: 'textarea' },
  ], [t])

  const handleSubmit = React.useCallback(async (values: TeamRoleFormValues) => {
    const name = typeof values.name === 'string' ? values.name.trim() : ''
    const description = typeof values.description === 'string' && values.description.trim().length
      ? values.description.trim()
      : null
    const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
    const payload: Record<string, unknown> = {
      name,
      description,
      ...(Object.keys(customFields).length ? { customFields } : {}),
    }
    await createCrud('booking/team-roles', payload, {
      errorMessage: t('booking.teamRoles.errors.save', 'Failed to save team role.'),
    })
    flash(t('booking.teamRoles.messages.saved', 'Team role saved.'), 'success')
    router.push('/backend/booking/team-roles')
  }, [router, t])

  return (
    <Page>
      <PageBody>
        <CrudForm<TeamRoleFormValues>
          title={t('booking.teamRoles.form.createTitle', 'Add team role')}
          backHref="/backend/booking/team-roles"
          cancelHref="/backend/booking/team-roles"
          submitLabel={t('booking.teamRoles.form.actions.create', 'Create')}
          fields={fields}
          entityId={E.booking.booking_team_role}
          initialValues={{ name: '', description: '' }}
          onSubmit={handleSubmit}
        />
      </PageBody>
    </Page>
  )
}
