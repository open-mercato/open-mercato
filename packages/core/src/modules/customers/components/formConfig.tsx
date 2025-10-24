"use client"

import * as React from 'react'
import { z } from 'zod'
import Link from 'next/link'
import { Check, Pencil, Plus, Settings } from 'lucide-react'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { PhoneNumberField } from '@open-mercato/ui/backend/inputs/PhoneNumberField'
import type {
  CrudCustomFieldRenderProps,
  CrudField,
  CrudFormGroup,
  CrudFormGroupComponentProps,
} from '@open-mercato/ui/backend/CrudForm'
import {
  DictionaryEntrySelect,
  type DictionarySelectLabels,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useQueryClient } from '@tanstack/react-query'
import { useEmailDuplicateCheck } from '../backend/hooks/useEmailDuplicateCheck'
import { lookupPhoneDuplicate } from '../utils/phoneDuplicates'
import { CustomerAddressTiles, type CustomerAddressInput, type CustomerAddressValue } from './AddressTiles'
import {
  ensureCustomerDictionary,
  invalidateCustomerDictionary,
} from './detail/hooks/useCustomerDictionary'

export const metadata = {
  navHidden: true,
} as const

function cn(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(' ')
}

export type Translator = (key: string, fallback?: string) => string

export type PersonFormValues = {
  displayName: string
  firstName: string
  lastName: string
  jobTitle?: string
  companyEntityId?: string
  primaryEmail?: string
  primaryPhone?: string
  status?: string
  lifecycleStage?: string
  source?: string
  description?: string
  addresses?: CustomerAddressValue[]
} & Record<string, unknown>

type DictionarySelectFieldProps = {
  kind:
    | 'statuses'
    | 'sources'
    | 'lifecycle-stages'
    | 'address-types'
    | 'job-titles'
    | 'activity-types'
    | 'deal-statuses'
    | 'pipeline-stages'
  value?: string
  onChange: (value: string | undefined) => void
  labels: DictionarySelectLabels
  selectClassName?: string
}

const emailValidationSchema = z.string().email()
const EMAIL_CHECK_DEBOUNCE_MS = 350

const createSectionHeadingField = (id: string, title: string): CrudField => ({
  id,
  label: '',
  type: 'custom',
  layout: 'full',
  component: () => (
    <div className="mt-4 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </div>
  ),
})

