import * as React from 'react'
import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { ColorPicker } from '../../../../lib/timesheets-ui/ColorPicker'
import { PROJECT_COLOR_KEYS } from '../../../../lib/timesheets-ui/colors'
import { PROJECT_CODE_MAX_LENGTH } from '../../../../lib/time-tracking/projectCode'
import { CustomerPickerBinding } from '../../../../lib/time-tracking-ui/CustomerPicker'
import { ProjectCodeFieldBinding } from '../../../../lib/time-tracking-ui/ProjectCodeField'
import { ProjectCurrencyFieldBinding } from '../../../../lib/time-tracking-ui/ProjectCurrencyField'
import {
  DEFAULT_BUDGET_WARN_AT_PERCENT,
  ProjectBudgetSection,
  ProjectRoundingNotice,
  ProjectTeamSection,
  type ProjectBudgetKind,
} from '../../../../lib/time-tracking-ui/ProjectFormSections'

export type ProjectFormValues = {
  id?: string
  updatedAt?: string | null
  name: string
  code: string
  codeManual?: boolean
  customerId?: string | null
  customerName?: string | null
  customerKind?: string | null
  customerTaxId?: string | null
  description?: string | null
  hourlyRate?: string | null
  currencyCode?: string | null
  currencyLocked?: boolean
  entryCount?: number
  billableByDefault?: boolean
  budgetEnabled?: boolean
  budgetKind?: ProjectBudgetKind
  budgetValue?: string | null
  budgetWarnAtPercent?: string | null
  projectType?: string | null
  color?: string | null
  startDate?: string | null
  costCenter?: string | null
  status?: string
  /**
   * Custom-field values rendered by `CrudForm` from `entityIds`. They are keyed
   * `cf_<key>` / `cf:<key>` and are opaque here: this form neither declares nor
   * validates them, it only has to stop dropping them on the way to the command.
   */
  [customFieldKey: `cf_${string}`]: unknown
  [prefixedCustomFieldKey: `cf:${string}`]: unknown
}

const CUSTOM_FIELD_KEY_PATTERN = /^cf[_:]/

export function pickCustomFieldValues(values: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (CUSTOM_FIELD_KEY_PATTERN.test(key)) picked[key] = value
  }
  return picked
}

const decimalPattern = /^\d+([.,]\d{1,4})?$/

export function createProjectFormSchema() {
  return z.object({
    id: z.string().optional(),
    updatedAt: z.string().optional().nullable(),
    name: z.string().min(1, 'staff.time_tracking.projects.validation.nameRequired'),
    code: z
      .string()
      .min(1, 'staff.time_tracking.projects.validation.codeRequired')
      .max(PROJECT_CODE_MAX_LENGTH)
      .regex(/^[A-Za-z0-9-]+$/, 'staff.time_tracking.projects.validation.codeFormat'),
    codeManual: z.boolean().optional(),
    // D-9 / US-B1: time is organised per customer, so a project cannot be saved without one.
    customerId: z.string().uuid('staff.time_tracking.projects.validation.customerRequired'),
    customerName: z.string().optional().nullable(),
    customerKind: z.string().optional().nullable(),
    customerTaxId: z.string().optional().nullable(),
    description: z.string().max(2000).optional().nullable(),
    hourlyRate: z
      .string()
      .regex(decimalPattern, 'staff.time_tracking.projects.validation.rateFormat')
      .optional()
      .nullable()
      .or(z.literal('')),
    currencyCode: z.string().min(3).max(10).optional().nullable().or(z.literal('')),
    currencyLocked: z.boolean().optional(),
    entryCount: z.number().optional(),
    billableByDefault: z.boolean().optional(),
    budgetEnabled: z.boolean().optional(),
    budgetKind: z.enum(['none', 'hours', 'amount']).optional(),
    budgetValue: z
      .string()
      .regex(decimalPattern, 'staff.time_tracking.projects.validation.budgetFormat')
      .optional()
      .nullable()
      .or(z.literal('')),
    budgetWarnAtPercent: z.string().optional().nullable(),
    projectType: z.string().max(100).optional().nullable(),
    color: z
      .string()
      .refine(
        (value) => (PROJECT_COLOR_KEYS as readonly string[]).includes(value),
        { message: 'staff.time_tracking.projects.validation.color' },
      )
      .optional()
      .nullable(),
    startDate: z.string().optional().nullable(),
    costCenter: z.string().max(100).optional().nullable(),
    status: z.enum(['active', 'on_hold', 'completed']).optional(),
  })
}

