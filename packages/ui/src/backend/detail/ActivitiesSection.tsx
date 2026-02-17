"use client"
export function formatDateTime(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRightSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { DictionaryEntrySelect, type DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import type { AppearanceSelectorLabels } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import { LoadingMessage, TabEmptyState } from './'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createTranslatorWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { useConfirmDialog } from '../confirm-dialog'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export type ActivitySummary = {
  id: string
  activityType: string
  subject?: string | null
  body?: string | null
  occurredAt?: string | null
  createdAt: string
  appearanceIcon?: string | null
  appearanceColor?: string | null
  entityId?: string | null
  authorUserId?: string | null
  authorName?: string | null
  authorEmail?: string | null
  dealId?: string | null
  dealTitle?: string | null
  customFields?: Array<{ key: string; label?: string | null; value: unknown }>
  customValues?: Record<string, unknown> | null
}

export type SectionAction = {
  label: React.ReactNode
  onClick: () => void
  disabled?: boolean
  icon?: React.ReactNode
}

export type TabEmptyStateConfig = {
  title: string
  actionLabel: string
  description?: string
}

export type ActivityCreatePayload = {
  entityId: string
  activityType: string
  subject?: string | null
  body?: string | null
  occurredAt?: string | null
  dealId?: string | null
  customFields?: Record<string, unknown>
}

export type ActivityUpdatePayload = Partial<ActivityCreatePayload>

export type ActivitiesDataAdapter<C = unknown> = {
  list: (params: { entityId: string | null; dealId?: string | null; context?: C }) => Promise<ActivitySummary[]>
  create: (params: ActivityCreatePayload & { context?: C }) => Promise<void>
  update: (params: { id: string; patch: ActivityUpdatePayload; context?: C }) => Promise<void>
  delete: (params: { id: string; context?: C }) => Promise<void>
}

type DictionaryOption = {
  value: string
  label: string
  color: string | null
  icon: string | null
}

type ActivityTypePresentation = {
  label: string
  icon?: string | null
  color?: string | null
}

type PendingAction =
  | { kind: 'create' }
  | { kind: 'update'; id: string }
  | { kind: 'delete'; id: string }

const INVALID_DATE_MESSAGE = 'invalidDate'

const schema = {
  validate(values: Record<string, unknown>) {
    const result: { ok: boolean; errors?: Array<{ path: string; message: string }> } = { ok: true }
    const activityType = typeof values.activityType === 'string' ? values.activityType.trim() : ''
    if (!activityType) {
      result.ok = false
      result.errors = [{ path: 'activityType', message: 'required' }]
      return result
    }
    const occurredAt = typeof values.occurredAt === 'string' ? values.occurredAt.trim() : ''
    if (occurredAt.length) {
      const parsed = new Date(occurredAt)
      if (Number.isNaN(parsed.getTime())) {
        result.ok = false
        result.errors = [{ path: 'occurredAt', message: INVALID_DATE_MESSAGE }]
      }
    }
    return result
  },
}

function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (input: number) => `${input}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

// ...existing code...

type TimelineItemHeaderProps = {
  title: React.ReactNode
  subtitle?: React.ReactNode
  timestamp?: string | Date | null
  fallbackTimestampLabel?: React.ReactNode
  icon?: string | null
  color?: string | null
  iconSize?: 'sm' | 'md'
  className?: string
  renderIcon?: (icon: string, className?: string) => React.ReactNode
  renderColor?: (color: string, className?: string) => React.ReactNode
}

function TimelineItemHeader({
  title,
  subtitle,
  timestamp,
  fallbackTimestampLabel,
  icon,
  color,
  iconSize = 'md',
  className,
  renderIcon,
  renderColor,
}: TimelineItemHeaderProps) {
  const wrapperSize = iconSize === 'sm' ? 'h-6 w-6' : 'h-8 w-8'
  const iconSizeClass = iconSize === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const resolvedTimestamp = React.useMemo(() => {
    if (subtitle) return subtitle
    if (!timestamp) return fallbackTimestampLabel ?? null
    const value = typeof timestamp === 'string' ? timestamp : timestamp.toISOString()
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return fallbackTimestampLabel ?? null
    const now = Date.now()
    const diff = Math.abs(now - date.getTime())
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    const relativeLabel = diff <= THIRTY_DAYS_MS ? formatRelativeTime(value) : null
    const absoluteLabel = formatDateTime(value)
    if (relativeLabel) {
      return (
        <span title={absoluteLabel ?? undefined}>
          {relativeLabel}
        </span>
      )
    }
    return absoluteLabel ?? fallbackTimestampLabel ?? null
  }, [fallbackTimestampLabel, subtitle, timestamp])

  const iconNode = icon && renderIcon ? renderIcon(icon, iconSizeClass) : null

  return (
    <div className={['flex items-start gap-3', className].filter(Boolean).join(' ')}>
      {iconNode ? (
        <span className={['inline-flex items-center justify-center rounded border border-border bg-muted/40', wrapperSize].join(' ')}>
          {iconNode}
        </span>
      ) : null}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {color && renderColor ? renderColor(color, 'h-3 w-3 rounded-full border border-border') : null}
        </div>
        {resolvedTimestamp ? <div className="text-xs text-muted-foreground">{resolvedTimestamp}</div> : null}
      </div>
    </div>
  )
}

export type ActivityFormBaseValues = {
  activityType: string
  subject?: string | null
  body?: string | null
  occurredAt?: string | null
  dealId?: string | null
}

export type ActivityFormSubmitPayload = {
  base: ActivityFormBaseValues
  custom: Record<string, unknown>
  entityId?: string | null
}

type ActivityFormProps = {
  mode: 'create' | 'edit'
  initialValues?: Partial<ActivityFormBaseValues & Record<string, unknown>>
  onSubmit: (payload: ActivityFormSubmitPayload) => Promise<void>
  onCancel: () => void
  submitLabel?: string
  cancelLabel?: string
  isSubmitting?: boolean
  activityTypeLabels: DictionarySelectLabels
  loadActivityOptions: () => Promise<DictionaryOption[]>
  createActivityOption?: (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => Promise<DictionaryOption>
  dealOptions?: Array<{ id: string; label: string }>
  entityOptions?: Array<{ id: string; label: string }>
  defaultEntityId?: string | null
  manageHref?: string
  customFieldEntityIds?: string[]
  labelPrefix?: string
  appearanceLabels?: AppearanceSelectorLabels
}

function normalizeCustomFieldSubmitValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined)
  }
  if (value === undefined) return null
  return value
}

function buildActivityValidationError(errors: Array<{ path: string; message: string }>, translate: (key: string, fallback?: string) => string) {
  const issue = errors[0]
  if (!issue) {
    throw createCrudFormError(translate('error', 'Failed to save activity.'))
  }
  const message = issue.message === INVALID_DATE_MESSAGE
    ? translate('invalidDate', 'Invalid date')
    : translate('error', 'Failed to save activity.')
  const field = issue.path
  throw createCrudFormError(message, field ? { [field]: message } : undefined)
}

function ActivityForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel,
  isSubmitting = false,
  activityTypeLabels,
  loadActivityOptions,
  createActivityOption,
  dealOptions,
  entityOptions,
  defaultEntityId,
  manageHref = '/backend/config/dictionaries',
  customFieldEntityIds,
  labelPrefix = 'customers.people.detail.activities',
  appearanceLabels,
}: ActivityFormProps) {
  const tHook = useT()
  const t = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const translate = React.useCallback(
    (suffix: string, fallback?: string) => t(`${labelPrefix}.${suffix}`, fallback ?? ''),
    [labelPrefix, t],
  )
  const [pending, setPending] = React.useState(false)

  const normalizedDealOptions = React.useMemo(() => {
    if (!Array.isArray(dealOptions)) return []
    const seen = new Set<string>()
    return dealOptions
      .map((option) => {
        if (!option || typeof option !== 'object') return null
        const id = typeof option.id === 'string' ? option.id.trim() : ''
        if (!id || seen.has(id)) return null
        const label =
          typeof option.label === 'string' && option.label.trim().length
            ? option.label.trim()
            : id
        seen.add(id)
        return { id, label }
      })
      .filter((option): option is { id: string; label: string } => !!option)
  }, [dealOptions])

  const normalizedEntityOptions = React.useMemo(() => {
    if (!Array.isArray(entityOptions)) return []
    const seen = new Set<string>()
    return entityOptions
      .map((option) => {
        if (!option || typeof option !== 'object') return null
        const id = typeof option.id === 'string' ? option.id.trim() : ''
        if (!id || seen.has(id)) return null
        const label =
          typeof option.label === 'string' && option.label.trim().length
            ? option.label.trim()
            : id
        seen.add(id)
        return { id, label }
      })
      .filter((option): option is { id: string; label: string } => !!option)
  }, [entityOptions])

  const baseFields = React.useMemo<CrudField[]>(() => {
    const fields: CrudField[] = []

    if (normalizedEntityOptions.length) {
      fields.push({
        id: 'entityId',
        label: translate('fields.entity', 'Assign to record'),
        type: 'custom',
        layout: 'half',
        component: ({ value, setValue }) => {
          const currentValue =
            typeof value === 'string' && value.length ? value : normalizedEntityOptions[0]?.id ?? ''
          return (
            <select
              className="h-9 w-full rounded border border-muted-foreground/40 bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              value={currentValue}
              onChange={(event) => setValue(event.target.value)}
            >
              {normalizedEntityOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )
        },
      } as CrudField)
    }

    if (normalizedDealOptions.length) {
      fields.push({
        id: 'dealId',
        label: translate('fields.deal', 'Link to deal (optional)'),
        type: 'custom',
        layout: 'half',
        component: ({ value, setValue }) => {
          const currentValue = typeof value === 'string' ? value : ''
          return (
            <select
              className="h-9 w-full rounded border border-muted-foreground/40 bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              value={currentValue}
              onChange={(event) => setValue(event.target.value)}
            >
              <option value="">
                {translate('fields.dealPlaceholder', 'No linked deal')}
              </option>
              {normalizedDealOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )
        },
      } as CrudField)
    }

    fields.push({
      id: 'activityType',
      label: translate('fields.type', 'Activity type'),
      type: 'custom',
      required: true,
      layout: 'half',
      component: ({ value, setValue }) => (
        <DictionaryEntrySelect
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => setValue(next ?? '')}
          fetchOptions={loadActivityOptions}
          createOption={createActivityOption}
          labels={activityTypeLabels}
          allowAppearance
          allowInlineCreate
          appearanceLabels={appearanceLabels}
          selectClassName="w-full"
          manageHref={manageHref}
        />
      ),
    } as CrudField)

    fields.push({
      id: 'subject',
      label: translate('fields.subject', 'Subject'),
      type: 'text',
      layout: 'half',
      placeholder: translate('subjectPlaceholder', 'Add a subject (optional)'),
    } as CrudField)

    fields.push({
      id: 'body',
      label: translate('fields.body', 'Details'),
      type: 'textarea',
      placeholder: translate('bodyPlaceholder', 'Describe the interaction'),
    } as CrudField)

    fields.push({
      id: 'occurredAt',
      label: translate('fields.occurredAt', 'Occurred / will occur at'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <input
          type="datetime-local"
          className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => setValue(event.target.value || '')}
          onFocus={(event) => {
            const target = event.currentTarget as HTMLInputElement & { showPicker?: () => void }
            if (typeof target.showPicker === 'function') {
              try { target.showPicker() } catch { /* ignore unsupported */ }
            }
          }}
          onClick={(event) => {
            const target = event.currentTarget as HTMLInputElement & { showPicker?: () => void }
            if (typeof target.showPicker === 'function') {
              try { target.showPicker() } catch { /* ignore unsupported */ }
            }
          }}
        />
      ),
      layout: 'half',
    } as CrudField)

    return fields
  }, [
    activityTypeLabels,
    appearanceLabels,
    createActivityOption,
    loadActivityOptions,
    manageHref,
    normalizedDealOptions,
    normalizedEntityOptions,
    translate,
  ])

  const baseFieldIds = React.useMemo(() => new Set(baseFields.map((field) => field.id)), [baseFields])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const detailFields: string[] = []
    if (normalizedEntityOptions.length) detailFields.push('entityId')
    if (normalizedDealOptions.length) detailFields.push('dealId')
    detailFields.push('activityType', 'subject', 'occurredAt', 'body')
    const baseGroups: CrudFormGroup[] = [
      {
        id: 'details',
        title: translate('form.details', 'Activity details'),
        column: 1,
        fields: detailFields,
      },
    ]
    baseGroups.push({
      id: 'custom',
      title: translate('form.customFields', 'Custom fields'),
      column: 2,
      kind: 'customFields',
    })
    return baseGroups
  }, [normalizedDealOptions.length, normalizedEntityOptions.length, translate])

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (pending || isSubmitting) return
      setPending(true)
      try {
        const parsed = schema.validate(values)
        if (!parsed.ok) {
          throw buildActivityValidationError(parsed.errors ?? [], translate)
        }
        const rawEntityId = typeof values.entityId === 'string' ? values.entityId.trim() : ''
        const resolvedEntityId = rawEntityId || (typeof defaultEntityId === 'string' ? defaultEntityId : '')
        const rawDealId = typeof values.dealId === 'string' ? values.dealId.trim() : ''
        const base: ActivityFormBaseValues = {
          activityType: typeof values.activityType === 'string' ? values.activityType.trim() : '',
          subject: typeof values.subject === 'string' && values.subject.trim().length ? values.subject.trim() : undefined,
          body: typeof values.body === 'string' && values.body.trim().length ? values.body.trim() : undefined,
          occurredAt: typeof values.occurredAt === 'string' && values.occurredAt.trim().length
            ? new Date(values.occurredAt as string).toISOString()
            : undefined,
          dealId: rawDealId.length ? rawDealId : undefined,
        }
        const reservedCustomKeys = new Set(['entityId', 'dealId'])
        const customEntries = collectCustomFieldValues(values, {
          transform: (value) => normalizeCustomFieldSubmitValue(value),
          accept: (fieldId) => !reservedCustomKeys.has(fieldId),
        })
        Object.entries(values).forEach(([key, value]) => {
          if (key.startsWith('cf_')) return
          if (!baseFieldIds.has(key) && key !== 'id') {
            if (reservedCustomKeys.has(key)) return
            customEntries[key] = normalizeCustomFieldSubmitValue(value)
          }
        })
        await onSubmit({ base, custom: customEntries, entityId: resolvedEntityId.length ? resolvedEntityId : undefined })
      } finally {
        setPending(false)
      }
    },
    [baseFieldIds, defaultEntityId, isSubmitting, onSubmit, pending, translate],
  )

  const embeddedInitialValues = React.useMemo(() => {
    const occurredAt = toLocalDateTimeInput(initialValues?.occurredAt ?? null)
    const resolvedEntity = (() => {
      const raw = typeof (initialValues as Record<string, unknown> | undefined)?.entityId === 'string'
        ? (initialValues as Record<string, unknown>).entityId as string
        : typeof defaultEntityId === 'string'
          ? defaultEntityId
          : normalizedEntityOptions[0]?.id ?? ''
      return raw ?? ''
    })()
    const resolvedDeal = typeof (initialValues as Record<string, unknown> | undefined)?.dealId === 'string'
      ? (initialValues as Record<string, unknown>).dealId as string
      : ''

    return {
      entityId: resolvedEntity,
      dealId: resolvedDeal,
      activityType: initialValues?.activityType ?? '',
      subject: initialValues?.subject ?? '',
      body: initialValues?.body ?? '',
      occurredAt,
      ...Object.fromEntries(
        Object.entries(initialValues ?? {})
          .filter(([key]) => {
            if (!key.startsWith('cf_')) return false
            const trimmed = key.slice(3)
            return trimmed !== 'entityId' && trimmed !== 'dealId'
          })
          .map(([key, value]) => [key, value]),
      ),
    }
  }, [defaultEntityId, initialValues, normalizedEntityOptions])

  return (
    <CrudForm<Record<string, unknown>>
      embedded
      fields={baseFields}
      groups={groups}
      initialValues={embeddedInitialValues}
      onSubmit={handleSubmit}
      submitLabel={submitLabel ?? (mode === 'edit'
        ? translate('update', 'Update activity (⌘/Ctrl + Enter)')
        : translate('save', 'Save activity (⌘/Ctrl + Enter)'))}
      extraActions={(
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending || isSubmitting}
        >
          {cancelLabel ?? translate('cancel', 'Cancel')}
        </Button>
      )}
      entityIds={customFieldEntityIds}
    />
  )
}

type ActivityDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  onOpenChange: (next: boolean) => void
  initialValues?: Partial<ActivityFormBaseValues & Record<string, unknown>>
  onSubmit: (payload: ActivityFormSubmitPayload) => Promise<void>
  isSubmitting?: boolean
  activityTypeLabels: DictionarySelectLabels
  loadActivityOptions: () => Promise<DictionaryOption[]>
  createActivityOption?: (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => Promise<DictionaryOption>
  titles?: {
    create?: string
    edit?: string
  }
  submitLabels?: {
    create?: string
    edit?: string
  }
  cancelLabel?: string
  dealOptions?: Array<{ id: string; label: string }>
  entityOptions?: Array<{ id: string; label: string }>
  defaultEntityId?: string | null
  manageHref?: string
  customFieldEntityIds?: string[]
  labelPrefix?: string
  appearanceLabels?: AppearanceSelectorLabels
}

function ActivityDialog({
  open,
  mode,
  onOpenChange,
  initialValues,
  onSubmit,
  isSubmitting,
  activityTypeLabels,
  loadActivityOptions,
  createActivityOption,
  titles,
  submitLabels,
  cancelLabel,
  dealOptions,
  entityOptions,
  defaultEntityId,
  manageHref,
  customFieldEntityIds,
  labelPrefix = 'customers.people.detail.activities',
  appearanceLabels,
}: ActivityDialogProps) {
  const tHook = useT()
  const t = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const translate = React.useCallback(
    (suffix: string, fallback?: string, params?: Record<string, string | number>) =>
      t(`${labelPrefix}.${suffix}`, fallback ?? '', params),
    [labelPrefix, t],
  )

  const dialogTitle =
    mode === 'edit'
      ? titles?.edit ?? translate('editTitle', 'Edit activity')
      : titles?.create ?? translate('addTitle', 'Add activity')

  const resolvedSubmitLabel =
    mode === 'edit'
      ? submitLabels?.edit ?? translate('update', 'Update activity (⌘/Ctrl + Enter)')
      : submitLabels?.create ?? translate('save', 'Save activity (⌘/Ctrl + Enter)')

  const resolvedCancelLabel = cancelLabel ?? translate('cancel', 'Cancel')

  const handleCancel = React.useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <ActivityForm
          mode={mode}
          initialValues={initialValues}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          submitLabel={resolvedSubmitLabel}
          cancelLabel={resolvedCancelLabel}
          isSubmitting={isSubmitting}
          activityTypeLabels={activityTypeLabels}
          loadActivityOptions={loadActivityOptions}
          createActivityOption={createActivityOption}
          dealOptions={dealOptions}
          entityOptions={entityOptions}
          defaultEntityId={defaultEntityId}
          manageHref={manageHref}
          customFieldEntityIds={customFieldEntityIds}
          labelPrefix={labelPrefix}
          appearanceLabels={appearanceLabels}
        />
      </DialogContent>
    </Dialog>
  )
}

export type ActivitiesSectionProps<C = unknown> = {
  entityId: string | null
  dealId?: string | null
  addActionLabel: string
  emptyState: TabEmptyStateConfig
  onActionChange?: (action: SectionAction | null) => void
  onLoadingChange?: (isLoading: boolean) => void
  dealOptions?: Array<{ id: string; label: string }>
  entityOptions?: Array<{ id: string; label: string }>
  defaultEntityId?: string | null
  dataAdapter: ActivitiesDataAdapter<C>
  dataContext?: C
  activityTypeLabels: DictionarySelectLabels
  loadActivityOptions: () => Promise<DictionaryOption[]>
  createActivityOption?: (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => Promise<DictionaryOption>
  resolveActivityPresentation?: (activity: ActivitySummary) => ActivityTypePresentation
  renderCustomFields?: (activity: ActivitySummary) => React.ReactNode
  customFieldEntityIds?: string[]
  labelPrefix?: string
  renderIcon?: (icon: string, className?: string) => React.ReactNode
  renderColor?: (color: string, className?: string) => React.ReactNode
  appearanceLabels?: AppearanceSelectorLabels
  dealLinkHref?: (dealId: string) => string
  manageHref?: string
}

export function ActivitiesSection<C = unknown>({
  entityId,
  dealId,
  addActionLabel,
  emptyState,
  onActionChange,
  onLoadingChange,
  dealOptions,
  entityOptions,
  defaultEntityId,
  dataAdapter,
  dataContext,
  activityTypeLabels,
  loadActivityOptions,
  createActivityOption,
  resolveActivityPresentation,
  renderCustomFields,
  customFieldEntityIds,
  labelPrefix = 'customers.people.detail.activities',
  renderIcon,
  renderColor,
  appearanceLabels,
  dealLinkHref,
  manageHref,
}: ActivitiesSectionProps<C>) {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const tHook = useT()
  const baseTranslator = React.useMemo<Translator>(() => createTranslatorWithFallback(tHook), [tHook])
  const translate = React.useCallback(
    (suffix: string, fallback?: string, params?: Record<string, string | number>) =>
      baseTranslator(`${labelPrefix}.${suffix}`, fallback ?? '', params),
    [baseTranslator, labelPrefix],
  )
  const resolvedDefaultEntityId = React.useMemo(() => {
    const primary = typeof entityId === 'string' ? entityId.trim() : ''
    if (primary.length) return primary
    const fallback = typeof defaultEntityId === 'string' ? defaultEntityId.trim() : ''
    if (fallback.length) return fallback
    if (Array.isArray(entityOptions)) {
      for (const option of entityOptions) {
        if (!option || typeof option !== 'object') continue
        const id = typeof option.id === 'string' ? option.id.trim() : ''
        if (id.length) return id
      }
    }
    return ''
  }, [defaultEntityId, entityId, entityOptions])

  const resolveEntityForSubmission = React.useCallback(
    (input?: string | null) => {
      const candidate = typeof input === 'string' ? input.trim() : ''
      if (candidate.length) return candidate
      return resolvedDefaultEntityId.length ? resolvedDefaultEntityId : null
    },
    [resolvedDefaultEntityId],
  )

  const [activities, setActivities] = React.useState<ActivitySummary[]>([])
  const [isLoading, setIsLoading] = React.useState<boolean>(() => {
    const entity = typeof entityId === 'string' ? entityId.trim() : ''
    const deal = typeof dealId === 'string' ? dealId.trim() : ''
    return Boolean(entity || deal || resolvedDefaultEntityId)
  })
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit'>('create')
  const [editingActivityId, setEditingActivityId] = React.useState<string | null>(null)
  const [initialValues, setInitialValues] = React.useState<Partial<ActivityFormBaseValues & Record<string, unknown>> | undefined>(undefined)
  const [visibleCount, setVisibleCount] = React.useState(0)
  const pendingCounterRef = React.useRef(0)

  const t = translate

  const pushLoading = React.useCallback(() => {
    pendingCounterRef.current += 1
    if (pendingCounterRef.current === 1) {
      onLoadingChange?.(true)
    }
  }, [onLoadingChange])

  const popLoading = React.useCallback(() => {
    pendingCounterRef.current = Math.max(0, pendingCounterRef.current - 1)
    if (pendingCounterRef.current === 0) {
      onLoadingChange?.(false)
    }
  }, [onLoadingChange])

  const updateVisibleCount = React.useCallback((length: number) => {
    if (!length) {
      setVisibleCount(0)
      return
    }
    const baseline = Math.min(5, length)
    setVisibleCount((prev) => {
      if (prev >= length) {
        return Math.min(prev, length)
      }
      return Math.min(Math.max(prev, baseline), length)
    })
  }, [])

  const loadActivities = React.useCallback(async () => {
    const queryEntityId = typeof entityId === 'string' ? entityId.trim() : ''
    const queryDealId = typeof dealId === 'string' ? dealId.trim() : ''
    if (!queryEntityId && !queryDealId) {
      setActivities([])
      setLoadError(null)
      updateVisibleCount(0)
      return
    }
    pushLoading()
    setIsLoading(true)
    try {
      const items = await dataAdapter.list({
        entityId: queryEntityId || null,
        dealId: queryDealId || null,
        context: dataContext,
      })
      setActivities(items)
      setLoadError(null)
      updateVisibleCount(items.length)
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('loadError', 'Failed to load activities.')
      setLoadError(message)
    } finally {
      setIsLoading(false)
      popLoading()
    }
  }, [dataAdapter, dataContext, dealId, entityId, popLoading, pushLoading, t, updateVisibleCount])

  React.useEffect(() => {
    updateVisibleCount(activities.length)
  }, [activities.length, updateVisibleCount])

  React.useEffect(() => {
    const queryEntityId = typeof entityId === 'string' ? entityId.trim() : ''
    const queryDealId = typeof dealId === 'string' ? dealId.trim() : ''
    if (!queryEntityId && !queryDealId) {
      setActivities([])
      setLoadError(null)
      setIsLoading(false)
      pendingCounterRef.current = 0
      onLoadingChange?.(false)
      updateVisibleCount(0)
      return
    }
    loadActivities().catch(() => {})
  }, [dealId, entityId, loadActivities, onLoadingChange, updateVisibleCount])

  const openCreateDialog = React.useCallback(() => {
    setDialogMode('create')
    setEditingActivityId(null)
    setInitialValues(undefined)
    setDialogOpen(true)
  }, [])

  const openEditDialog = React.useCallback((activity: ActivitySummary) => {
    setDialogMode('edit')
    setEditingActivityId(activity.id)
    const baseValues: Partial<ActivityFormBaseValues & Record<string, unknown>> = {
      activityType: activity.activityType,
      subject: activity.subject ?? '',
      body: activity.body ?? '',
      occurredAt: activity.occurredAt ?? activity.createdAt ?? null,
      dealId: activity.dealId ?? '',
      entityId: activity.entityId ?? '',
    }
    const customEntries = Array.isArray(activity.customFields) ? activity.customFields : []
    customEntries.forEach((entry) => {
      if (entry.key === 'entityId' || entry.key === 'dealId') return
      baseValues[`cf_${entry.key}`] = entry.value ?? null
    })
    setInitialValues(baseValues)
    setDialogOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
    setDialogMode('create')
    setEditingActivityId(null)
    setInitialValues(undefined)
  }, [])

  const handleDialogOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next) {
        closeDialog()
      } else {
        setDialogOpen(true)
      }
    },
    [closeDialog],
  )

  const handleCreate = React.useCallback(
    async ({ base, custom, entityId: formEntityId }: ActivityFormSubmitPayload) => {
      const submissionEntityId = resolveEntityForSubmission(formEntityId)
      if (!submissionEntityId) {
        const message = t('entityMissing', 'Select a related record before saving.')
        flash(message, 'error')
        throw new Error(message)
      }
      setPendingAction({ kind: 'create' })
      pushLoading()
      try {
        const payload: ActivityCreatePayload = {
          entityId: submissionEntityId,
          activityType: base.activityType,
          subject: base.subject ?? undefined,
          body: base.body ?? undefined,
          occurredAt: base.occurredAt ?? undefined,
          dealId: base.dealId ?? undefined,
          customFields: Object.keys(custom).length ? custom : undefined,
        }
        await dataAdapter.create({ ...payload, context: dataContext })
        await loadActivities()
        flash(t('success', 'Activity saved'), 'success')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('error', 'Failed to save activity')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setPendingAction(null)
        popLoading()
      }
    },
    [dataAdapter, dataContext, loadActivities, popLoading, pushLoading, resolveEntityForSubmission, t],
  )

  const handleUpdate = React.useCallback(
    async (activityId: string, { base, custom, entityId: formEntityId }: ActivityFormSubmitPayload) => {
      const submissionEntityId = resolveEntityForSubmission(formEntityId)
      if (!submissionEntityId) {
        const message = t('entityMissing', 'Select a related record before saving.')
        flash(message, 'error')
        throw new Error(message)
      }
      setPendingAction({ kind: 'update', id: activityId })
      pushLoading()
      try {
        const patch: ActivityUpdatePayload = {
          entityId: submissionEntityId,
          activityType: base.activityType,
          subject: base.subject ?? undefined,
          body: base.body ?? undefined,
          occurredAt: base.occurredAt ?? undefined,
          dealId: base.dealId ?? undefined,
          customFields: Object.keys(custom).length ? custom : undefined,
        }
        await dataAdapter.update({ id: activityId, patch, context: dataContext })
        await loadActivities()
        flash(t('updateSuccess', 'Activity updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('error', 'Failed to save activity')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setPendingAction(null)
        popLoading()
      }
    },
    [dataAdapter, dataContext, loadActivities, popLoading, pushLoading, resolveEntityForSubmission, t],
  )

  const handleDelete = React.useCallback(
    async (activity: ActivitySummary) => {
      if (!activity.id) return
      const confirmed = await confirm({
        title: t('deleteConfirm', 'Delete this activity?'),
        text: 'This action cannot be undone.',
        variant: 'destructive',
      })
      if (!confirmed) return
      setPendingAction({ kind: 'delete', id: activity.id })
      try {
        await dataAdapter.delete({ id: activity.id, context: dataContext })
        setActivities((prev) => prev.filter((existing) => existing.id !== activity.id))
        flash(t('deleteSuccess', 'Activity deleted.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t('deleteError', 'Failed to delete activity.')
        flash(message, 'error')
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setPendingAction(null)
      }
    },
    [confirm, dataAdapter, dataContext, t],
  )

  const handleDialogSubmit = React.useCallback(
    async (payload: ActivityFormSubmitPayload) => {
      if (dialogMode === 'edit' && editingActivityId) {
        await handleUpdate(editingActivityId, payload)
      } else {
        await handleCreate(payload)
      }
      closeDialog()
    },
    [closeDialog, dialogMode, editingActivityId, handleCreate, handleUpdate],
  )

  React.useEffect(() => {
    if (!onActionChange) return
    if (activities.length === 0) {
      onActionChange(null)
      return () => {
        onActionChange(null)
      }
    }
    const disabled = resolveEntityForSubmission(null) === null || pendingAction !== null || isLoading
    const action: SectionAction = {
      label: (
        <span className="inline-flex items-center gap-1.5">
          <Plus className="h-4 w-4" />
          {addActionLabel}
        </span>
      ),
      onClick: () => {
        if (!disabled) openCreateDialog()
      },
      disabled,
    }
    onActionChange(action)
    return () => {
      onActionChange(null)
    }
  }, [
    activities.length,
    addActionLabel,
    isLoading,
    onActionChange,
    openCreateDialog,
    pendingAction,
    resolveEntityForSubmission,
  ])

  const isFormPending =
    pendingAction?.kind === 'create' ||
    (pendingAction?.kind === 'update' && pendingAction.id === editingActivityId)
  const visibleActivities = React.useMemo(
    () => activities.slice(0, visibleCount),
    [activities, visibleCount],
  )
  const hasMoreActivities = visibleCount < activities.length
  const loadMoreLabel = t('loadMore', 'Load more activities')

  const handleLoadMore = React.useCallback(() => {
    setVisibleCount((prev) => {
      if (prev >= activities.length) return prev
      return Math.min(prev + 5, activities.length)
    })
  }, [activities.length])

  const resolvePresentation = React.useCallback(
    (activity: ActivitySummary): ActivityTypePresentation => {
      if (resolveActivityPresentation) return resolveActivityPresentation(activity)
      return {
        label: activity.activityType,
        icon: activity.appearanceIcon ?? null,
        color: activity.appearanceColor ?? null,
      }
    },
    [resolveActivityPresentation],
  )

  const resolveDealHref = React.useCallback(
    (id: string) => (dealLinkHref ? dealLinkHref(id) : `/backend/customers/deals/${encodeURIComponent(id)}`),
    [dealLinkHref],
  )

  return (
    <div className="mt-3 space-y-4">
      {loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {loadError}
        </div>
      ) : null}
      <div className="space-y-4">
        {isLoading && activities.length === 0 ? (
          <LoadingMessage
            label={t('loading', 'Loading activities…')}
            className="border-0 bg-transparent p-0 py-8 justify-center"
          />
        ) : (
          <>
            {!isLoading && activities.length === 0 && !dialogOpen ? (
              <TabEmptyState
                title={emptyState.title}
                action={{
                  label: emptyState.actionLabel,
                  onClick: openCreateDialog,
                  disabled: resolveEntityForSubmission(null) === null || pendingAction !== null,
                }}
              />
            ) : null}
            {visibleActivities.length > 0
              ? visibleActivities.map((activity) => {
                  const presentation = resolvePresentation(activity)
                  const timestampValue = activity.occurredAt ?? activity.createdAt ?? null
                  const occurredLabel =
                    formatDateTime(timestampValue) ?? t('noDate', 'No date provided')
                  const authorLabel = activity.authorName ?? activity.authorEmail ?? null
                  const loggedByText = authorLabel
                    ? (() => {
                        const translated = t('loggedBy', `Logged by ${authorLabel}`, { user: authorLabel })
                        if (
                          !translated ||
                          translated.includes('{{') ||
                          translated.includes('{user')
                        ) {
                          return `Logged by ${authorLabel}`
                        }
                        return translated
                      })()
                    : null
                  const isUpdatePending = pendingAction?.kind === 'update' && pendingAction.id === activity.id
                  const isDeletePending = pendingAction?.kind === 'delete' && pendingAction.id === activity.id

                  return (
                    <div
                      key={activity.id}
                      className="group space-y-3 rounded-lg border bg-card p-4 transition hover:border-border/80 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onClick={() => openEditDialog(activity)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openEditDialog(activity)
                        }
                      }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <TimelineItemHeader
                            title={presentation.label}
                            timestamp={timestampValue}
                            fallbackTimestampLabel={occurredLabel}
                            icon={presentation.icon}
                            color={presentation.color}
                            renderIcon={renderIcon}
                            renderColor={renderColor}
                          />
                          {activity.dealId ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <ArrowUpRightSquare className="h-3.5 w-3.5" />
                              <Link
                                href={resolveDealHref(activity.dealId)}
                                className="font-medium text-foreground hover:underline"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {activity.dealTitle && activity.dealTitle.length
                                  ? activity.dealTitle
                                  : t('linkedDeal', 'Linked deal')}
                              </Link>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1 opacity-100 md:opacity-0 transition-opacity md:group-hover:opacity-100 focus-within:opacity-100">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={(event) => {
                              event.stopPropagation()
                              openEditDialog(activity)
                            }}
                            disabled={pendingAction !== null}
                          >
                            {isUpdatePending ? (
                              <span className="relative flex h-4 w-4 items-center justify-center">
                                <span className="absolute h-4 w-4 animate-spin rounded-full border border-primary border-t-transparent" />
                              </span>
                            ) : (
                              <Pencil className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleDelete(activity).catch(() => {})
                            }}
                            disabled={pendingAction !== null}
                          >
                            {isDeletePending ? (
                              <span className="relative flex h-4 w-4 items-center justify-center text-destructive">
                                <span className="absolute h-4 w-4 animate-spin rounded-full border border-destructive border-t-transparent" />
                              </span>
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      {activity.subject ? <p className="text-sm font-medium">{activity.subject}</p> : null}
                      {activity.body ? (
                        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{activity.body}</p>
                      ) : null}
                      {renderCustomFields ? renderCustomFields(activity) : null}
                      {loggedByText ? (
                        <p className="text-xs text-muted-foreground">{loggedByText}</p>
                      ) : null}
                    </div>
                  )
                })
              : null}
            {hasMoreActivities ? (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={pendingAction !== null}>
                  {loadMoreLabel}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ActivityDialog
        open={dialogOpen}
        mode={dialogMode}
        onOpenChange={handleDialogOpenChange}
        initialValues={initialValues}
        onSubmit={async (payload) => {
          await handleDialogSubmit(payload)
        }}
        isSubmitting={Boolean(isFormPending)}
        activityTypeLabels={activityTypeLabels}
        loadActivityOptions={loadActivityOptions}
        createActivityOption={createActivityOption}
        dealOptions={dealOptions}
        entityOptions={entityOptions}
        defaultEntityId={resolvedDefaultEntityId || undefined}
        manageHref={manageHref}
        customFieldEntityIds={customFieldEntityIds}
        labelPrefix={labelPrefix}
        appearanceLabels={appearanceLabels}
      />
      {ConfirmDialogElement}
    </div>
  )
}

export default ActivitiesSection
