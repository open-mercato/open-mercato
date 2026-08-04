"use client"

import * as React from 'react'
import {
  DetailFieldsSection,
  type DetailFieldConfig,
  type InlineSelectOption,
} from '@open-mercato/ui/backend/detail'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveCatalogLabel } from '../../../lib/catalogLabels'
import { TeamSelect, useTeamLabels } from '../components/TeamSelect'
import { UserSelect } from '../components/UserSelect'
import { useUserLabels } from '../components/useUserLabels'

type IncidentSeverityKey = 'critical' | 'high' | 'medium' | 'low'
type IncidentPriority = 'low' | 'medium' | 'high' | 'critical'

const fieldGridClassName = 'sm:col-span-2 md:col-span-3'

const severityVariant: StatusMap<IncidentSeverityKey> = {
  critical: 'error',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
}

const incidentPriorities: IncidentPriority[] = ['low', 'medium', 'high', 'critical']

type CatalogItem = {
  id: string
  key?: string | null
  label?: string | null
}

type DetailsIncidentRecord = {
  severity_id?: string | null
  incident_type_id?: string | null
  priority?: string | null
  owner_user_id?: string | null
  owning_team_id?: string | null
}

type DetailsFieldsProps = {
  incident: DetailsIncidentRecord
  severities: CatalogItem[]
  types: CatalogItem[]
  canManage: boolean
  canAssign: boolean
  onSaveSeverity: (value: string | null) => Promise<void>
  onSavePriority: (value: string | null) => Promise<void>
  onSaveType: (value: string | null) => Promise<void>
  onSaveOwner: (value: string | null) => Promise<void>
  onSaveTeam: (value: string | null) => Promise<void>
}

function normalizeSeverityKey(item: CatalogItem | null | undefined): IncidentSeverityKey | null {
  const key = (item?.key ?? '').toLowerCase()
  if (key === 'critical' || key === 'high' || key === 'medium' || key === 'low') return key
  if (key === 'sev1') return 'critical'
  if (key === 'sev2') return 'high'
  if (key === 'sev3') return 'medium'
  if (key === 'sev4') return 'low'
  const label = (item?.label ?? '').toLowerCase()
  if (label.includes('critical')) return 'critical'
  if (label.includes('high')) return 'high'
  if (label.includes('medium')) return 'medium'
  if (label.includes('low')) return 'low'
  return null
}

function priorityLabel(t: ReturnType<typeof useT>, priority: string | null | undefined): string {
  if (priority === 'low') return t('incidents.incident.priority.low', 'Low')
  if (priority === 'medium') return t('incidents.incident.priority.medium', 'Medium')
  if (priority === 'high') return t('incidents.incident.priority.high', 'High')
  if (priority === 'critical') return t('incidents.incident.priority.critical', 'Critical')
  return priority ?? t('incidents.common.notSet', 'Not set')
}

function severityLabel(t: ReturnType<typeof useT>, key: IncidentSeverityKey | null, item: CatalogItem | null | undefined): string {
  if (item?.label) return resolveCatalogLabel(t, 'severity', item.key, item.label)
  if (key === 'critical') return t('incidents.incident.severity.critical', 'Critical')
  if (key === 'high') return t('incidents.incident.severity.high', 'High')
  if (key === 'medium') return t('incidents.incident.severity.medium', 'Medium')
  if (key === 'low') return t('incidents.incident.severity.low', 'Low')
  return t('incidents.incident.severity.unknown', 'Unknown')
}

function ReadOnlyDetailField({
  label,
  value,
  title,
  children,
}: {
  label: string
  value?: string
  title?: string
  children?: React.ReactNode
}) {
  return (
    <div className="relative rounded border bg-muted/30 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm">
        {children ?? (
          <p className="break-words font-medium text-foreground" title={title ?? value}>
            {value}
          </p>
        )}
      </div>
    </div>
  )
}

function PickerDetailField({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="relative rounded border bg-muted/30 p-3">
      <Label htmlFor={id} className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="mt-2">{children}</div>
    </div>
  )
}