function readText(values: Record<string, unknown> | undefined, key: string): string {
  const value = values?.[key]
  return typeof value === 'string' ? value : ''
}

export type ProjectFormFieldOptions = {
  /**
   * Called after the change-currency action succeeded. Hosts editing a persisted
   * project use it to reload the record, so the form picks up the currency the
   * action wrote AND the `updatedAt` it bumped — otherwise the next save would
   * collide with a version the same user had just superseded.
   */
  onCurrencyChanged?: (currencyCode: string) => void
}

export function createProjectFormFields(
  t: TranslateFn,
  options: ProjectFormFieldOptions = {},
): CrudField[] {
  return [
    {
      id: 'name',
      type: 'text',
      label: t('staff.time_tracking.projects.form.name', 'Project name'),
      placeholder: t('staff.time_tracking.projects.form.namePlaceholder', 'e.g. Nordvik — service portal'),
      required: true,
    },
    {
      id: 'code',
      type: 'custom',
      label: t('staff.time_tracking.projects.form.code', 'Project code'),
      rendersOwnError: true,
      component: (props) => React.createElement(ProjectCodeFieldBinding, {
        value: props.value,
        values: props.values,
        error: props.error,
        disabled: props.disabled,
        setValue: props.setValue,
        setFormValue: props.setFormValue,
      }),
    },
    {
      id: 'customerId',
      type: 'custom',
      label: t('staff.time_tracking.projects.form.customer', 'Customer'),
      description: t(
        'staff.time_tracking.projects.form.customerHint',
        'Time is organised per customer — a project cannot be saved without one.',
      ),
      required: true,
      component: (props) => React.createElement(CustomerPickerBinding, {
        value: props.value,
        values: props.values,
        disabled: props.disabled,
        setValue: props.setValue,
        setFormValue: props.setFormValue,
      }),
    },
    {
      id: 'description',
      type: 'textarea',
      label: t('staff.time_tracking.projects.form.description', 'Description'),
      placeholder: t(
        'staff.time_tracking.projects.form.descriptionPlaceholder',
        'Scope of work, what was agreed with the customer…',
      ),
      rows: 4,
    },
    {
      id: 'hourlyRate',
      type: 'custom',
      label: t('staff.time_tracking.projects.form.hourlyRate', 'Hourly rate'),
      layout: 'half',
      component: (props) => React.createElement(
        'div',
        { className: 'flex items-center gap-2' },
        React.createElement(Input, {
          inputMode: 'decimal',
          value: typeof props.value === 'string' ? props.value : '',
          disabled: props.disabled,
          'aria-invalid': Boolean(props.error),
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => props.setValue(event.target.value),
        }),
        React.createElement(
          'span',
          { className: 'shrink-0 text-sm text-muted-foreground' },
          t('staff.time_tracking.projects.form.perHour', '/ h'),
        ),
      ),
    },
    {
      id: 'currencyCode',
      type: 'custom',
      label: t('staff.time_tracking.projects.form.currency', 'Currency'),
      layout: 'half',
      component: (props) => React.createElement(ProjectCurrencyFieldBinding, {
        value: props.value,
        values: props.values,
        disabled: props.disabled,
        setValue: props.setValue,
        onCurrencyChanged: options.onCurrencyChanged,
      }),
    },
    {
      id: 'billableByDefault',
      type: 'custom',
      label: t('staff.time_tracking.projects.form.billableByDefault', 'Billable by default'),
      component: (props) => React.createElement(SwitchField, {
        checked: props.value !== false,
        disabled: props.disabled,
        onCheckedChange: (next: boolean) => props.setValue(next === true),
        label: t('staff.time_tracking.projects.form.billableByDefault', 'Billable by default'),
        description: t(
          'staff.time_tracking.projects.form.billableByDefaultHint',
          'New entries in this project start as billable.',
        ),
      }),
    },
    {
      id: 'status',
      type: 'select',
      label: t('staff.time_tracking.projects.form.status', 'Status'),
      options: [
        { value: 'active', label: t('staff.timesheets.projects.statuses.active', 'Active') },
        { value: 'on_hold', label: t('staff.timesheets.projects.statuses.onHold', 'On Hold') },
        { value: 'completed', label: t('staff.timesheets.projects.statuses.completed', 'Completed') },
      ],
    },
    {
      id: 'color',
      type: 'custom',
      label: t('staff.timesheets.projects.form.color', 'Project color'),
      component: (props) => React.createElement(ColorPicker, {
        value: typeof props.value === 'string' ? props.value : null,
        onChange: (next: string | null) => props.setValue(next),
        resetLabel: t('staff.timesheets.projects.form.colorAuto', 'Auto'),
      }),
    },
    {
      id: 'projectType',
      type: 'text',
      label: t('staff.timesheets.projects.form.projectType', 'Project type'),
      placeholder: t('staff.timesheets.projects.form.projectTypePlaceholder', 'e.g. Internal, Client, R&D'),
    },
    {
      id: 'startDate',
      type: 'date',
      label: t('staff.timesheets.projects.form.startDate', 'Start date'),
    },
    {
      id: 'costCenter',
      type: 'text',
      label: t('staff.timesheets.projects.form.costCenter', 'Cost center'),
      placeholder: t('staff.timesheets.projects.form.costCenterPlaceholder', 'Cost center code'),
    },
  ]
}

