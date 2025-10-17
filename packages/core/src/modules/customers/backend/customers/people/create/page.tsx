"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'

type CreatePersonFormValues = {
  firstName: string
  lastName: string
  jobTitle?: string
  primaryEmail?: string
  primaryPhone?: string
  status?: string
  lifecycleStage?: string
  source?: string
  description?: string
} & Record<string, unknown>

type DictionaryOption = { value: string; label: string }

type DictionarySelectFieldProps = {
  kind: 'statuses' | 'sources'
  value?: string
  onChange: (value: string | undefined) => void
  placeholder: string
  addLabel: string
  addPrompt: string
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

function DictionarySelectField({
  kind,
  value,
  onChange,
  placeholder,
  addLabel,
  addPrompt,
  dialogTitle,
  inputLabel,
  inputPlaceholder,
  emptyError,
  cancelLabel,
  saveLabel,
  errorLoad,
  errorSave,
  loadingLabel,
}: DictionarySelectFieldProps) {
  const [options, setOptions] = React.useState<DictionaryOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [newOption, setNewOption] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)

  const loadOptions = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : errorLoad
        flash(message, 'error')
        setOptions([])
        return
      }
      const items = Array.isArray(payload?.items) ? payload.items : []
      const normalized = items
        .map((item: any) => {
          const rawValue = typeof item?.value === 'string' ? item.value.trim() : ''
          if (!rawValue) return null
          const label = typeof item?.label === 'string' && item.label.trim().length ? item.label.trim() : rawValue
          return { value: rawValue, label }
        })
        .filter((entry): entry is DictionaryOption => !!entry)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
      setOptions(normalized)
    } catch {
      flash(errorLoad, 'error')
      setOptions([])
    } finally {
      setLoading(false)
    }
  }, [errorLoad, kind])

  React.useEffect(() => {
    loadOptions().catch(() => {})
  }, [loadOptions])

  const resetDialogState = React.useCallback(() => {
    setNewOption('')
    setFormError(null)
    setSaving(false)
  }, [])

  const handleDialogChange = React.useCallback(
    (open: boolean) => {
      setDialogOpen(open)
      if (!open) {
        resetDialogState()
      }
    },
    [resetDialogState]
  )

  const handleAddSubmit = React.useCallback<React.FormEventHandler<HTMLFormElement>>(async (event) => {
    event.preventDefault()
    if (saving) return
    const trimmed = newOption.trim()
    if (!trimmed) {
      setFormError(emptyError)
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: trimmed }),
      })
      let payload: any = null
      try {
        payload = await res.json()
      } catch {
        payload = null
      }
      if (!res.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : errorSave
        flash(message, 'error')
        return
      }
      await loadOptions()
      const createdValue = typeof payload?.value === 'string' ? payload.value : trimmed
      onChange(createdValue || undefined)
      setDialogOpen(false)
      resetDialogState()
    } catch {
      flash(errorSave, 'error')
    } finally {
      setSaving(false)
    }
  }, [emptyError, errorSave, kind, loadOptions, newOption, onChange, resetDialogState, saving])

  const disabled = loading || saving

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          className="w-full h-9 rounded border px-2 text-sm"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value ? event.target.value : undefined)}
          disabled={disabled}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" onClick={() => onChange(undefined)} disabled={disabled}>
          {placeholder}
        </Button>
        <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" disabled={disabled}>
              + {addLabel}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{dialogTitle}</DialogTitle>
              {addPrompt ? <DialogDescription>{addPrompt}</DialogDescription> : null}
            </DialogHeader>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">{inputLabel}</label>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={inputPlaceholder}
                  value={newOption}
                  onChange={(event) => {
                    setNewOption(event.target.value)
                    if (formError) setFormError(null)
                  }}
                  autoFocus
                  disabled={saving}
                />
              </div>
              {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                  {cancelLabel}
                </Button>
                <Button type="submit" disabled={saving || !newOption.trim()}>
                  {saving ? `${saveLabel}…` : saveLabel}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? <div className="text-xs text-muted-foreground">{loadingLabel}</div> : null}
    </div>
  )
}

const blankToUndefined = (value?: string): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