export function DictionarySelectField({
  kind,
  value,
  onChange,
  labels,
  selectClassName,
}: DictionarySelectFieldProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const translate = React.useCallback(
    (key: string, fallback: string) => {
      const result = t(key)
      return result === key ? fallback : result
    },
    [t],
  )

  const appearanceLabels = React.useMemo(
    () => ({
      colorLabel: translate('customers.config.dictionaries.dialog.colorLabel', 'Color'),
      colorHelp: translate('customers.config.dictionaries.dialog.colorHelp', 'Pick a highlight color for this entry.'),
      colorClearLabel: translate('customers.config.dictionaries.dialog.colorClear', 'Remove color'),
      iconLabel: translate('customers.config.dictionaries.dialog.iconLabel', 'Icon or emoji'),
      iconPlaceholder: translate(
        'customers.config.dictionaries.dialog.iconPlaceholder',
        'Type an emoji or pick one of the suggestions.',
      ),
      iconPickerTriggerLabel: translate('customers.config.dictionaries.dialog.iconBrowse', 'Browse icons and emojis'),
      iconSearchPlaceholder: translate(
        'customers.config.dictionaries.dialog.iconSearchPlaceholder',
        'Search icons or emojis…',
      ),
      iconSearchEmptyLabel: translate(
        'customers.config.dictionaries.dialog.iconSearchEmpty',
        'No icons match your search.',
      ),
      iconSuggestionsLabel: translate('customers.config.dictionaries.dialog.iconSuggestions', 'Suggestions'),
      iconClearLabel: translate('customers.config.dictionaries.dialog.iconClear', 'Remove icon'),
      previewEmptyLabel: translate('customers.config.dictionaries.dialog.previewEmpty', 'No appearance selected'),
    }),
    [translate],
  )

  const fetchOptions = React.useCallback(async () => {
    const data = await ensureCustomerDictionary(queryClient, kind, scopeVersion)
    return data.entries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
  }, [kind, queryClient, scopeVersion])

  const createOption = React.useCallback(
    async (input: { value: string; label?: string; color?: string | null; icon?: string | null }) => {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: input.value,
          label: input.label ?? input.value,
          color: input.color ?? undefined,
          icon: input.icon ?? undefined,
        }),
      })
      const payload: Record<string, unknown> = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof payload.error === 'string' ? payload.error : labels.errorSave
        throw new Error(message)
      }
      await invalidateCustomerDictionary(queryClient, kind)
      const valueCreated = typeof payload.value === 'string' ? payload.value : input.value
      const label =
        typeof payload.label === 'string' && payload.label.trim().length ? payload.label.trim() : valueCreated
      const color =
        typeof payload.color === 'string' && payload.color.trim().startsWith('#')
          ? payload.color.trim()
          : null
      const icon =
        typeof payload.icon === 'string' && payload.icon.trim().length ? payload.icon.trim() : null
      return { value: valueCreated, label, color, icon }
    },
    [kind, labels.errorSave, queryClient],
  )

  return (
    <DictionaryEntrySelect
      value={value}
      onChange={onChange}
      fetchOptions={fetchOptions}
      createOption={createOption}
      labels={labels}
      selectClassName={selectClassName}
      allowInlineCreate
      allowAppearance
      appearanceLabels={appearanceLabels}
      manageHref="/backend/config/customers"
      showLabelInput
    />
  )
}

const createPrimaryEmailField = (t: Translator): CrudField => ({
  id: 'primaryEmail',
  label: t('customers.people.form.primaryEmail'),
  type: 'custom',
  component: function PrimaryEmailField({ value, setValue, error, autoFocus, disabled }: CrudCustomFieldRenderProps) {
    const [inputValue, setInputValue] = React.useState(() => (typeof value === 'string' ? value : ''))
    const trimmedInput = inputValue.trim()
    const isValidEmail = React.useMemo(
      () => !!trimmedInput.length && emailValidationSchema.safeParse(trimmedInput).success,
      [trimmedInput]
    )
    const { duplicate, checking } = useEmailDuplicateCheck(inputValue, {
      disabled: disabled || !!error || !isValidEmail,
      debounceMs: EMAIL_CHECK_DEBOUNCE_MS,
      matchMode: 'prefix',
    })

    React.useEffect(() => {
      setInputValue(typeof value === 'string' ? value : '')
    }, [value])

    return (
      <div className="space-y-2">
        <input
          type="email"
          className="w-full h-9 rounded border px-2 text-sm"
          value={inputValue}
          onChange={(event) => {
            const nextValue = event.target.value
            setInputValue(nextValue)
            setValue(nextValue)
          }}
          placeholder={t('customers.people.form.primaryEmailPlaceholder', 'name@example.com')}
          spellCheck={false}
          autoFocus={autoFocus}
          data-crud-focus-target=""
          disabled={disabled}
        />
        {!error && duplicate ? (
          <p className="text-xs text-amber-600">
            {t('customers.people.form.emailDuplicateNotice', { name: duplicate.displayName })}{' '}
            <Link className="font-medium text-primary underline underline-offset-2" href={`/backend/customers/people/${duplicate.id}`}>
              {t('customers.people.form.emailDuplicateLink')}
            </Link>
          </p>
        ) : null}
        {!error && !duplicate && checking ? (
          <p className="text-xs text-muted-foreground">{t('customers.people.form.emailChecking')}</p>
        ) : null}
      </div>
    )
  },
})

