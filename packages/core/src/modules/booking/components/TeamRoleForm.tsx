"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { normalizeCustomFieldValues } from '@open-mercato/shared/lib/custom-fields/normalize'
import { AppearanceSelector } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { E } from '#generated/entities.ids.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type TeamRoleFormValues = {
  id?: string
  teamId?: string | null
  name: string
  description?: string | null
  appearance?: { icon?: string | null; color?: string | null }
} & Record<string, unknown>

export type TeamRoleOption = {
  id: string
  name: string
}

export type TeamRoleFormProps = {
  title: string
  submitLabel?: string
  backHref: string
  cancelHref: string
  initialValues: TeamRoleFormValues
  teamOptions?: TeamRoleOption[]
  onSubmit: (values: TeamRoleFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  isLoading?: boolean
  loadingMessage?: string
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  const normalized = normalizeCustomFieldValues({ value })
  return normalized.value
}

export const buildTeamRolePayload = (
  values: TeamRoleFormValues,
  options: { id?: string } = {},
): Record<string, unknown> => {
  const name = typeof values.name === 'string' ? values.name.trim() : ''
  const description = typeof values.description === 'string' && values.description.trim().length
    ? values.description.trim()
    : null
  const teamId = typeof values.teamId === 'string' && values.teamId.trim().length ? values.teamId : null
  const appearance = values.appearance && typeof values.appearance === 'object'
    ? values.appearance as { icon?: string | null; color?: string | null }
    : {}
  const customFields = collectCustomFieldValues(values, { transform: normalizeCustomFieldSubmitValue })
  return {
    ...(options.id ? { id: options.id } : {}),
    teamId,
    name,
    description,
    appearanceIcon: appearance.icon ?? null,
    appearanceColor: appearance.color ?? null,
    ...(Object.keys(customFields).length ? { customFields } : {}),
  }
}

export function TeamRoleForm(props: TeamRoleFormProps) {
  const {
    title,
    submitLabel,
    backHref,
    cancelHref,
    initialValues,
    teamOptions,
    onSubmit,
    onDelete,
    isLoading,
    loadingMessage,
  } = props
  const t = useT()

  const appearanceLabels = React.useMemo(() => ({
    colorLabel: t('booking.teamRoles.form.appearance.colorLabel', 'Color'),
    colorHelp: t('booking.teamRoles.form.appearance.colorHelp', 'Pick a color for this team role.'),
    colorClearLabel: t('booking.teamRoles.form.appearance.colorClear', 'Clear color'),
    iconLabel: t('booking.teamRoles.form.appearance.iconLabel', 'Icon'),
    iconPlaceholder: t('booking.teamRoles.form.appearance.iconPlaceholder', 'Type an emoji or icon name'),
    iconPickerTriggerLabel: t('booking.teamRoles.form.appearance.iconPicker', 'Browse icons'),
    iconSearchPlaceholder: t('booking.teamRoles.form.appearance.iconSearch', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('booking.teamRoles.form.appearance.iconSearchEmpty', 'No icons match your search'),
    iconSuggestionsLabel: t('booking.teamRoles.form.appearance.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('booking.teamRoles.form.appearance.iconClear', 'Clear icon'),
    previewEmptyLabel: t('booking.teamRoles.form.appearance.previewEmpty', 'No appearance selected'),
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => {
    const base: CrudField[] = []
    if (teamOptions && teamOptions.length) {
      base.push({
        id: 'teamId',
        label: t('booking.teamRoles.form.fields.team', 'Team'),
        type: 'select',
        listbox: true,
        options: [
          { value: '', label: t('booking.teamRoles.form.fields.team.unassigned', 'Unassigned') },
          ...teamOptions.map((team) => ({ value: team.id, label: team.name })),
        ],
      })
    }
    base.push(
      { id: 'name', label: t('booking.teamRoles.form.fields.name', 'Name'), type: 'text', required: true },
      { id: 'description', label: t('booking.teamRoles.form.fields.description', 'Description'), type: 'richtext' },
      {
        id: 'appearance',
        label: t('booking.teamRoles.form.appearance.label', 'Appearance'),
        type: 'custom',
        component: ({ value, setValue }) => {
          const current = value && typeof value === 'object'
            ? (value as { icon?: string | null; color?: string | null })
            : {}
          return (
            <AppearanceSelector
              icon={current.icon ?? null}
              color={current.color ?? null}
              onIconChange={(next) => setValue({ ...current, icon: next })}
              onColorChange={(next) => setValue({ ...current, color: next })}
              labels={appearanceLabels}
            />
          )
        },
      },
    )
    return base
  }, [appearanceLabels, t, teamOptions])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', fields: teamOptions && teamOptions.length ? ['teamId', 'name', 'description', 'appearance'] : ['name', 'description', 'appearance'] },
    { id: 'custom', title: t('entities.customFields.title', 'Custom Attributes'), column: 2, kind: 'customFields' },
  ], [t, teamOptions])

  return (
    <CrudForm<TeamRoleFormValues>
      title={title}
      backHref={backHref}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      fields={fields}
      groups={groups}
      entityId={E.booking.booking_team_role}
      initialValues={initialValues}
      onSubmit={onSubmit}
      onDelete={onDelete}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
    />
  )
}