export function DetailsFields({
  incident,
  severities,
  types,
  canManage,
  canAssign,
  onSaveSeverity,
  onSavePriority,
  onSaveType,
  onSaveOwner,
  onSaveTeam,
}: DetailsFieldsProps) {
  const t = useT()
  const severityById = React.useMemo(() => {
    const map = new Map<string, CatalogItem>()
    severities.forEach((item) => map.set(item.id, item))
    return map
  }, [severities])
  const typeById = React.useMemo(() => {
    const map = new Map<string, CatalogItem>()
    types.forEach((item) => map.set(item.id, item))
    return map
  }, [types])
  const ownerUserIds = React.useMemo(() => (
    incident.owner_user_id ? [incident.owner_user_id] : []
  ), [incident.owner_user_id])
  const teamIds = React.useMemo(() => (
    incident.owning_team_id ? [incident.owning_team_id] : []
  ), [incident.owning_team_id])
  const userLabels = useUserLabels(ownerUserIds)
  const teamLabels = useTeamLabels(teamIds)
  const [savingOwner, setSavingOwner] = React.useState(false)
  const [savingTeam, setSavingTeam] = React.useState(false)

  const severity = incident.severity_id ? severityById.get(incident.severity_id) : null
  const severityKey = normalizeSeverityKey(severity)
  const incidentType = incident.incident_type_id ? typeById.get(incident.incident_type_id) : null
  const notSetLabel = t('incidents.common.notSet', 'Not set')
  const ownerLabel = incident.owner_user_id
    ? userLabels[incident.owner_user_id] ?? incident.owner_user_id
    : t('incidents.incident.owner.unassigned', 'Unassigned')
  const teamLabel = incident.owning_team_id
    ? teamLabels[incident.owning_team_id] ?? incident.owning_team_id
    : notSetLabel

  const severityOptions = React.useMemo<InlineSelectOption[]>(() => (
    severities.map((item) => ({
      value: item.id,
      label: resolveCatalogLabel(t, 'severity', item.key, item.label ?? item.id),
    }))
  ), [severities, t])

  const typeOptions = React.useMemo<InlineSelectOption[]>(() => (
    types.map((item) => ({
      value: item.id,
      label: resolveCatalogLabel(t, 'type', item.key, item.label ?? item.id),
    }))
  ), [types, t])

  const priorityOptions = React.useMemo<InlineSelectOption[]>(() => (
    incidentPriorities.map((priority) => ({
      value: priority,
      label: priorityLabel(t, priority),
    }))
  ), [t])

  const saveOwner = React.useCallback(async (value: string | null) => {
    const nextValue = value?.trim() || null
    if (nextValue === (incident.owner_user_id ?? null)) return
    setSavingOwner(true)
    try {
      await onSaveOwner(nextValue)
    } finally {
      setSavingOwner(false)
    }
  }, [incident.owner_user_id, onSaveOwner])

  const saveTeam = React.useCallback(async (value: string | null) => {
    const nextValue = value?.trim() || null
    if (nextValue === (incident.owning_team_id ?? null)) return
    setSavingTeam(true)
    try {
      await onSaveTeam(nextValue)
    } finally {
      setSavingTeam(false)
    }
  }, [incident.owning_team_id, onSaveTeam])

  const fields = React.useMemo<DetailFieldConfig[]>(() => {
    const detailFields: DetailFieldConfig[] = []
    const severityFieldLabel = t('incidents.incident.detail.fields.severity', 'Severity')
    const priorityFieldLabel = t('incidents.incident.detail.fields.priority', 'Priority')
    const typeFieldLabel = t('incidents.incident.detail.fields.type', 'Type')
    const ownerFieldLabel = t('incidents.incident.detail.fields.owner', 'Owner')
    const teamFieldLabel = t('incidents.incident.detail.fields.team', 'Team')

    detailFields.push(canManage && severityOptions.length > 0 ? {
      kind: 'select',
      key: 'severity',
      label: severityFieldLabel,
      emptyLabel: notSetLabel,
      value: incident.severity_id,
      onSave: onSaveSeverity,
      options: severityOptions,
      gridClassName: fieldGridClassName,
    } : {
      kind: 'custom',
      key: 'severity',
      label: severityFieldLabel,
      emptyLabel: notSetLabel,
      gridClassName: fieldGridClassName,
      render: () => (
        <ReadOnlyDetailField label={severityFieldLabel}>
          <StatusBadge variant={severityKey ? severityVariant[severityKey] : 'neutral'} dot>
            {severityLabel(t, severityKey, severity)}
          </StatusBadge>
        </ReadOnlyDetailField>
      ),
    })

    detailFields.push(canManage ? {
      kind: 'select',
      key: 'priority',
      label: priorityFieldLabel,
      emptyLabel: notSetLabel,
      value: incident.priority,
      onSave: onSavePriority,
      options: priorityOptions,
      gridClassName: fieldGridClassName,
    } : {
      kind: 'custom',
      key: 'priority',
      label: priorityFieldLabel,
      emptyLabel: notSetLabel,
      gridClassName: fieldGridClassName,
      render: () => (
        <ReadOnlyDetailField label={priorityFieldLabel} value={priorityLabel(t, incident.priority)} />
      ),
    })

    detailFields.push(canManage && typeOptions.length > 0 ? {
      kind: 'select',
      key: 'type',
      label: typeFieldLabel,
      emptyLabel: notSetLabel,
      value: incident.incident_type_id,
      onSave: onSaveType,
      options: typeOptions,
      gridClassName: fieldGridClassName,
    } : {
      kind: 'custom',
      key: 'type',
      label: typeFieldLabel,
      emptyLabel: notSetLabel,
      gridClassName: fieldGridClassName,
      render: () => (
        <ReadOnlyDetailField
          label={typeFieldLabel}
          value={incidentType ? resolveCatalogLabel(t, 'type', incidentType.key, incidentType.label ?? incidentType.id) : notSetLabel}
        />
      ),
    })

    detailFields.push({
      kind: 'custom',
      key: 'owner',
      label: ownerFieldLabel,
      emptyLabel: notSetLabel,
      gridClassName: fieldGridClassName,
      render: () => canAssign ? (
        <PickerDetailField id="incident-details-owner" label={ownerFieldLabel}>
          <UserSelect
            id="incident-details-owner"
            value={incident.owner_user_id ?? null}
            onChange={(value) => void saveOwner(value)}
            nullable
            disabled={savingOwner}
            placeholder={t('incidents.userSelect.searchPlaceholder', 'Search users')}
          />
        </PickerDetailField>
      ) : (
        <ReadOnlyDetailField label={ownerFieldLabel} value={ownerLabel} title={ownerLabel} />
      ),
    })

    detailFields.push({
      kind: 'custom',
      key: 'team',
      label: teamFieldLabel,
      emptyLabel: notSetLabel,
      gridClassName: fieldGridClassName,
      render: () => canAssign ? (
        <PickerDetailField id="incident-details-team" label={teamFieldLabel}>
          <TeamSelect
            id="incident-details-team"
            value={incident.owning_team_id ?? null}
            onChange={(value) => void saveTeam(value)}
            nullable
            disabled={savingTeam}
            placeholder={t('incidents.teamSelect.searchPlaceholder', 'Search teams')}
          />
        </PickerDetailField>
      ) : (
        <ReadOnlyDetailField label={teamFieldLabel} value={teamLabel} title={teamLabel} />
      ),
    })

    return detailFields
  }, [
    canAssign,
    canManage,
    incident.incident_type_id,
    incident.owner_user_id,
    incident.owning_team_id,
    incident.priority,
    incident.severity_id,
    incidentType,
    notSetLabel,
    onSavePriority,
    onSaveSeverity,
    onSaveType,
    ownerLabel,
    priorityOptions,
    saveOwner,
    saveTeam,
    savingOwner,
    savingTeam,
    severity,
    severityKey,
    severityOptions,
    t,
    teamLabel,
    typeOptions,
  ])

  return <DetailFieldsSection fields={fields} className="mt-4" />
}