type DictionaryFieldDefinition = {
  id: 'jobTitle' | 'status' | 'lifecycleStage' | 'source'
  kind: 'job-titles' | 'statuses' | 'lifecycle-stages' | 'sources'
  labelKey: string
  placeholderKey: string
  addLabelKey: string
  promptKey: string
  dialogTitleKey: string
  layout?: CrudField['layout']
}

const dictionaryFieldDefinitions: DictionaryFieldDefinition[] = [
  {
    id: 'jobTitle',
    kind: 'job-titles',
    labelKey: 'customers.people.form.jobTitle',
    placeholderKey: 'customers.people.form.jobTitle.placeholder',
    addLabelKey: 'customers.people.form.dictionary.addJobTitle',
    promptKey: 'customers.people.form.dictionary.promptJobTitle',
    dialogTitleKey: 'customers.people.form.dictionary.dialogTitleJobTitle',
    layout: 'half',
  },
  {
    id: 'status',
    kind: 'statuses',
    labelKey: 'customers.people.form.status',
    placeholderKey: 'customers.people.form.status.placeholder',
    addLabelKey: 'customers.people.form.dictionary.addStatus',
    promptKey: 'customers.people.form.dictionary.promptStatus',
    dialogTitleKey: 'customers.people.form.dictionary.dialogTitleStatus',
  },
  {
    id: 'lifecycleStage',
    kind: 'lifecycle-stages',
    labelKey: 'customers.people.form.lifecycleStage',
    placeholderKey: 'customers.people.form.lifecycleStage.placeholder',
    addLabelKey: 'customers.people.form.dictionary.addLifecycleStage',
    promptKey: 'customers.people.form.dictionary.promptLifecycleStage',
    dialogTitleKey: 'customers.people.form.dictionary.dialogTitleLifecycleStage',
  },
  {
    id: 'source',
    kind: 'sources',
    labelKey: 'customers.people.form.source',
    placeholderKey: 'customers.people.form.source.placeholder',
    addLabelKey: 'customers.people.form.dictionary.addSource',
    promptKey: 'customers.people.form.dictionary.promptSource',
    dialogTitleKey: 'customers.people.form.dictionary.dialogTitleSource',
  },
]

const buildDictionaryLabels = (t: Translator, definition: DictionaryFieldDefinition): DictionarySelectLabels => ({
  placeholder: t(definition.placeholderKey),
  addLabel: t(definition.addLabelKey),
  addPrompt: t(definition.promptKey),
  dialogTitle: t(definition.dialogTitleKey),
  valueLabel: t('customers.people.form.dictionary.valueLabel', 'Value'),
  valuePlaceholder: t('customers.people.form.dictionary.valuePlaceholder', 'Value'),
  labelLabel: t('customers.config.dictionaries.dialog.labelLabel', 'Label'),
  labelPlaceholder: t('customers.people.form.dictionary.labelPlaceholder', 'Display name shown in UI'),
  emptyError: t('customers.people.form.dictionary.errorRequired'),
  cancelLabel: t('customers.people.form.dictionary.cancel'),
  saveLabel: t('customers.people.form.dictionary.save'),
  successCreateLabel: undefined,
  errorLoad: t('customers.people.form.dictionary.errorLoad'),
  errorSave: t('customers.people.form.dictionary.error'),
  loadingLabel: t('customers.people.form.dictionary.loading'),
  manageTitle: t('customers.people.form.dictionary.manage'),
})

