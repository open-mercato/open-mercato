"use client"

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { E } from '#generated/entities.ids.generated'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { calendarEventTypeBehaviorSchema, calendarEventTypeKeySchema, calendarEventTypes } from '../calendar-event-types'
import type { ScopedCalendarEventType } from '../lib/calendar/eventTypeResolver'
import { getCustomerDictionarySettingsSectionId } from '../lib/dictionaries'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'

const logger = createLogger('customers')
const ENTITY_ID = E.customers.customer_interaction
const API = '/api/customers/dictionaries/activity-types'

type DictionaryRow = { id: string; value: string; updatedAt: string | null; isInherited: boolean }
type Fieldset = { code: string; label: string }
type FormValues = Record<string, unknown>

const defaults = calendarEventTypes[0]!.behavior

function initialValues(item: ScopedCalendarEventType | null): FormValues {
  const behavior = item?.behavior ?? defaults
  return {
    value: item?.key ?? '', label: item?.label ?? '', icon: item?.icon ?? '', color: item?.color ?? '',
    order: behavior.order, baseKind: behavior.baseKind, selectable: behavior.selectable,
    ...behavior.fields, customFieldsetIds: [...behavior.customFieldsetIds], updatedAt: item?.updatedAt ?? undefined,
  }
}

export function ActivityTypeEditor({ title, description }: { title: string; description: string }) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [items, setItems] = React.useState<ScopedCalendarEventType[]>([])
  const [rows, setRows] = React.useState<DictionaryRow[]>([])
  const [selected, setSelected] = React.useState<ScopedCalendarEventType | null | undefined>(undefined)
  const [fieldsets, setFieldsets] = React.useState<Fieldset[]>([])
  const [fieldsetsStatus, setFieldsetsStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [fieldsetAttempt, setFieldsetAttempt] = React.useState(0)
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'customers-activity-types',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const load = React.useCallback(async () => {
    setStatus('loading')
    try {
      const [catalog, dictionary] = await Promise.all([
        readApiResultOrThrow<{ items: ScopedCalendarEventType[] }>('/api/customers/activity-types'),
        readApiResultOrThrow<{ items: DictionaryRow[] }>(API),
      ])
      if (!Array.isArray(catalog.items) || !Array.isArray(dictionary.items)) throw new Error('[internal] Invalid activity type response')
      setItems(catalog.items)
      setRows(dictionary.items)
      setStatus('ready')
    } catch (err) {
      logger.error('customers.activity_types.settings.load failed', { err })
      setStatus('error')
    }
  }, [])
  React.useEffect(() => { void load() }, [load, scopeVersion])

  React.useEffect(() => {
    if (selected === undefined) return
    let active = true
    setFieldsetsStatus('loading')
    void readApiResultOrThrow<{ fieldsetsByEntity?: Record<string, Fieldset[]> }>(
      `/api/entities/definitions?entityId=${encodeURIComponent(ENTITY_ID)}`,
    ).then((result) => {
      if (!active) return
      setFieldsets(result.fieldsetsByEntity?.[ENTITY_ID] ?? [])
      setFieldsetsStatus('ready')
    }).catch((err) => {
      logger.error('customers.activity_types.fieldsets.load failed', { err })
      if (active) setFieldsetsStatus('error')
    })
    return () => { active = false }
  }, [selected, fieldsetAttempt])

  const localRow = (key: string) => rows.find((row) => row.value.toLowerCase() === key && !row.isInherited)
  const remove = async (item: ScopedCalendarEventType) => {
    const row = localRow(item.key)
    if (!row) return
    const approved = await confirm({
      title: t('customers.config.activityTypes.resetConfirm', 'Remove the local activity type configuration?'),
      variant: 'destructive',
    })
    if (!approved) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
          apiCallOrThrow(`${API}/${encodeURIComponent(row.id)}`, { method: 'DELETE' })),
        context: { formId: 'customers-activity-types', resourceKind: 'customers.dictionary', retryLastMutation },
        mutationPayload: { action: 'delete', id: row.id, kind: 'activity-types' },
      })
      flash(t('customers.config.activityTypes.removed', 'Activity type configuration removed.'), 'success')
      await load()
    } catch (err) {
      logger.error('customers.activity_types.settings.remove failed', { err })
      if (!surfaceRecordConflict(err, t, { onRefresh: () => { void load() } })) {
        flash(t('customers.config.activityTypes.saveFailed', 'Failed to save activity type.'), 'error')
      }
    }
  }

  const fields = React.useMemo<CrudField[]>(() => {
    const label = (key: string, fallback: string) => t(`customers.config.activityTypes.fields.${key}`, fallback)
    const options = (values: readonly string[]) => values.map((value) => ({ value, label: t(`customers.config.activityTypes.options.${value}`, value) }))
    const knownFieldsets = fieldsets.map(({ code, label: fieldsetLabel }) => ({ value: code, label: fieldsetLabel }))
    const missing = selected?.behavior.customFieldsetIds.filter((code) => !fieldsets.some((fieldset) => fieldset.code === code)) ?? []
    return [
      { id: 'value', type: 'text', label: label('value', 'Stable key'), required: true, readOnly: !!selected },
      { id: 'label', type: 'text', label: label('label', 'Label'), required: true },
      { id: 'icon', type: 'text', label: label('icon', 'Icon') },
      { id: 'color', type: 'text', label: label('color', 'Color (#RRGGBB)') },
      { id: 'order', type: 'number', label: label('order', 'Display order'), required: true },
      { id: 'baseKind', type: 'select', label: label('baseKind', 'Base behavior'), options: options(['meeting', 'call', 'email', 'note', 'event', 'task']) },
      { id: 'selectable', type: 'checkbox', label: label('selectable', 'Available for new events') },
      ...(['endTime', 'allDay', 'recurrence', 'priority', 'resources'] as const).map((id): CrudField => ({ id, type: 'checkbox', label: label(id, id) })),
      { id: 'location', type: 'select', label: label('location', 'Location field'), options: options(['none', 'location', 'phoneLink']) },
      { id: 'people', type: 'select', label: label('people', 'People field'), options: options(['none', 'attendees', 'participants', 'recipients', 'assignee']) },
      { id: 'customFieldsetIds', type: 'select', multiple: true, label: label('customFieldsetIds', 'Custom-field fieldsets'),
        options: [...knownFieldsets, ...missing.map((code) => ({ value: code, label: `${code} (${t('customers.config.activityTypes.missing', 'missing')})` }))] },
    ]
  }, [fieldsets, selected, t])
  const groups: CrudFormGroup[] = [
    { id: 'appearance', title: t('customers.config.activityTypes.appearance', 'Appearance'), fields: ['value', 'label', 'icon', 'color', 'order'] },
    { id: 'behavior', title: t('customers.config.activityTypes.behavior', 'Form behavior'), fields: ['baseKind', 'selectable', 'endTime', 'allDay', 'recurrence', 'location', 'people', 'priority', 'resources'] },
    { id: 'fieldsets', title: t('customers.config.activityTypes.fieldsets', 'Custom-field fieldsets'), fields: ['customFieldsetIds'] },
  ]
  const save = async (values: FormValues) => {
    const key = String(values.value ?? '').trim()
    if (!calendarEventTypeKeySchema.safeParse(key).success) throw createCrudFormError(t('customers.config.activityTypes.invalidKey', 'Use a lowercase key with letters, numbers, hyphens, or underscores.'), { value: t('customers.config.activityTypes.invalidKey', 'Use a lowercase key with letters, numbers, hyphens, or underscores.') })
    if (fieldsetsStatus !== 'ready') throw createCrudFormError(t('customers.config.activityTypes.fieldsetsUnavailable', 'Fieldsets are unavailable. Retry loading before saving.'))
    const behavior = calendarEventTypeBehaviorSchema.safeParse({
      schemaVersion: 1, baseKind: values.baseKind, selectable: values.selectable === true,
      order: Number(values.order), customFieldsetIds: values.customFieldsetIds ?? [],
      fields: { endTime: values.endTime === true, allDay: values.allDay === true, recurrence: values.recurrence === true,
        location: values.location, people: values.people, priority: values.priority === true, resources: values.resources === true },
    })
    if (!behavior.success) throw createCrudFormError(t('customers.config.activityTypes.invalidBehavior', 'Check the form behavior values.'))
    const payload = { value: key, label: String(values.label ?? '').trim(), icon: String(values.icon ?? '').trim() || null,
      color: String(values.color ?? '').trim() || null, behavior: behavior.data }
    const row = selected ? localRow(selected.key) : undefined
    await apiCallOrThrow(row ? `${API}/${encodeURIComponent(row.id)}` : API, {
      method: row ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(row ? { label: payload.label, icon: payload.icon, color: payload.color, behavior: payload.behavior } : payload),
    })
    setSelected(undefined)
    flash(t('customers.config.activityTypes.saved', 'Activity type saved.'), 'success')
    await load()
  }

  const columns = React.useMemo<ColumnDef<ScopedCalendarEventType>[]>(() => [
    { accessorKey: 'label', header: t('customers.config.activityTypes.columns.type', 'Activity type'), cell: ({ row }) => (
      <div className="flex items-center gap-2">{row.original.color ? renderDictionaryColor(row.original.color, 'size-4 rounded-full border border-border') : null}
        {row.original.icon ? renderDictionaryIcon(row.original.icon, 'size-4') : null}<span>{row.original.labelKey
          ? t(row.original.labelKey, row.original.label)
          : row.original.label}</span></div>) },
    { accessorKey: 'key', header: t('customers.config.activityTypes.columns.key', 'Stable key') },
    { id: 'source', header: t('customers.config.activityTypes.columns.source', 'Source'), cell: ({ row }) => row.original.isLocalOverride
      ? t('customers.config.activityTypes.local', 'Local override') : row.original.isInherited
        ? t('customers.config.activityTypes.inherited', 'Inherited') : row.original.source },
    { id: 'behavior', header: t('customers.config.activityTypes.columns.behavior', 'Behavior'), cell: ({ row }) =>
      t(`customers.config.activityTypes.options.${row.original.behavior.baseKind}`, row.original.behavior.baseKind) },
    { id: 'active', header: t('customers.config.activityTypes.columns.active', 'Selectable'), cell: ({ row }) => row.original.selectable
      ? t('customers.config.activityTypes.yes', 'Yes') : t('customers.config.activityTypes.no', 'No') },
    { id: 'fields', header: t('customers.config.activityTypes.columns.fields', 'Fields'), cell: ({ row }) =>
      Object.values(row.original.behavior.fields).filter((value) => value !== false && value !== 'none').length },
    { id: 'fieldsets', header: t('customers.config.activityTypes.columns.fieldsets', 'Fieldsets'), cell: ({ row }) => row.original.behavior.customFieldsetIds.length },
    { id: 'order', header: t('customers.config.activityTypes.columns.order', 'Order'), cell: ({ row }) => row.original.behavior.order },
  ], [t])

  return <section id={getCustomerDictionarySettingsSectionId('activity-types')} className="scroll-mt-24 rounded border bg-card text-card-foreground shadow-sm">
    <div className="space-y-1 border-b px-6 py-4"><h2 className="text-lg font-medium">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div>
    <div className="px-2 py-4 sm:px-4">
      {status === 'error' ? <div className="space-y-3"><ErrorMessage label={t('customers.config.activityTypes.loadFailed', 'Failed to load activity types.')} /><Button type="button" onClick={() => { void load() }}>{t('customers.config.activityTypes.retry', 'Retry')}</Button></div> :
        <DataTable<ScopedCalendarEventType> embedded columns={columns} data={items} isLoading={status === 'loading'}
          title={title} titleHeadingLevel={2} emptyState={t('customers.config.activityTypes.empty', 'No activity types available.')}
          actions={<Button type="button" size="sm" onClick={() => setSelected(null)}>{t('customers.config.activityTypes.new', 'New activity type')}</Button>}
          refreshButton={{ label: t('customers.config.activityTypes.refresh', 'Refresh'), onRefresh: load, isRefreshing: status === 'loading' }}
          rowActions={(item) => {
            const actions: RowActionItem[] = [{ id: 'edit', label: item.adminConfigurable
              ? t('customers.config.activityTypes.configure', 'Configure') : t('customers.config.activityTypes.view', 'View'), onSelect: () => setSelected(item) }]
            if (localRow(item.key)) actions.push({ id: 'delete', label: item.source === 'dictionary'
              ? t('customers.config.activityTypes.delete', 'Delete') : t('customers.config.activityTypes.reset', 'Reset override'),
              destructive: true, onSelect: () => { void remove(item) } })
            return <RowActions items={actions} />
          }} />}
    </div>
    <Dialog open={selected !== undefined} onOpenChange={(open) => { if (!open) setSelected(undefined) }}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{selected
          ? t('customers.config.activityTypes.configure', 'Configure') : t('customers.config.activityTypes.new', 'New activity type')}</DialogTitle></DialogHeader>
        {selected?.isInherited ? <p className="text-sm text-muted-foreground">{t('customers.config.activityTypes.inheritedHint', 'Saving creates a local override for this organization.')}</p> : null}
        {selected?.inactiveDictionaryOverride ? <p className="text-sm text-muted-foreground">{t('customers.config.activityTypes.inactiveHint', 'A module currently prevents this override from taking effect.')}</p> : null}
        {selected?.missingCustomFieldsetIds.length ? <p className="text-sm text-muted-foreground">{t('customers.config.activityTypes.missingHint', 'Some configured fieldsets no longer exist.')}: {selected.missingCustomFieldsetIds.join(', ')}</p> : null}
        {fieldsetsStatus === 'loading' ? <LoadingMessage label={t('customers.config.activityTypes.loadingFieldsets', 'Loading fieldsets…')} /> : null}
        {fieldsetsStatus === 'error' ? <ErrorMessage label={t('customers.config.activityTypes.fieldsetsUnavailable', 'Fieldsets are unavailable. Retry loading before saving.')} /> : null}
        {fieldsetsStatus === 'error' ? <Button type="button" onClick={() => setFieldsetAttempt((attempt) => attempt + 1)}>{t('customers.config.activityTypes.retry', 'Retry')}</Button> : null}
        {fieldsetsStatus === 'ready' && fieldsets.length === 0 ? <p className="text-sm text-muted-foreground">{t('customers.config.activityTypes.noFieldsets', 'No custom-field fieldsets are defined yet.')}</p> : null}
        {selected !== undefined && fieldsetsStatus === 'ready' ? <CrudForm<FormValues> key={selected?.key ?? 'new'} embedded
          readOnly={selected?.adminConfigurable === false} fields={fields} groups={groups}
          initialValues={initialValues(selected)} onSubmit={save} submitLabel={t('customers.config.activityTypes.save', 'Save')}
          extraActions={<Button type="button" variant="outline" onClick={() => setSelected(undefined)}>{t('customers.config.dictionaries.dialog.cancel', 'Cancel')}</Button>} /> : null}
      </DialogContent>
    </Dialog>
    {ConfirmDialogElement}
  </section>
}
