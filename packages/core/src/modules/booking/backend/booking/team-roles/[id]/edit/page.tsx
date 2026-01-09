"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { TeamRoleForm, type TeamRoleFormValues, buildTeamRolePayload } from '../../TeamRoleForm'

type TeamRoleRecord = {
  id: string
  name: string
  description?: string | null
  appearanceIcon?: string | null
  appearanceColor?: string | null
  appearance_icon?: string | null
  appearance_color?: string | null
} & Record<string, unknown>

type TeamRoleResponse = {
  items?: TeamRoleRecord[]
}

const extractCustomFieldsFromRecord = (record: Record<string, unknown>): Record<string, unknown> => {
  const customFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('cf_')) customFields[key] = value
  }
  const customValues = (record as any).customValues
  if (customValues && typeof customValues === 'object' && !Array.isArray(customValues)) {
    for (const [key, value] of Object.entries(customValues as Record<string, unknown>)) {
      if (!key) continue
      customFields[`cf_${key}`] = value
    }
  }
  const customEntries = (record as any).customFields
  if (Array.isArray(customEntries)) {
    customEntries.forEach((entry) => {
      const key = entry && typeof entry.key === 'string' ? entry.key : null
      if (!key) return
      customFields[`cf_${key}`] = (entry as any).value
    })
  } else if (customEntries && typeof customEntries === 'object') {
    for (const [key, value] of Object.entries(customEntries as Record<string, unknown>)) {
      if (!key) continue
      customFields[`cf_${key}`] = value
    }
  }
  return customFields
}

export default function BookingTeamRoleEditPage({ params }: { params?: { id?: string } }) {
  const roleId = params?.id
  const t = useT()
  const router = useRouter()
  const [initialValues, setInitialValues] = React.useState<TeamRoleFormValues | null>(null)

  React.useEffect(() => {
    if (!roleId) return
    let cancelled = false
    async function loadRole() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: roleId })
        const payload = await readApiResultOrThrow<TeamRoleResponse>(
          `/api/booking/team-roles?${params.toString()}`,
          undefined,
          { errorMessage: t('booking.teamRoles.errors.load', 'Failed to load team role.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(t('booking.teamRoles.errors.notFound', 'Team role not found.'))
        const customFields = extractCustomFieldsFromRecord(record)
        const appearanceIcon = typeof record.appearanceIcon === 'string'
          ? record.appearanceIcon
          : typeof record.appearance_icon === 'string'
            ? record.appearance_icon
            : null
        const appearanceColor = typeof record.appearanceColor === 'string'
          ? record.appearanceColor
          : typeof record.appearance_color === 'string'
            ? record.appearance_color
            : null
        if (!cancelled) {
          setInitialValues({
            id: record.id,
            name: record.name ?? '',
            description: record.description ?? '',
            appearance: { icon: appearanceIcon, color: appearanceColor },
            ...customFields,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('booking.teamRoles.errors.load', 'Failed to load team role.')
        flash(message, 'error')
      }
    }
    loadRole()
    return () => { cancelled = true }
  }, [roleId, t])

  const handleSubmit = React.useCallback(async (values: TeamRoleFormValues) => {
    if (!roleId) return
    const payload = buildTeamRolePayload(values, { id: roleId })
    await updateCrud('booking/team-roles', payload, {
      errorMessage: t('booking.teamRoles.errors.save', 'Failed to save team role.'),
    })
    flash(t('booking.teamRoles.messages.saved', 'Team role saved.'), 'success')
  }, [roleId, t])

  const handleDelete = React.useCallback(async () => {
    if (!roleId) return
    await deleteCrud('booking/team-roles', roleId, {
      errorMessage: t('booking.teamRoles.errors.delete', 'Failed to delete team role.'),
    })
    flash(t('booking.teamRoles.messages.deleted', 'Team role deleted.'), 'success')
    router.push('/backend/booking/team-roles')
  }, [roleId, router, t])

  return (
    <Page>
      <PageBody>
        <TeamRoleForm
          title={t('booking.teamRoles.form.editTitle', 'Edit team role')}
          backHref="/backend/booking/team-roles"
          cancelHref="/backend/booking/team-roles"
          initialValues={initialValues ?? { name: '', description: '', appearance: { icon: null, color: null } }}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
          isLoading={!initialValues}
          loadingMessage={t('booking.teamRoles.form.loading', 'Loading team role...')}
        />
      </PageBody>
    </Page>
  )
}