const createPrimaryPhoneField = (t: Translator): CrudField => ({
  id: 'primaryPhone',
  label: t('customers.people.form.primaryPhone'),
  type: 'custom',
  component: function PrimaryPhoneField({ value, setValue, error, autoFocus, disabled, recordId }: CrudCustomFieldRenderProps) {
    const currentRecordId = React.useMemo(() => (typeof recordId === 'string' ? recordId : null), [recordId])

    const duplicateLookup = React.useCallback(
      async (digits: string) => {
        if (disabled || error) return null
        return lookupPhoneDuplicate(digits, { recordId: currentRecordId })
      },
      [currentRecordId, disabled, error]
    )

    return (
      <PhoneNumberField
        value={typeof value === 'string' ? value : null}
        onValueChange={(next) => setValue(typeof next === 'string' ? next : undefined)}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={t('customers.people.form.primaryPhonePlaceholder', '+00 000 000 000')}
        checkingLabel={t('customers.people.form.phoneChecking')}
        duplicateLabel={(match) => t('customers.people.form.phoneDuplicateNotice', { name: match.label })}
        duplicateLinkLabel={t('customers.people.form.phoneDuplicateLink')}
        minDigits={7}
        onDuplicateLookup={!disabled && !error ? duplicateLookup : undefined}
      />
    )
  },
})

const blankToUndefined = (value?: string): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

type CompanySelectLabels = {
  placeholder: string
  addLabel: string
  addPrompt?: string
  dialogTitle: string
  inputLabel: string
  inputPlaceholder: string
  emptyError: string
  cancelLabel: string
  saveLabel: string
  errorLoad: string
  errorSave: string
  loadingLabel: string
}

type CompanySelectFieldProps = {
  value?: string
  onChange: (value: string | undefined) => void
  labels: CompanySelectLabels
}

type CompanyOption = { value: string; label: string }

function normalizeCompanyOption(raw: unknown): CompanyOption | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Record<string, unknown>
  const id = typeof candidate.id === 'string' ? candidate.id : null
  if (!id) return null
  const displayName =
    typeof candidate.display_name === 'string' && candidate.display_name.trim().length
      ? candidate.display_name.trim()
      : typeof candidate.displayName === 'string' && candidate.displayName.trim().length
        ? candidate.displayName.trim()
        : null
  if (!displayName) return null
  return { value: id, label: displayName }
}

export function CompanySelectField({ value, onChange, labels }: CompanySelectFieldProps) {
  const [options, setOptions] = React.useState<CompanyOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [newCompany, setNewCompany] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

  const loadOptions = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/customers/companies?pageSize=100&sortField=name&sortDir=asc')
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : labels.errorLoad
        flash(message, 'error')
        setOptions([])
        return
      }
      const items = Array.isArray(payload?.items) ? payload.items : []
      const normalized = items
        .map((item) => normalizeCompanyOption(item))
        .filter((item): item is CompanyOption => !!item)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      setOptions(normalized)
    } catch {
      flash(labels.errorLoad, 'error')
      setOptions([])
    } finally {
      setLoading(false)
    }
  }, [labels.errorLoad])

  React.useEffect(() => {
    loadOptions().catch(() => {})
  }, [loadOptions])

  const handleDialogChange = React.useCallback((open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setNewCompany('')
      setFormError(null)
      setSaving(false)
    }
  }, [])

  const handleDialogSubmit = React.useCallback(async () => {
    if (saving) return
    const trimmed = newCompany.trim()
    if (!trimmed) {
      setFormError(labels.emptyError)
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/api/customers/companies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : labels.errorSave
        flash(message, 'error')
        return
      }
      const createdId =
        typeof payload?.id === 'string'
          ? payload.id
          : typeof payload?.entityId === 'string'
            ? payload.entityId
            : null
      await loadOptions()
      if (createdId) {
        onChange(createdId)
      }
      setDialogOpen(false)
      setNewCompany('')
      setFormError(null)
    } catch {
      flash(labels.errorSave, 'error')
    } finally {
      setSaving(false)
    }
  }, [labels.emptyError, labels.errorSave, loadOptions, newCompany, onChange, saving])

  const handleInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        handleDialogSubmit().catch(() => {})
      }
    },
    [handleDialogSubmit]
  )

  const disabled = loading || saving

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          className="w-full h-9 rounded border px-2 text-sm"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value ? event.target.value : undefined)}
          disabled={loading}
        >
          <option value="">{labels.placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label={labels.addLabel}
              title={labels.addLabel}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{labels.dialogTitle}</DialogTitle>
              {labels.addPrompt ? <DialogDescription>{labels.addPrompt}</DialogDescription> : null}
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">{labels.inputLabel}</label>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={labels.inputPlaceholder}
                  value={newCompany}
                  onChange={(event) => {
                    setNewCompany(event.target.value)
                    if (formError) setFormError(null)
                  }}
                  onKeyDown={handleInputKeyDown}
                  autoFocus
                  disabled={saving}
                />
              </div>
              {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                  {labels.cancelLabel}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    handleDialogSubmit().catch(() => {})
                  }}
                  disabled={saving || !newCompany.trim()}
                >
                  {saving ? `${labels.saveLabel}…` : labels.saveLabel}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? <div className="text-xs text-muted-foreground">{labels.loadingLabel}</div> : null}
    </div>
  )
}

