"use client"

import * as React from 'react'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { DictionaryEntrySelect, type DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import {
  createUnavailabilityReasonEntry,
  loadUnavailabilityReasonEntries,
  type UnavailabilityReasonEntry,
} from '@open-mercato/core/modules/planner/components/unavailabilityReasons'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type TeamMemberResponse = {
  items?: Array<Record<string, unknown>>
}

export type LeaveRequestFormValues = {
  id?: string
  memberId?: string | null
  memberLabel?: string | null
  startDate?: string | Date | null
  endDate?: string | Date | null
  timezone?: string | null
  unavailabilityReasonEntryId?: string | null
  unavailabilityReasonValue?: string | null
  note?: string | null
}

export type LeaveRequestFormProps = {
  title: string
  submitLabel?: string
  backHref: string
  cancelHref: string
  initialValues: LeaveRequestFormValues
  onSubmit: (values: LeaveRequestFormValues) => Promise<void>
  onDelete?: () => Promise<void>
  isLoading?: boolean
  loadingMessage?: string
  allowMemberSelect?: boolean
  memberLabel?: string | null
}

const DEFAULT_TIMEZONE = 'UTC'

export function buildLeaveRequestPayload(
  values: LeaveRequestFormValues,
  options: { id?: string } = {},
): Record<string, unknown> {
  const timezone = values.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? DEFAULT_TIMEZONE
  return {
    ...(options.id ? { id: options.id } : {}),
    memberId: values.memberId ?? null,
    startDate: values.startDate ?? null,
    endDate: values.endDate ?? null,
    timezone,
    unavailabilityReasonEntryId: values.unavailabilityReasonEntryId ?? null,
    unavailabilityReasonValue: values.unavailabilityReasonValue ?? null,
    note: values.note ?? null,
  }
}

export function LeaveRequestForm(props: LeaveRequestFormProps) {
  const {
    title,
    submitLabel,
    backHref,
    cancelHref,
    initialValues,
    onSubmit,
    onDelete,
    isLoading,
    loadingMessage,
    allowMemberSelect = true,
    memberLabel,
  } = props
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [memberOptions, setMemberOptions] = React.useState<LookupSelectItem[]>([])
  const [reasonEntriesById, setReasonEntriesById] = React.useState<Record<string, UnavailabilityReasonEntry>>({})
  const resolvedMemberLabel = memberLabel ?? initialValues.memberLabel ?? null

  const labels = React.useMemo(() => ({
    member: t('staff.leaveRequests.form.fields.member', 'Team member'),
    startDate: t('staff.leaveRequests.form.fields.startDate', 'Start date'),
    endDate: t('staff.leaveRequests.form.fields.endDate', 'End date'),
    reason: t('staff.leaveRequests.form.fields.reason', 'Reason'),
    note: t('staff.leaveRequests.form.fields.note', 'Note'),
    notePlaceholder: t('staff.leaveRequests.form.fields.notePlaceholder', 'Optional note'),
  }), [t])

  const reasonLabels = React.useMemo<DictionarySelectLabels>(() => ({
    placeholder: t('staff.leaveRequests.form.reason.placeholder', 'Select a reason'),
    addLabel: t('staff.leaveRequests.form.reason.add', 'Add reason'),
    addPrompt: t('staff.leaveRequests.form.reason.prompt', 'Name the reason'),
    dialogTitle: t('staff.leaveRequests.form.reason.dialogTitle', 'Add reason'),
    valueLabel: t('staff.leaveRequests.form.reason.valueLabel', 'Reason'),
    valuePlaceholder: t('staff.leaveRequests.form.reason.valuePlaceholder', 'Reason name'),
    labelLabel: t('staff.leaveRequests.form.reason.labelLabel', 'Label'),
    labelPlaceholder: t('staff.leaveRequests.form.reason.labelPlaceholder', 'Display label (optional)'),
    emptyError: t('staff.leaveRequests.form.reason.emptyError', 'Please enter a reason'),
    cancelLabel: t('staff.leaveRequests.form.reason.cancel', 'Cancel'),
    saveLabel: t('staff.leaveRequests.form.reason.save', 'Save'),
    saveShortcutHint: t('staff.leaveRequests.form.reason.saveShortcut', 'Cmd/Ctrl + Enter'),
    errorLoad: t('staff.leaveRequests.form.reason.errorLoad', 'Failed to load reasons'),
    errorSave: t('staff.leaveRequests.form.reason.errorSave', 'Failed to save reason'),
    loadingLabel: t('staff.leaveRequests.form.reason.loading', 'Loading…'),
    manageTitle: t('staff.leaveRequests.form.reason.manage', 'Manage reasons'),
  }), [t])

  const fetchReasonOptions = React.useCallback(async () => {
    const entries = await loadUnavailabilityReasonEntries('member')
    const map: Record<string, UnavailabilityReasonEntry> = {}
    entries.forEach((entry) => {
      map[entry.id] = entry
    })
    setReasonEntriesById(map)
    return entries.map((entry) => ({
      value: entry.id,
      label: entry.label ?? entry.value,
      color: entry.color,
      icon: entry.icon,
    }))
  }, [])

  const createReasonOption = React.useCallback(
    async (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => {
      const entry = await createUnavailabilityReasonEntry('member', input)
      if (!entry) return null
      setReasonEntriesById((prev) => ({ ...prev, [entry.id]: entry }))
      return {
        value: entry.id,
        label: entry.label ?? entry.value,
        color: entry.color,
        icon: entry.icon,
      }
    },
    [],
  )

  const fetchMemberOptions = React.useCallback(async (query?: string): Promise<LookupSelectItem[]> => {
    const params = new URLSearchParams({ page: '1', pageSize: '50' })
    if (query && query.trim().length) params.set('search', query.trim())
    const call = await apiCall<TeamMemberResponse>(`/api/staff/team-members?${params.toString()}`)
    const items = Array.isArray(call.result?.items) ? call.result.items : []
    const options = items
      .map((item) => {
        const id = typeof item?.id === 'string' ? item.id : null
        const displayName = typeof item?.displayName === 'string'
          ? item.displayName
          : typeof item?.display_name === 'string'
            ? item.display_name
            : null
        if (!id || !displayName) return null
        return { id, title: displayName }
      })
      .filter((option): option is LookupSelectItem => option !== null)
    setMemberOptions(options)
    return options
  }, [])

  React.useEffect(() => {
    if (!allowMemberSelect) return
    fetchMemberOptions().catch(() => {})
  }, [allowMemberSelect, fetchMemberOptions, scopeVersion])

  React.useEffect(() => {
    const selected = typeof initialValues.memberId === 'string' ? initialValues.memberId : null
    if (!selected || !allowMemberSelect) return
    if (memberOptions.some((option) => option.id === selected)) return
    const selectedId = selected
    let cancelled = false
    async function loadMember() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1' })
        params.set('ids', selectedId)
        const call = await apiCall<TeamMemberResponse>(`/api/staff/team-members?${params.toString()}`)
        const item = Array.isArray(call.result?.items) ? call.result.items[0] : null
        const id = typeof item?.id === 'string' ? item.id : null
        const displayName = typeof item?.displayName === 'string'
          ? item.displayName
          : typeof item?.display_name === 'string'
            ? item.display_name
            : null
        if (!id || !displayName) return
        if (!cancelled) {
          setMemberOptions((prev) => {
            if (prev.some((option) => option.id === id)) return prev
            return [{ id, title: displayName }, ...prev]
          })
        }
      } catch {
        if (!cancelled) setMemberOptions((prev) => prev)
      }
    }
    loadMember()
    return () => { cancelled = true }
  }, [allowMemberSelect, initialValues.memberId, memberOptions])

  const fields = React.useMemo<CrudField[]>(() => {
    const baseFields: CrudField[] = []
    baseFields.push({
      id: 'memberId',
      label: labels.member,
      type: 'custom',
      disabled: !allowMemberSelect,
      component: ({ value, setValue, disabled }) => {
        if (!allowMemberSelect) {
          return (
            <div className="text-sm text-muted-foreground">
              {resolvedMemberLabel ?? t('staff.leaveRequests.form.fields.member.self', 'Your profile')}
            </div>
          )
        }
        return (
          <LookupSelect
            value={typeof value === 'string' ? value : null}
            onChange={(next) => setValue(next)}
            fetchOptions={fetchMemberOptions}
            options={memberOptions}
            placeholder={labels.member}
            disabled={disabled}
          />
        )
      },
    })
    baseFields.push(
      { id: 'startDate', label: labels.startDate, type: 'date', required: true, layout: 'half' },
      { id: 'endDate', label: labels.endDate, type: 'date', required: true, layout: 'half' },
      {
        id: 'unavailabilityReasonEntryId',
        label: labels.reason,
        type: 'custom',
        component: ({ value, setValue, setFormValue }) => (
          <DictionaryEntrySelect
            value={typeof value === 'string' ? value : undefined}
            onChange={(next) => {
              setValue(next ?? null)
              if (setFormValue) {
                const entry = next ? reasonEntriesById[next] : null
                setFormValue('unavailabilityReasonValue', entry?.value ?? null)
              }
            }}
            fetchOptions={fetchReasonOptions}
            createOption={createReasonOption}
            labels={reasonLabels}
            selectClassName="w-full"
            manageHref="/backend/config/dictionaries"
          />
        ),
      },
      {
        id: 'note',
        label: labels.note,
        type: 'textarea',
        placeholder: labels.notePlaceholder,
      },
    )
    return baseFields
  }, [
    allowMemberSelect,
    fetchMemberOptions,
    fetchReasonOptions,
    createReasonOption,
    labels,
    memberOptions,
    reasonEntriesById,
    reasonLabels,
    resolvedMemberLabel,
    t,
  ])

  return (
    <CrudForm
      title={title}
      fields={fields}
      initialValues={initialValues}
      submitLabel={submitLabel}
      backHref={backHref}
      cancelHref={cancelHref}
      onSubmit={onSubmit}
      onDelete={onDelete}
      isLoading={isLoading}
      loadingMessage={loadingMessage}
    />
  )
}