/**
 * The group ids the project form renders, in render order.
 *
 * They are the addressable half of `crud-form:staff.staff_time_project:group:<id>`:
 * a contributed widget names one of these to land inside that card rather than at
 * the end of the form. Renaming one silently unbinds every widget aimed at it, so
 * the list is pinned by `__tests__/projectFormGroupIds.test.ts` and treated as a
 * frozen contract surface.
 *
 * `compact` hosts (the timesheet's inline create dialog) render the first two only.
 */
export const PROJECT_FORM_GROUP_IDS = [
  'basics',
  'billing',
  'budget',
  'status',
  'team',
  'rounding',
  'details',
] as const

export const PROJECT_FORM_COMPACT_GROUP_IDS = ['basics', 'billing'] as const

export type ProjectFormGroupId = (typeof PROJECT_FORM_GROUP_IDS)[number]

export type ProjectFormGroupOptions = {
  /**
   * Quick-create hosts (the timesheet's inline project dialog) render the form
   * inside a dialog, where the budget card, the team chips and the rounding
   * notice have no room and no meaning yet.
   */
  compact?: boolean
}

export function createProjectFormGroups(
  t: TranslateFn,
  options: ProjectFormGroupOptions = {},
): CrudFormGroup[] {
  if (options.compact) {
    return [
      {
        id: 'basics',
        column: 1,
        title: t('staff.time_tracking.projects.form.groupBasics', 'Basics'),
        fields: ['name', 'code', 'customerId', 'description'],
      },
      {
        id: 'billing',
        column: 1,
        title: t('staff.time_tracking.projects.form.groupBilling', 'Billing'),
        description: t(
          'staff.time_tracking.projects.form.groupBillingHint',
          'You can leave this empty and fill it in before the first report.',
        ),
        fields: ['hourlyRate', 'currencyCode', 'billableByDefault'],
      },
    ]
  }
  return [
    {
      id: 'basics',
      column: 1,
      title: t('staff.time_tracking.projects.form.groupBasics', 'Basics'),
      fields: ['name', 'code', 'customerId', 'description'],
    },
    {
      id: 'billing',
      column: 1,
      title: t('staff.time_tracking.projects.form.groupBilling', 'Billing'),
      description: t(
        'staff.time_tracking.projects.form.groupBillingHint',
        'You can leave this empty and fill it in before the first report.',
      ),
      fields: ['hourlyRate', 'currencyCode', 'billableByDefault'],
    },
    {
      id: 'budget',
      column: 1,
      title: t('staff.time_tracking.projects.form.groupBudget', 'Budget'),
      component: (ctx) => React.createElement(ProjectBudgetSection, {
        enabled: ctx.values.budgetEnabled === true,
        kind: (ctx.values.budgetKind as ProjectBudgetKind | undefined) ?? 'hours',
        value: readText(ctx.values, 'budgetValue'),
        warnAtPercent: readText(ctx.values, 'budgetWarnAtPercent') || String(DEFAULT_BUDGET_WARN_AT_PERCENT),
        currencyCode: readText(ctx.values, 'currencyCode') || null,
        onChange: (patch: {
          enabled?: boolean
          kind?: ProjectBudgetKind
          value?: string
          warnAtPercent?: string
        }) => {
          if (patch.enabled !== undefined) ctx.setValue('budgetEnabled', patch.enabled)
          if (patch.kind !== undefined) ctx.setValue('budgetKind', patch.kind)
          if (patch.value !== undefined) ctx.setValue('budgetValue', patch.value)
          if (patch.warnAtPercent !== undefined) ctx.setValue('budgetWarnAtPercent', patch.warnAtPercent)
        },
      }),
    },
    {
      id: 'status',
      column: 2,
      title: t('staff.time_tracking.projects.form.groupStatus', 'Status'),
      fields: ['status'],
    },
    {
      id: 'team',
      column: 2,
      title: t('staff.time_tracking.projects.form.groupTeam', 'Team'),
      component: (ctx) => React.createElement(ProjectTeamSection, {
        projectId: typeof ctx.values.id === 'string' ? ctx.values.id : null,
      }),
    },
    {
      id: 'rounding',
      column: 2,
      bare: true,
      component: () => React.createElement(ProjectRoundingNotice, {}),
    },
    {
      id: 'details',
      column: 2,
      title: t('staff.timesheets.projects.form.groupDetails', 'Additional Information'),
      fields: ['color', 'projectType', 'startDate', 'costCenter'],
    },
  ]
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numericOrNull(value: string | null | undefined): string | null {
  const trimmed = trimmedOrNull(value)
  if (trimmed === null) return null
  return trimmed.replace(',', '.')
}

function buildCustomerSnapshot(values: ProjectFormValues): Record<string, unknown> | null {
  const name = trimmedOrNull(values.customerName)
  if (!values.customerId || !name) return null
  const snapshot: Record<string, unknown> = { name }
  const kind = trimmedOrNull(values.customerKind)
  if (kind) snapshot.kind = kind
  const taxId = trimmedOrNull(values.customerTaxId)
  if (taxId) snapshot.taxId = taxId
  return snapshot
}

export function buildProjectPayload(values: ProjectFormValues): Record<string, unknown> {
  const budgetEnabled = values.budgetEnabled === true
  const budgetKind: ProjectBudgetKind = budgetEnabled
    ? (values.budgetKind && values.budgetKind !== 'none' ? values.budgetKind : 'hours')
    : 'none'
  const warnAt = Number.parseInt(trimmedOrNull(values.budgetWarnAtPercent) ?? '', 10)

  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    code: values.code.trim().toUpperCase(),
    customerId: values.customerId ?? null,
    customerSnapshot: buildCustomerSnapshot(values),
    description: trimmedOrNull(values.description),
    projectType: trimmedOrNull(values.projectType),
    color: trimmedOrNull(values.color),
    startDate: values.startDate || null,
    costCenter: trimmedOrNull(values.costCenter),
    hourlyRate: numericOrNull(values.hourlyRate),
    billableByDefault: values.billableByDefault !== false,
    budgetKind,
    budgetValue: budgetEnabled ? numericOrNull(values.budgetValue) : null,
    budgetWarnAtPercent: Number.isFinite(warnAt) ? warnAt : DEFAULT_BUDGET_WARN_AT_PERCENT,
  }
  // D-3: the currency is chosen once, at creation. Every later change belongs to
  // the dedicated change-currency endpoint, which carries the non-conversion
  // acknowledgement and the locked-report refusal — and `staffTimeProjectUpdateSchema`
  // has no `currencyCode` at all. Emitting it on update would be stripped in
  // silence and report a successful save that changed nothing, so the update
  // payload never carries the key.
  if (!values.id) {
    payload.currencyCode = trimmedOrNull(values.currencyCode)
  } else {
    payload.id = values.id
  }
  if (values.status) payload.status = values.status
  // The form renders custom-field inputs whenever `entityIds` is passed, but this
  // builder rebuilds the body from named fields — so every `cf_*` value has to be
  // carried across explicitly or the save silently discards what the user typed.
  Object.assign(payload, pickCustomFieldValues(values as Record<string, unknown>))
  return payload
}
