"use client"

import * as React from 'react'
import { Building2, Plus, UserRound } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs/LookupSelect'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type CustomerKind = 'person' | 'company'

/**
 * D-9: the project points at `customers.customer_entities`, the supertype, so a
 * client may be a company or a sole trader without a second code path. The
 * customers module exposes no supertype list route — `people` and `companies`
 * both query the supertype table but hard-filter by `kind` — so the picker
 * merges the two calls and re-attaches the kind the responses strip.
 */
export type CustomerSelection = {
  id: string
  name: string
  kind: CustomerKind
  email?: string | null
  taxId?: string | null
}

type CustomerRow = {
  id?: unknown
  display_name?: unknown
  displayName?: unknown
  primary_email?: unknown
  primaryEmail?: unknown
  domain?: unknown
  legal_name?: unknown
  tax_id?: unknown
  taxId?: unknown
  vat_id?: unknown
}

const PAGE_SIZE = 20

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readTaxId(row: CustomerRow): string | null {
  return readString(row.taxId) ?? readString(row.tax_id) ?? readString(row.vat_id)
}

function toSelection(row: CustomerRow, kind: CustomerKind): CustomerSelection | null {
  const id = readString(row.id)
  if (!id) return null
  const name =
    readString(row.display_name) ??
    readString(row.displayName) ??
    readString(row.legal_name) ??
    readString(row.primary_email) ??
    id
  return {
    id,
    name,
    kind,
    email: readString(row.primary_email) ?? readString(row.primaryEmail),
    taxId: readTaxId(row),
  }
}

async function fetchCustomerPage(
  resource: 'people' | 'companies',
  params: Record<string, string>,
): Promise<CustomerSelection[]> {
  const kind: CustomerKind = resource === 'people' ? 'person' : 'company'
  const search = new URLSearchParams({ page: '1', pageSize: String(PAGE_SIZE), ...params })
  try {
    const res = await apiCall<{ items?: CustomerRow[] }>(`/api/customers/${resource}?${search.toString()}`)
    const items = Array.isArray(res.result?.items) ? res.result.items : []
    return items
      .map((row) => toSelection(row, kind))
      .filter((row): row is CustomerSelection => row !== null)
  } catch {
    // The customers module is an optional peer: a missing or forbidden route
    // degrades this side of the picker to "no results", never to a hard error.
    return []
  }
}

export async function searchCustomers(query: string): Promise<CustomerSelection[]> {
  const trimmed = query.trim()
  const params: Record<string, string> = trimmed.length > 0 ? { search: trimmed } : {}
  const [people, companies] = await Promise.all([
    fetchCustomerPage('people', params),
    fetchCustomerPage('companies', params),
  ])
  return [...companies, ...people]
}

export async function resolveCustomerById(customerId: string): Promise<CustomerSelection | null> {
  const [people, companies] = await Promise.all([
    fetchCustomerPage('people', { id: customerId, pageSize: '1' }),
    fetchCustomerPage('companies', { id: customerId, pageSize: '1' }),
  ])
  return companies[0] ?? people[0] ?? null
}

type NewCustomerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (customer: CustomerSelection) => void
}