export default function CreatePersonPage() {
  const t = useT()
  const router = useRouter()
  const { organizationId } = useOrganizationScopeDetail()

  const formSchema = React.useMemo(
    () =>
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
          source: z
            .string()
            .trim()
            .optional()
            .or(z.literal(''))
            .transform((val) => (val === '' ? undefined : val))
            .optional(),
        })
        .passthrough(),
    []
  )

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'firstName', label: t('customers.people.form.firstName'), type: 'text', required: true, layout: 'half' },
    { id: 'lastName', label: t('customers.people.form.lastName'), type: 'text', required: true, layout: 'half' },
    { id: 'jobTitle', label: t('customers.people.form.jobTitle'), type: 'text' },
    { id: 'primaryEmail', label: t('customers.people.form.primaryEmail'), type: 'text' },
    { id: 'primaryPhone', label: t('customers.people.form.primaryPhone'), type: 'text' },
    {
      id: 'status',
      label: t('customers.people.form.status'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <DictionarySelectField
          kind="statuses"
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => setValue(next)}
          placeholder={t('customers.people.form.status.placeholder')}
          addLabel={t('customers.people.form.dictionary.addStatus')}
          addPrompt={t('customers.people.form.dictionary.promptStatus')}
          dialogTitle={t('customers.people.form.dictionary.dialogTitleStatus')}
          inputLabel={t('customers.people.form.dictionary.valueLabel')}
          inputPlaceholder={t('customers.people.form.dictionary.valuePlaceholder')}
          emptyError={t('customers.people.form.dictionary.errorRequired')}
          cancelLabel={t('customers.people.form.dictionary.cancel')}
          saveLabel={t('customers.people.form.dictionary.save')}
          errorLoad={t('customers.people.form.dictionary.errorLoad')}
          errorSave={t('customers.people.form.dictionary.error')}
          loadingLabel={t('customers.people.form.dictionary.loading')}
        />
      ),
    },
    { id: 'lifecycleStage', label: t('customers.people.form.lifecycleStage'), type: 'text' },
    {
      id: 'source',
      label: t('customers.people.form.source'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <DictionarySelectField
          kind="sources"
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => setValue(next)}
          placeholder={t('customers.people.form.source.placeholder')}
          addLabel={t('customers.people.form.dictionary.addSource')}
          addPrompt={t('customers.people.form.dictionary.promptSource')}
          dialogTitle={t('customers.people.form.dictionary.dialogTitleSource')}
          inputLabel={t('customers.people.form.dictionary.valueLabel')}
          inputPlaceholder={t('customers.people.form.dictionary.valuePlaceholder')}
          emptyError={t('customers.people.form.dictionary.errorRequired')}
          cancelLabel={t('customers.people.form.dictionary.cancel')}
          saveLabel={t('customers.people.form.dictionary.save')}
          errorLoad={t('customers.people.form.dictionary.errorLoad')}
          errorSave={t('customers.people.form.dictionary.error')}
          loadingLabel={t('customers.people.form.dictionary.loading')}
        />
      ),
    },
    { id: 'description', label: t('customers.people.form.description'), type: 'textarea' },
  ], [t])

  const namePreview = React.useCallback(({ values }: { values: Record<string, any> }) => {
    const first = typeof values.firstName === 'string' ? values.firstName.trim() : ''
    const last = typeof values.lastName === 'string' ? values.lastName.trim() : ''
    const preview = [first, last].filter(Boolean).join(' ')
    return (
      <div className="rounded border bg-muted/30 px-3 py-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('customers.people.form.displayNamePreview')}
        </div>
        <div className="mt-1 font-medium">
          {preview || t('customers.people.form.displayNamePreview.empty')}
        </div>
      </div>
    )
  }, [t])

  const groups: CrudFormGroup[] = [
    {
      id: 'details',
      title: t('customers.people.form.groups.details'),
      column: 1,
      fields: ['firstName', 'lastName', 'jobTitle', 'primaryEmail', 'primaryPhone', 'status', 'lifecycleStage', 'source'],
      component: namePreview,
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

  return (
    <Page>
      <PageBody>
        <CrudForm<CreatePersonFormValues>
          title={t('customers.people.create.title')}
          backHref="/backend/customers/people"
          fields={fields}
          groups={groups}
          entityId={E.customers.customer_entity}
          submitLabel={t('customers.people.form.submit')}
          cancelHref="/backend/customers/people"
          schema={formSchema}
          onSubmit={async (values) => {
            const customFields: Record<string, unknown> = {}
            for (const [key, fieldValue] of Object.entries(values)) {
              if (key.startsWith('cf_')) {
                customFields[key.slice(3)] = fieldValue
              }
            }

            const payload: Record<string, unknown> = {
              firstName: values.firstName.trim(),
              lastName: values.lastName.trim(),
            }

            const assign = (key: string, val?: string) => {
              const normalized = blankToUndefined(val)
              if (normalized !== undefined) payload[key] = normalized
            }

            assign('jobTitle', values.jobTitle)
            assign('primaryEmail', values.primaryEmail)
            assign('primaryPhone', values.primaryPhone)
            assign('status', values.status)
            assign('lifecycleStage', values.lifecycleStage)
            assign('source', values.source)
            assign('description', values.description)

            if (Object.keys(customFields).length) {
              for (const [key, fieldValue] of Object.entries(customFields)) {
                payload[`cf_${key}`] = fieldValue
              }
            }

            if (organizationId) payload.organizationId = organizationId

            const res = await apiFetch('/api/customers/people', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })

            if (!res.ok) {
              let message = t('customers.people.form.error.create')
              try {
                const data = await res.clone().json()
                if (data && typeof data.error === 'string') message = data.error
              } catch {}
              throw new Error(message)
            }

            const created = await res.json().catch(() => null)
            const newId =
              created && typeof created.id === 'string'
                ? created.id
                : (typeof created?.entityId === 'string' ? created.entityId : null)

            flash(t('customers.people.form.success'), 'success')
            if (newId) router.push(`/backend/customers/people/${newId}`)
            else router.push('/backend/customers/people')
          }}
        />
      </PageBody>
    </Page>
  )
}