export const createPersonFormSchema = () =>
  z
    .object({
      firstName: z.string().trim().min(1),
      lastName: z.string().trim().min(1),
      primaryEmail: z
        .string()
        .trim()
        .email()
        .optional()
        .or(z.literal(''))
        .transform((val) => (val === '' ? undefined : val)),
      status: z
        .string()
        .trim()
        .optional()
        .or(z.literal(''))
        .transform((val) => (val === '' ? undefined : val))
        .optional(),
      lifecycleStage: z
        .string()
        .trim()
        .optional()
        .or(z.literal(''))
        .transform((val) => (val === '' ? undefined : val))
        .optional(),
      source: z
        .string()
        .trim()
        .optional()
        .or(z.literal(''))
        .transform((val) => (val === '' ? undefined : val))
        .optional(),
      companyEntityId: z
        .string()
        .trim()
        .uuid()
        .optional()
        .or(z.literal(''))
        .transform((val) => (val === '' ? undefined : val))
        .optional(),
    })
    .passthrough()

export const createDisplayNameSection = (t: Translator) =>
  function DisplayNameSection({ values, setValue, errors }: CrudFormGroupComponentProps) {
    const [editing, setEditing] = React.useState(false)
    const [manualOverride, setManualOverride] = React.useState(() => {
      const current = typeof values.displayName === 'string' ? values.displayName.trim() : ''
      return current.length > 0
    })

    const first = typeof values.firstName === 'string' ? values.firstName.trim() : ''
    const last = typeof values.lastName === 'string' ? values.lastName.trim() : ''
    const derived = React.useMemo(() => {
      const parts = [first, last].filter((part) => !!part)
      return parts.join(' ').trim()
    }, [first, last])

    React.useEffect(() => {
      if (!manualOverride) {
        const target = derived || ''
        const current = typeof values.displayName === 'string' ? values.displayName : ''
        if (current !== target) {
          setValue('displayName', target)
        }
      }
    }, [manualOverride, derived, setValue, values.displayName])

    const currentValue = typeof values.displayName === 'string' ? values.displayName : ''
    const previewValue = currentValue || derived
    const placeholder = t('customers.people.form.displayNamePreview.empty')
    const error = errors.displayName

    const toggleEditing = () => {
      if (!editing && !manualOverride) {
        const target = derived || previewValue || ''
        setValue('displayName', target)
        setManualOverride(true)
      }
      setEditing((state) => !state)
    }

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!manualOverride) setManualOverride(true)
      setValue('displayName', event.target.value)
    }

    const handleReset = () => {
      setManualOverride(false)
      setEditing(false)
    }

    return (
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('customers.people.form.displayNamePreview')}
            </div>
            {editing ? (
              <div className="mt-2 space-y-2">
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={currentValue}
                  onChange={handleChange}
                  placeholder={t('customers.people.form.displayName.placeholder')}
                />
                {error ? <p className="text-xs text-red-600">{error}</p> : null}
              </div>
            ) : (
              <div className="mt-1 text-base font-medium">{previewValue || placeholder}</div>
            )}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={toggleEditing}>
            {editing ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                {t('customers.people.form.displayName.done')}
              </>
            ) : (
              <>
                <Pencil className="mr-2 h-4 w-4" />
                {t('customers.people.form.displayName.edit')}
              </>
            )}
          </Button>
        </div>
        {manualOverride ? (
          <div className="mt-3">
            <Button type="button" variant="ghost" size="sm" onClick={handleReset} disabled={!derived}>
              {t('customers.people.form.displayName.reset')}
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

export const createPersonFormFields = (t: Translator): CrudField[] => {
  const contactSection = createSectionHeadingField('__contactInformationSection', t('customers.people.form.sections.contactInformation'))
  const companySection = createSectionHeadingField('__companyInformationSection', t('customers.people.form.sections.companyInformation'))
const dictionaryFields: CrudField[] = dictionaryFieldDefinitions.map((definition) => ({
  id: definition.id,
  label: t(definition.labelKey),
  type: 'custom',
  layout: definition.layout ?? 'third',
  component: ({ value, setValue }: CrudCustomFieldRenderProps) => (
    <DictionarySelectField
      kind={definition.kind}
      value={typeof value === 'string' ? value : undefined}
      onChange={(next) => setValue(next)}
        labels={buildDictionaryLabels(t, definition)}
      />
    ),
  }))

  return [
    { id: 'displayName', label: t('customers.people.form.displayName.label'), type: 'text', required: true },
    { id: 'firstName', label: t('customers.people.form.firstName'), type: 'text', required: true, layout: 'half' },
    { id: 'lastName', label: t('customers.people.form.lastName'), type: 'text', required: true, layout: 'half' },
    contactSection,
    createPrimaryEmailField(t),
    createPrimaryPhoneField(t),
    companySection,
    {
      id: 'companyEntityId',
      label: t('customers.people.form.company'),
      type: 'custom',
      layout: 'half',
      component: ({ value, setValue }) => (
        <CompanySelectField
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => setValue(next)}
          labels={{
            placeholder: t('customers.people.form.company.placeholder'),
            addLabel: t('customers.people.form.company.add'),
            addPrompt: t('customers.people.form.company.prompt'),
            dialogTitle: t('customers.people.form.company.dialogTitle'),
            inputLabel: t('customers.people.form.company.inputLabel'),
            inputPlaceholder: t('customers.people.form.company.inputPlaceholder'),
            emptyError: t('customers.people.form.dictionary.errorRequired'),
            cancelLabel: t('customers.people.form.dictionary.cancel'),
            saveLabel: t('customers.people.form.dictionary.save'),
            errorLoad: t('customers.people.form.dictionary.errorLoad'),
            errorSave: t('customers.people.form.dictionary.error'),
            loadingLabel: t('customers.people.form.company.loading'),
          }}
        />
      ),
    },
    ...dictionaryFields,
    { id: 'description', label: t('customers.people.form.description'), type: 'textarea' },
    {
      id: 'addresses',
      label: '',
      type: 'custom',
      layout: 'full',
      component: ({ value, setValue }: CrudCustomFieldRenderProps) => {
        const addresses = Array.isArray(value) ? (value as CustomerAddressValue[]) : []
        return (
          <CustomerAddressTiles
            addresses={addresses}
            t={t}
            emptyLabel={t('customers.people.detail.empty.addresses')}
            gridClassName="grid gap-4 min-[480px]:grid-cols-1 xl:grid-cols-2"
            onCreate={async (payload: CustomerAddressInput) => {
              const nextId =
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                  ? crypto.randomUUID()
                  : `tmp-${Math.random().toString(36).slice(2)}`
              const next: CustomerAddressValue = {
                id: nextId,
                name: payload.name ?? null,
                purpose: payload.purpose ?? null,
                addressLine1: payload.addressLine1,
                addressLine2: payload.addressLine2 ?? null,
                buildingNumber: payload.buildingNumber ?? null,
                flatNumber: payload.flatNumber ?? null,
                city: payload.city ?? null,
                region: payload.region ?? null,
                postalCode: payload.postalCode ?? null,
                country: payload.country ?? null,
                isPrimary: payload.isPrimary ?? false,
              }
              const current = Array.isArray(addresses) ? addresses : []
              const nextAddresses =
                next.isPrimary === true
                  ? [next, ...current.map((item) => ({ ...item, isPrimary: false }))]
                  : [next, ...current]
              setValue(nextAddresses)
            }}
            onUpdate={async (id, payload) => {
              const current = Array.isArray(addresses) ? addresses : []
              const updated = current.map((item) => {
                if (item.id !== id) {
                  return payload.isPrimary ? { ...item, isPrimary: false } : item
                }
                return {
                  ...item,
                  name: payload.name ?? null,
                  purpose: payload.purpose ?? null,
                  addressLine1: payload.addressLine1,
                  addressLine2: payload.addressLine2 ?? null,
                  buildingNumber: payload.buildingNumber ?? null,
                  flatNumber: payload.flatNumber ?? null,
                  city: payload.city ?? null,
                  region: payload.region ?? null,
                  postalCode: payload.postalCode ?? null,
                  country: payload.country ?? null,
                  isPrimary: payload.isPrimary ?? false,
                }
              })
              setValue(updated)
            }}
            onDelete={async (id) => {
              const current = Array.isArray(addresses) ? addresses : []
              setValue(current.filter((item) => item.id !== id))
            }}
          />
        )
      },
    },
  ]
}

export const createPersonFormGroups = (t: Translator): CrudFormGroup[] => [
  {
    id: 'details',
    title: t('customers.people.form.groups.details'),
    column: 1,
    fields: [
      'firstName',
      'lastName',
      '__contactInformationSection',
      'primaryEmail',
      'primaryPhone',
      '__companyInformationSection',
      'jobTitle',
      'companyEntityId',
      'status',
      'lifecycleStage',
      'source',
    ],
    component: createDisplayNameSection(t),
  },
  {
    id: 'addresses',
    title: t('customers.people.form.groups.addresses'),
    column: 1,
    fields: ['addresses'],
  },
  {
    id: 'notes',
    title: t('customers.people.form.groups.notes'),
    column: 2,
    fields: ['description'],
  },
  {
    id: 'customFields',
    title: t('customers.people.form.groups.custom'),
    column: 2,
    kind: 'customFields',
  },
]

export function buildPersonPayload(values: PersonFormValues, organizationId?: string | null): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  const displayNameValue = typeof values.displayName === 'string' ? values.displayName.trim() : ''
  if (!displayNameValue) {
    throw new Error('DISPLAY_NAME_REQUIRED')
  }
  payload.displayName = displayNameValue
  payload.firstName = typeof values.firstName === 'string' ? values.firstName.trim() : ''
  payload.lastName = typeof values.lastName === 'string' ? values.lastName.trim() : ''

  const assign = (key: string, val?: string) => {
    const normalized = blankToUndefined(val)
    if (normalized !== undefined) payload[key] = normalized
  }

  assign('jobTitle', typeof values.jobTitle === 'string' ? values.jobTitle : undefined)
  assign('primaryEmail', typeof values.primaryEmail === 'string' ? values.primaryEmail : undefined)
  assign('primaryPhone', typeof values.primaryPhone === 'string' ? values.primaryPhone : undefined)
  assign('status', typeof values.status === 'string' ? values.status : undefined)
  assign('lifecycleStage', typeof values.lifecycleStage === 'string' ? values.lifecycleStage : undefined)
  assign('source', typeof values.source === 'string' ? values.source : undefined)
  assign('companyEntityId', typeof values.companyEntityId === 'string' ? values.companyEntityId : undefined)
  assign('description', typeof values.description === 'string' ? values.description : undefined)

  for (const [key, fieldValue] of Object.entries(values)) {
    if (key.startsWith('cf_')) {
      payload[key] = fieldValue
    }
  }

  if (organizationId) payload.organizationId = organizationId

  return payload
}