function NewCustomerDialog({ open, onOpenChange, onCreated }: NewCustomerDialogProps) {
  const t = useT()
  const { organizationId } = useOrganizationScopeDetail()
  const [kind, setKind] = React.useState<CustomerKind>('company')
  const [displayName, setDisplayName] = React.useState('')
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) return
    setKind('company')
    setDisplayName('')
    setFirstName('')
    setLastName('')
    setEmail('')
    setError(null)
    setSaving(false)
  }, [open])

  const submit = React.useCallback(async () => {
    if (saving) return
    const trimmedEmail = email.trim()
    const resource = kind === 'company' ? 'companies' : 'people'
    const name =
      kind === 'company'
        ? displayName.trim()
        : [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
    if (kind === 'company' && !displayName.trim()) {
      setError(t('staff.time_tracking.projects.customer.new.nameRequired', 'A name is required.'))
      return
    }
    if (kind === 'person' && (!firstName.trim() || !lastName.trim())) {
      setError(t('staff.time_tracking.projects.customer.new.nameRequired', 'A name is required.'))
      return
    }
    const payload: Record<string, unknown> = organizationId ? { organizationId } : {}
    if (kind === 'company') {
      payload.displayName = displayName.trim()
    } else {
      payload.firstName = firstName.trim()
      payload.lastName = lastName.trim()
      payload.displayName = name
    }
    if (trimmedEmail) payload.primaryEmail = trimmedEmail

    setSaving(true)
    setError(null)
    try {
      const { result } = await createCrud<{ id?: string; entityId?: string }>(
        `customers/${resource}`,
        payload,
        { errorMessage: t('staff.time_tracking.projects.customer.new.error', 'Failed to create the customer.') },
      )
      const id = readString(result?.entityId) ?? readString(result?.id)
      if (!id) {
        setError(t('staff.time_tracking.projects.customer.new.error', 'Failed to create the customer.'))
        return
      }
      onCreated({ id, name, kind, email: trimmedEmail || null, taxId: null })
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('staff.time_tracking.projects.customer.new.error', 'Failed to create the customer.'),
      )
    } finally {
      setSaving(false)
    }
  }, [displayName, email, firstName, kind, lastName, onCreated, onOpenChange, organizationId, saving, t])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('staff.time_tracking.projects.customer.new.title', 'New customer')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <SegmentedControl
            value={kind}
            onValueChange={(next) => setKind(next as CustomerKind)}
            aria-label={t('staff.time_tracking.projects.customer.new.kind', 'Customer type')}
          >
            <SegmentedControlItem value="company">
              {t('staff.time_tracking.projects.customer.new.company', 'Company')}
            </SegmentedControlItem>
            <SegmentedControlItem value="person">
              {t('staff.time_tracking.projects.customer.new.person', 'Sole trader')}
            </SegmentedControlItem>
          </SegmentedControl>

          {kind === 'company' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tt-new-customer-name">
                {t('staff.time_tracking.projects.customer.new.name', 'Name')}
              </Label>
              <Input
                id="tt-new-customer-name"
                value={displayName}
                autoFocus
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tt-new-customer-first">
                  {t('staff.time_tracking.projects.customer.new.firstName', 'First name')}
                </Label>
                <Input
                  id="tt-new-customer-first"
                  value={firstName}
                  autoFocus
                  onChange={(event) => setFirstName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tt-new-customer-last">
                  {t('staff.time_tracking.projects.customer.new.lastName', 'Last name')}
                </Label>
                <Input
                  id="tt-new-customer-last"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tt-new-customer-email">
              {t('staff.time_tracking.projects.customer.new.email', 'Email')}
            </Label>
            <Input
              id="tt-new-customer-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('staff.time_tracking.projects.form.actions.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {t('staff.time_tracking.projects.customer.new.submit', 'Create customer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type CustomerPickerProps = {
  value: string | null
  snapshot?: CustomerSelection | null
  disabled?: boolean
  onChange: (customer: CustomerSelection | null) => void
}

export function CustomerPicker({ value, snapshot, disabled, onChange }: CustomerPickerProps) {
  const t = useT()
  const [known, setKnown] = React.useState<Map<string, CustomerSelection>>(() => {
    const initial = new Map<string, CustomerSelection>()
    if (snapshot?.id) initial.set(snapshot.id, snapshot)
    return initial
  })
  const [dialogOpen, setDialogOpen] = React.useState(false)

  React.useEffect(() => {
    if (!value || known.has(value)) return
    let cancelled = false
    void resolveCustomerById(value).then((resolved) => {
      if (cancelled || !resolved) return
      setKnown((prev) => new Map(prev).set(resolved.id, resolved))
    })
    return () => { cancelled = true }
  }, [value, known])

  const fetchItems = React.useCallback(async (query: string): Promise<LookupSelectItem[]> => {
    const results = await searchCustomers(query)
    setKnown((prev) => {
      const next = new Map(prev)
      results.forEach((row) => next.set(row.id, row))
      return next
    })
    return results.map((row) => ({
      id: row.id,
      title: row.name,
      subtitle: row.email ?? null,
      icon: row.kind === 'company'
        ? <Building2 className="h-4 w-4" aria-hidden />
        : <UserRound className="h-4 w-4" aria-hidden />,
      badge: row.kind === 'company'
        ? t('staff.time_tracking.projects.customer.kind.company', 'Company')
        : t('staff.time_tracking.projects.customer.kind.person', 'Sole trader'),
    }))
  }, [t])

  const handleChange = React.useCallback(
    (next: string | null) => {
      if (!next) {
        onChange(null)
        return
      }
      onChange(known.get(next) ?? { id: next, name: next, kind: 'company' })
    },
    [known, onChange],
  )

  const handleCreated = React.useCallback(
    (customer: CustomerSelection) => {
      setKnown((prev) => new Map(prev).set(customer.id, customer))
      onChange(customer)
    },
    [onChange],
  )

  return (
    <div className="flex flex-col gap-2">
      <LookupSelect
        value={value}
        onChange={handleChange}
        fetchItems={fetchItems}
        disabled={disabled}
        defaultOpen={false}
        minQuery={2}
        placeholder={t('staff.time_tracking.projects.customer.placeholder', 'Search customers…')}
        selectedHintLabel={(id) => known.get(id)?.name ?? id}
        actionSlot={(
          <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('staff.time_tracking.projects.customer.new.trigger', 'New customer')}
          </Button>
        )}
      />
      <NewCustomerDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={handleCreated} />
    </div>
  )
}

export type CustomerPickerBindingProps = {
  value: unknown
  values?: Record<string, unknown>
  disabled?: boolean
  setValue: (value: unknown) => void
  setFormValue?: (id: string, value: unknown) => void
}

/**
 * Writes the FK plus the snapshot fields the project keeps alongside it, so the
 * projects list and the report header resolve a customer name without joining
 * the customers module (D-9, cross-module FK-id + snapshot rule).
 */
export function CustomerPickerBinding({
  value,
  values,
  disabled,
  setValue,
  setFormValue,
}: CustomerPickerBindingProps) {
  const customerId = typeof value === 'string' && value.length > 0 ? value : null
  const snapshot = React.useMemo<CustomerSelection | null>(() => {
    const name = typeof values?.customerName === 'string' ? values.customerName : null
    if (!customerId || !name) return null
    const kind = values?.customerKind === 'person' ? 'person' : 'company'
    const taxId = typeof values?.customerTaxId === 'string' ? values.customerTaxId : null
    return { id: customerId, name, kind, taxId }
  }, [customerId, values?.customerKind, values?.customerName, values?.customerTaxId])

  const handleChange = React.useCallback(
    (next: CustomerSelection | null) => {
      setValue(next?.id ?? null)
      setFormValue?.('customerName', next?.name ?? null)
      setFormValue?.('customerKind', next?.kind ?? null)
      setFormValue?.('customerTaxId', next?.taxId ?? null)
    },
    [setFormValue, setValue],
  )

  return (
    <CustomerPicker
      value={customerId}
      snapshot={snapshot}
      disabled={disabled}
      onChange={handleChange}
    />
  )
}
