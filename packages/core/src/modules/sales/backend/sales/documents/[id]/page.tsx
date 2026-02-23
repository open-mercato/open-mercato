// @ts-nocheck

"use client"

import * as React from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import {
  CustomDataSection,
  DetailFieldsSection,
  ErrorMessage,
  InlineTextEditor,
  LoadingMessage,
  TabEmptyState,
  TagsSection,
  type TagOption,
} from '@open-mercato/ui/backend/detail'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Input } from '@open-mercato/ui/primitives/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { ArrowRightLeft, Building2, CreditCard, Mail, Pencil, Plus, Send, Store, Truck, UserRound, Wand2, X } from 'lucide-react'
import { FormHeader, type ActionItem } from '@open-mercato/ui/backend/forms'
import { VersionHistoryAction } from '@open-mercato/ui/backend/version-history'
import Link from 'next/link'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { cn } from '@open-mercato/shared/lib/utils'
import { DocumentCustomerCard } from '@open-mercato/core/modules/sales/components/DocumentCustomerCard'
import { SalesDocumentAddressesSection } from '@open-mercato/core/modules/sales/components/documents/AddressesSection'
import { SalesDocumentItemsSection } from '@open-mercato/core/modules/sales/components/documents/ItemsSection'
import { SalesDocumentPaymentsSection } from '@open-mercato/core/modules/sales/components/documents/PaymentsSection'
import { SalesDocumentAdjustmentsSection } from '@open-mercato/core/modules/sales/components/documents/AdjustmentsSection'
import type { AdjustmentRowData } from '@open-mercato/core/modules/sales/components/documents/AdjustmentDialog'
import { SalesShipmentsSection } from '@open-mercato/core/modules/sales/components/documents/ShipmentsSection'
import { DocumentTotals } from '@open-mercato/core/modules/sales/components/documents/DocumentTotals'
import { E } from '#generated/entities.ids.generated'
import type { DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useCurrencyDictionary } from '@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary'
import type { SalesAdjustmentKind } from '@open-mercato/core/modules/sales/data/entities'
import { DictionaryValue, createDictionaryMap, renderDictionaryColor, renderDictionaryIcon, type DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { DictionaryEntrySelect } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useEmailDuplicateCheck } from '@open-mercato/core/modules/customers/backend/hooks/useEmailDuplicateCheck'
import { NotesSection, mapCommentSummary, type NotesDataAdapter } from '@open-mercato/ui/backend/detail'
import {
  emitSalesDocumentTotalsRefresh,
  subscribeSalesDocumentTotalsRefresh,
} from '@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents'
import {
  subscribeSalesDocumentDataRefresh,
} from '@open-mercato/core/modules/sales/lib/frontend/documentDataEvents'
import type { CommentSummary, SectionAction } from '@open-mercato/ui/backend/detail'
import { ICON_SUGGESTIONS } from '@open-mercato/core/modules/customers/lib/dictionaries'
import { readMarkdownPreferenceCookie, writeMarkdownPreferenceCookie } from '@open-mercato/core/modules/customers/lib/markdownPreference'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

function CurrencyInlineEditor({
  label,
  value,
  options,
  labels,
  emptyLabel,
  onSave,
  error,
  onClearError,
  locked,
  onLocked,
}: {
  label: string
  value: string | null | undefined
  options: { value: string; label: string; color?: string | null; icon?: string | null }[]
  labels: DictionarySelectLabels
  emptyLabel: string
  onSave: (next: string | null) => Promise<void>
  error: string | null
  onClearError: () => void
  locked?: boolean
  onLocked?: () => void
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const normalizedValue = React.useMemo(() => (typeof value === 'string' ? value.toUpperCase() : undefined), [value])
  const [draft, setDraft] = React.useState<string | undefined>(normalizedValue)
  const [saving, setSaving] = React.useState(false)
  const appearanceMap = React.useMemo(
    () =>
      createDictionaryMap(
        options.map((option) => ({
          value: option.value.toUpperCase(),
          label: option.label,
          color: option.color ?? undefined,
          icon: option.icon ?? undefined,
        }))
      ),
    [options]
  )

  React.useEffect(() => {
    if (!editing) setDraft(normalizedValue)
  }, [editing, normalizedValue])

  React.useEffect(() => {
    if (locked && editing) {
      setEditing(false)
    }
  }, [editing, locked])

  const fetchOptions = React.useCallback(async () => options, [options])

  const handleLocked = React.useCallback(() => {
    if (onLocked) onLocked()
  }, [onLocked])

  const handleActivate = React.useCallback(() => {
    if (locked) {
      onClearError()
      handleLocked()
      return
    }
    if (!editing) {
      setEditing(true)
    }
  }, [editing, handleLocked, locked, onClearError])

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    try {
      onClearError()
      await onSave(draft ?? null)
      setEditing(false)
    } catch (err) {
      console.error('sales.documents.currency.save', err)
    } finally {
      setSaving(false)
    }
  }, [draft, onClearError, onSave])

  return (
    <div
      className={cn(
        'group rounded-lg border bg-card p-4',
        !editing ? 'cursor-pointer' : null,
        locked ? 'cursor-not-allowed opacity-80' : null
      )}
      role={!editing ? 'button' : undefined}
      tabIndex={!editing ? 0 : undefined}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (editing) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleActivate()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <div
              className="mt-2 space-y-2"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  onClearError()
                  return
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!saving) {
                    void handleSave()
                  }
                }
              }}
            >
              <DictionaryEntrySelect
                value={draft}
                onChange={(next) => setDraft(next ? next.toUpperCase() : undefined)}
                fetchOptions={fetchOptions}
                allowInlineCreate={false}
                manageHref="/backend/config/dictionaries?key=currency"
                selectClassName="w-full"
                labels={labels}
              />
              <DictionaryValue
                value={draft ?? normalizedValue ?? null}
                map={appearanceMap}
                fallback={<span className="text-sm text-muted-foreground">{emptyLabel}</span>}
                className="text-sm text-foreground"
                iconWrapperClassName="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background"
                iconClassName="h-3.5 w-3.5"
                colorClassName="h-2.5 w-2.5 rounded-full border border-border/60"
              />
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('customers.people.detail.inline.saveShortcut')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onClearError()
                    setEditing(false)
                    setDraft(value ?? undefined)
                  }}
                  disabled={saving}
                >
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <DictionaryValue
              value={normalizedValue ?? null}
              map={appearanceMap}
              fallback={<span className="text-sm text-muted-foreground">{emptyLabel}</span>}
              className="mt-1 inline-flex items-center gap-2 text-sm text-foreground"
              iconWrapperClassName="inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background"
              iconClassName="h-3.5 w-3.5"
              colorClassName="h-2.5 w-2.5 rounded-full border border-border/60"
            />
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground transition-opacity duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation()
            if (locked) {
              onClearError()
              handleLocked()
              return
            }
            if (editing) {
              onClearError()
              setDraft(value ?? undefined)
            }
            setEditing((prev) => !prev)
          }}
          aria-disabled={locked ? true : undefined}
          aria-label={editing ? t('ui.detail.inline.cancel', 'Cancel') : t('ui.detail.inline.edit', 'Edit')}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

type SnapshotDraft = {
  displayName: string
  kind: 'company' | 'person'
  primaryEmail: string
  primaryPhone: string
  firstName: string
  lastName: string
  legalName: string
}

function createSnapshotDraft(
  snapshot: CustomerSnapshot | null,
  fallbackName: string | null,
  fallbackEmail: string | null,
): SnapshotDraft {
  const customer = snapshot?.customer ?? null
  const personProfile = customer?.personProfile ?? snapshot?.contact ?? null
  const companyProfile = customer?.companyProfile ?? null
  const resolvedKind: 'company' | 'person' =
    customer?.kind === 'person' || snapshot?.contact ? 'person' : 'company'
  return {
    displayName:
      (customer?.displayName && customer.displayName.trim()) ||
      (fallbackName && fallbackName.trim()) ||
      '',
    kind: resolvedKind,
    primaryEmail:
      (customer?.primaryEmail && customer.primaryEmail.trim()) ||
      (fallbackEmail && fallbackEmail.trim()) ||
      '',
    primaryPhone: (customer?.primaryPhone && customer.primaryPhone.trim()) || '',
    firstName: (personProfile?.firstName && personProfile.firstName.trim()) || '',
    lastName: (personProfile?.lastName && personProfile.lastName.trim()) || '',
    legalName: (companyProfile?.legalName && companyProfile.legalName.trim()) || '',
  }
}

function CustomerInlineEditor({
  label,
  customerId,
  customerName,
  customerEmail,
  customerSnapshot,
  customers,
  customerLoading,
  onLoadCustomers,
  fetchCustomerEmail,
  onSave,
  onSaveSnapshot,
  saving,
  error,
  guardMessage,
  onClearError,
}: {
  label: string
  customerId: string | null
  customerName: string | null
  customerEmail: string | null | undefined
  customerSnapshot: CustomerSnapshot | null
  customers: CustomerOption[]
  customerLoading: boolean
  onLoadCustomers: (query?: string) => Promise<CustomerOption[]>
  fetchCustomerEmail: (id: string, kindHint?: 'person' | 'company') => Promise<string | null>
  onSave: (id: string | null, email: string | null) => Promise<void>
  onSaveSnapshot: (snapshot: CustomerSnapshot) => Promise<void>
  saving: boolean
  error: string | null
  guardMessage?: string | null
  onClearError: () => void
}) {
  const t = useT()
  const [mode, setMode] = React.useState<'select' | 'snapshot' | null>(null)
  const [draftId, setDraftId] = React.useState<string | null>(customerId)
  const [draftEmail, setDraftEmail] = React.useState<string | null>(customerEmail ?? null)
  const [snapshotDraft, setSnapshotDraft] = React.useState<SnapshotDraft>(() =>
    createSnapshotDraft(customerSnapshot, customerName, customerEmail ?? null),
  )
  const selectedRef = React.useRef<string | null>(customerId)
  const customerQuerySetter = React.useRef<((value: string) => void) | null>(null)

  const currentLabel = React.useMemo(() => {
    if (customerName && customerName.trim().length) return customerName
    const match = customers.find((entry) => entry.id === customerId)
    return match?.label ?? null
  }, [customerId, customerName, customers])

  React.useEffect(() => {
    selectedRef.current = draftId
  }, [draftId])

  React.useEffect(() => {
    if (mode !== 'select') {
      setDraftId(customerId)
      setDraftEmail(customerEmail ?? null)
      onClearError()
    }
  }, [customerEmail, customerId, mode, onClearError])

  React.useEffect(() => {
    if (mode !== 'snapshot') {
      setSnapshotDraft(createSnapshotDraft(customerSnapshot, currentLabel, customerEmail ?? null))
    }
  }, [customerEmail, customerSnapshot, currentLabel, mode])

  React.useEffect(() => {
    if (mode !== 'select') return
    const labelValue = currentLabel
    if (labelValue && customerQuerySetter.current) {
      customerQuerySetter.current(labelValue)
    }
    void onLoadCustomers(labelValue ?? undefined)
  }, [currentLabel, mode, onLoadCustomers])

  const handleSelectActivate = React.useCallback(() => {
    if (guardMessage) {
      onClearError()
      flash(guardMessage, 'error')
      return
    }
    setMode('select')
    void onLoadCustomers()
  }, [guardMessage, onClearError, onLoadCustomers])

  const handleSnapshotActivate = React.useCallback(() => {
    if (guardMessage) {
      onClearError()
      flash(guardMessage, 'error')
      return
    }
    setMode('snapshot')
  }, [guardMessage, onClearError])

  const handleCancel = React.useCallback(() => {
    onClearError()
    setMode(null)
    setDraftId(customerId)
    setDraftEmail(customerEmail ?? null)
    setSnapshotDraft(createSnapshotDraft(customerSnapshot, currentLabel, customerEmail ?? null))
  }, [customerEmail, customerId, customerSnapshot, currentLabel, onClearError])

  const buildSnapshotPayload = React.useCallback((): CustomerSnapshot => {
    const kind = snapshotDraft.kind
    const displayNameRaw = snapshotDraft.displayName.trim()
    const primaryEmailRaw = snapshotDraft.primaryEmail.trim()
    const primaryPhoneRaw = snapshotDraft.primaryPhone.trim()
    const firstNameRaw = snapshotDraft.firstName.trim()
    const lastNameRaw = snapshotDraft.lastName.trim()
    const legalNameRaw = snapshotDraft.legalName.trim()
    const nameFromParts =
      kind === 'person'
        ? [firstNameRaw, lastNameRaw].filter((value) => value.length).join(' ').trim()
        : legalNameRaw
    const resolvedDisplayName = displayNameRaw || nameFromParts || null
    const baseCustomer = customerSnapshot?.customer ?? {}
    const nextPersonProfile =
      kind === 'person'
        ? {
            ...(baseCustomer.personProfile ?? customerSnapshot?.contact ?? {}),
            firstName: firstNameRaw || null,
            lastName: lastNameRaw || null,
          }
        : null
    const nextCompanyProfile =
      kind === 'company'
        ? { ...(baseCustomer.companyProfile ?? {}), legalName: legalNameRaw || null }
        : null
    return {
      ...(customerSnapshot ?? {}),
      customer: {
        ...baseCustomer,
        kind,
        displayName: resolvedDisplayName,
        primaryEmail: primaryEmailRaw || null,
        primaryPhone: primaryPhoneRaw || null,
        personProfile: nextPersonProfile,
        companyProfile: nextCompanyProfile,
      },
      contact: customerSnapshot?.contact ?? null,
    }
  }, [customerSnapshot, snapshotDraft])

  const handleSaveSelection = React.useCallback(async () => {
    try {
      onClearError()
      await onSave(draftId, draftEmail)
      setMode(null)
    } catch (err) {
      console.error('sales.documents.customer.save', err)
    }
  }, [draftEmail, draftId, onClearError, onSave])

  const handleSaveSnapshot = React.useCallback(async () => {
    try {
      onClearError()
      const payload = buildSnapshotPayload()
      await onSaveSnapshot(payload)
      setMode(null)
    } catch (err) {
      console.error('sales.documents.customer.snapshot.save', err)
    }
  }, [buildSnapshotPayload, onClearError, onSaveSnapshot])

  if (mode === 'select') {
    return (
      <div
        className="group h-full rounded-lg border bg-card p-4"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            handleCancel()
            return
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            if (!saving) void handleSaveSelection()
          }
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <LookupSelect
              value={draftId}
              onChange={(next) => {
                setDraftId(next)
                setDraftEmail(null)
                selectedRef.current = next
                if (!next) return
                const match = customers.find((entry) => entry.id === next)
                if (match?.primaryEmail) {
                  setDraftEmail(match.primaryEmail)
                } else {
                  const selectedId = next
                  fetchCustomerEmail(selectedId, match?.kind)
                    .then((resolved) => {
                      if (resolved && selectedRef.current === selectedId) setDraftEmail(resolved)
                    })
                    .catch(() => {})
                }
              }}
              fetchItems={async (query) => {
                const options = await onLoadCustomers(query)
                return options.map<LookupSelectItem>((opt) => ({
                  id: opt.id,
                  title: opt.label,
                  subtitle: opt.subtitle ?? undefined,
                  icon:
                    opt.kind === 'person' ? (
                      <UserRound className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                    ),
                }))
              }}
              onReady={({ setQuery }) => {
                customerQuerySetter.current = setQuery
              }}
              searchPlaceholder={t('sales.documents.form.customer.placeholder', 'Search customers…')}
              loadingLabel={t('sales.documents.form.customer.loading', 'Loading customers…')}
              emptyLabel={t('sales.documents.form.customer.empty', 'No customers found.')}
              selectedHintLabel={(id) =>
                t('sales.documents.form.customer.selected', 'Selected customer: {{id}}', { id })
              }
            />
            {customerLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="h-3.5 w-3.5 animate-spin" />
                {t('sales.documents.form.customer.loading', 'Loading customers…')}
              </p>
            ) : null}
            {draftEmail ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-3.5 w-3.5" aria-hidden />
                <span className="truncate">{draftEmail}</span>
              </p>
            ) : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={() => void handleSaveSelection()} disabled={saving}>
                {saving ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('customers.people.detail.inline.saveShortcut')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
                {t('ui.detail.inline.cancel', 'Cancel')}
              </Button>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground transition-opacity duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleCancel}
            aria-label={t('ui.detail.inline.cancel', 'Cancel')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  if (mode === 'snapshot') {
    return (
      <div
        className="group h-full rounded-lg border bg-card p-4"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            handleCancel()
            return
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            if (!saving) void handleSaveSnapshot()
          }
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              {t('sales.documents.detail.customerSnapshot.hint', 'Edit the snapshot stored on this document.')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground transition-opacity duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleCancel}
            aria-label={t('ui.detail.inline.cancel', 'Cancel')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">
                {t('customers.people.form.displayName.label', 'Display name')}
              </label>
              <Input
                value={snapshotDraft.displayName}
                onChange={(event) => setSnapshotDraft((prev) => ({ ...prev, displayName: event.target.value }))}
                placeholder={t('customers.people.form.displayName.placeholder', 'Enter display name')}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">
                {t('sales.documents.detail.customerSnapshot.kind', 'Customer type')}
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={snapshotDraft.kind === 'company' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setSnapshotDraft((prev) => ({ ...prev, kind: 'company' }))}
                >
                  {t('customers.widgets.newCustomers.kind.company', 'Company')}
                </Button>
                <Button
                  type="button"
                  variant={snapshotDraft.kind === 'person' ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setSnapshotDraft((prev) => ({ ...prev, kind: 'person' }))}
                >
                  {t('customers.widgets.newCustomers.kind.person', 'Person')}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">
                {t('customers.people.detail.highlights.primaryEmail', 'Primary email')}
              </label>
              <Input
                type="email"
                value={snapshotDraft.primaryEmail}
                onChange={(event) => setSnapshotDraft((prev) => ({ ...prev, primaryEmail: event.target.value }))}
                placeholder={t('customers.people.form.primaryEmailPlaceholder', 'name@example.com')}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">
                {t('customers.people.detail.highlights.primaryPhone', 'Primary phone')}
              </label>
              <Input
                type="tel"
                value={snapshotDraft.primaryPhone}
                onChange={(event) => setSnapshotDraft((prev) => ({ ...prev, primaryPhone: event.target.value }))}
                placeholder={t('customers.people.form.primaryPhonePlaceholder', '+00 000 000 000')}
              />
            </div>
          </div>

          {snapshotDraft.kind === 'person' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">
                  {t('customers.people.form.firstName', 'First name')}
                </label>
                <Input
                  value={snapshotDraft.firstName}
                  onChange={(event) => setSnapshotDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                  placeholder={t('customers.people.form.firstName', 'First name')}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground">
                  {t('customers.people.form.lastName', 'Last name')}
                </label>
                <Input
                  value={snapshotDraft.lastName}
                  onChange={(event) => setSnapshotDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                  placeholder={t('customers.people.form.lastName', 'Last name')}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">
                {t('customers.companies.detail.fields.legalName', 'Legal name')}
              </label>
              <Input
                value={snapshotDraft.legalName}
                onChange={(event) => setSnapshotDraft((prev) => ({ ...prev, legalName: event.target.value }))}
                placeholder={t('customers.companies.detail.fields.legalNamePlaceholder', 'Add legal name')}
              />
            </div>
          )}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => void handleSaveSnapshot()} disabled={saving}>
              {saving ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('customers.people.detail.inline.saveShortcut')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
              {t('ui.detail.inline.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <DocumentCustomerCard
      label={label}
      name={customerName ?? null}
      email={customerEmail ?? undefined}
      kind={customerSnapshot?.customer?.kind === 'person' ? 'person' : 'company'}
      className="h-full"
      onEditSnapshot={handleSnapshotActivate}
      onSelectCustomer={handleSelectActivate}
    />
  )
}

type CustomerSnapshot = {
  customer?: {
    id?: string | null
    kind?: 'person' | 'company' | null
    displayName?: string | null
    primaryEmail?: string | null
    primaryPhone?: string | null
    personProfile?: {
      id?: string | null
      firstName?: string | null
      lastName?: string | null
      preferredName?: string | null
    } | null
    companyProfile?: {
      id?: string | null
      legalName?: string | null
      brandName?: string | null
      domain?: string | null
      websiteUrl?: string | null
    } | null
  } | null
  contact?: {
    id?: string | null
    firstName?: string | null
    lastName?: string | null
    preferredName?: string | null
  } | null
}

type AddressSnapshot = {
  name?: string | null
  companyName?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
}

type CustomerOption = {
  id: string
  label: string
  subtitle?: string | null
  kind: 'person' | 'company'
  primaryEmail?: string | null
}

type ChannelOption = {
  id: string
  label: string
}

type ShippingMethodOption = {
  id: string
  name: string
  code: string
  description?: string | null
  carrierCode?: string | null
  serviceLevel?: string | null
  estimatedTransitDays?: number | null
  currencyCode?: string | null
  baseRateNet?: string | null
  baseRateGross?: string | null
  providerKey?: string | null
  providerSettings?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

type PaymentMethodOption = {
  id: string
  name: string
  code: string
  description?: string | null
  providerKey?: string | null
  terms?: string | null
  providerSettings?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

type StatusOption = {
  id: string
  value: string
  label: string
  color: string | null
  icon: string | null
}

type DocumentRecord = {
  id: string
  orderNumber?: string | null
  quoteNumber?: string | null
  status?: string | null
  statusEntryId?: string | null
  currencyCode?: string | null
  customerEntityId?: string | null
  billingAddressId?: string | null
  shippingAddressId?: string | null
  customerReference?: string | null
  externalReference?: string | null
  channelId?: string | null
  placedAt?: string | null
  expectedDeliveryAt?: string | null
  customerSnapshot?: Record<string, unknown> | null
  billingAddressSnapshot?: Record<string, unknown> | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  shippingMethodId?: string | null
  shippingMethodCode?: string | null
  shippingMethodSnapshot?: Record<string, unknown> | null
  paymentMethodId?: string | null
  paymentMethodCode?: string | null
  paymentMethodSnapshot?: Record<string, unknown> | null
  customerName?: string | null
  contactEmail?: string | null
  channelCode?: string | null
  comment?: string | null
  subtotalNetAmount?: number | null
  subtotalGrossAmount?: number | null
  discountTotalAmount?: number | null
  taxTotalAmount?: number | null
  shippingNetAmount?: number | null
  shippingGrossAmount?: number | null
  surchargeTotalAmount?: number | null
  grandTotalNetAmount?: number | null
  grandTotalGrossAmount?: number | null
  paidTotalAmount?: number | null
  refundedTotalAmount?: number | null
  outstandingAmount?: number | null
  createdAt?: string
  updatedAt?: string
  metadata?: Record<string, unknown> | null
  customFields?: Record<string, unknown> | null
  tags?: TagOption[] | null
}

type DocumentUpdateResult = {
  orderNumber?: string | null
  quoteNumber?: string | null
  externalReference?: string | null
  customerReference?: string | null
  comment?: string | null
  currencyCode?: string | null
  placedAt?: string | null
  expectedDeliveryAt?: string | null
  statusEntryId?: string | null
  status?: string | null
  channelId?: string | null
  shippingAddressId?: string | null
  billingAddressId?: string | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  billingAddressSnapshot?: Record<string, unknown> | null
  shippingMethodId?: string | null
  shippingMethodCode?: string | null
  shippingMethodSnapshot?: Record<string, unknown> | null
  paymentMethodId?: string | null
  paymentMethodCode?: string | null
  paymentMethodSnapshot?: Record<string, unknown> | null
  customerEntityId?: string | null
  customerSnapshot?: Record<string, unknown> | null
  customerName?: string | null
  contactEmail?: string | null
  metadata?: Record<string, unknown> | null
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined)
  }
  if (value === undefined) return null
  return value
}

const prefixCustomFieldValues = (input: Record<string, unknown> | null | undefined): Record<string, unknown> => {
  if (!input || typeof input !== 'object') return {}
  return Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const normalized = key.startsWith('cf_') ? key : `cf_${key}`
    acc[normalized] = value
    return acc
  }, {})
}

const resolveLineItemCount = (record: unknown): number | null => {
  if (!record || typeof record !== 'object') return null
  const current = (record as any).lineItemCount ?? (record as any).line_item_count
  if (typeof current !== 'number') return null
  return Number.isFinite(current) ? current : null
}

async function fetchDocument(id: string, kind: 'order' | 'quote', errorMessage: string): Promise<DocumentRecord | null> {
  const params = new URLSearchParams({ id, page: '1', pageSize: '1' })
  const payload = await readApiResultOrThrow<{ items?: DocumentRecord[] }>(
    `/api/sales/${kind === 'order' ? 'orders' : 'quotes'}?${params.toString()}`,
    undefined,
    { errorMessage }
  )
  const items = Array.isArray(payload?.items) ? payload.items : []
  return items.length ? (items[0] as DocumentRecord) : null
}

function resolveCustomerName(snapshot: CustomerSnapshot | null | undefined, fallback?: string | null) {
  if (!snapshot) return fallback ?? null
  const displayName =
    typeof snapshot.customer?.displayName === 'string' && snapshot.customer.displayName.trim().length
      ? snapshot.customer.displayName.trim()
      : null
  if (displayName) return displayName
  const contact = snapshot.contact ?? null
  const personProfile = snapshot.customer?.personProfile ?? null
  const preferred =
    (contact?.preferredName && contact.preferredName.trim()) ||
    (personProfile?.preferredName && personProfile.preferredName.trim()) ||
    null
  const firstName =
    (contact?.firstName && contact.firstName.trim()) ||
    (personProfile?.firstName && personProfile.firstName.trim()) ||
    null
  const lastName =
    (contact?.lastName && contact.lastName.trim()) ||
    (personProfile?.lastName && personProfile.lastName.trim()) ||
    null
  const parts = [preferred ?? firstName, lastName].filter((part) => part && part.length)
  if (parts.length) return parts.join(' ')
  const legalName =
    (snapshot.customer?.companyProfile?.legalName &&
      snapshot.customer.companyProfile.legalName.trim()) ||
    null
  if (legalName) return legalName
  return fallback ?? null
}

function resolveCustomerEmail(snapshot: CustomerSnapshot | null | undefined) {
  if (!snapshot) return null
  const primary =
    (snapshot.customer?.primaryEmail && snapshot.customer.primaryEmail.trim()) ||
    null
  if (primary) return primary
  return null
}

function parseCustomerOptions(items: unknown[], kind: 'person' | 'company'): CustomerOption[] {
  const parsed: CustomerOption[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : null
    if (!id) continue
    const displayName =
      typeof record.display_name === 'string'
        ? record.display_name
        : typeof record.name === 'string'
          ? record.name
          : null
    const email = typeof record.primary_email === 'string' ? record.primary_email : null
    const domain = typeof record.primary_domain === 'string' ? record.primary_domain : null
    const label = displayName ?? (email ?? domain ?? id)
    const subtitle = kind === 'person' ? email : domain ?? email
    parsed.push({ id, label: `${label}`, subtitle, kind, primaryEmail: email })
  }
  return parsed
}

function SectionCard({
  title,
  action,
  children,
  muted,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <div className={cn('rounded border p-4', muted ? 'bg-muted/30' : 'bg-card')}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function ContactEmailInlineEditor({
  label,
  value,
  placeholder,
  emptyLabel,
  onSave,
  renderDisplay,
  recordId,
}: {
  label: string
  value: string | null | undefined
  placeholder?: string
  emptyLabel: string
  renderDisplay: (params: { value: string | null | undefined; emptyLabel: string }) => React.ReactNode
  onSave: (next: string | null) => Promise<void>
  recordId?: string | null
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const trimmedDraft = React.useMemo(() => draft.trim(), [draft])
  const isValidEmail = React.useMemo(() => {
    if (!trimmedDraft.length) return true
    return EMAIL_REGEX.test(trimmedDraft)
  }, [trimmedDraft])
  const { duplicate, checking } = useEmailDuplicateCheck(draft, {
    recordId: typeof recordId === 'string' ? recordId : null,
    disabled: !editing || !!error || saving || !trimmedDraft.length || !isValidEmail,
    matchMode: 'prefix',
  })

  React.useEffect(() => {
    if (!editing) {
      setDraft(value ?? '')
      setError(null)
    }
  }, [editing, value])

  const handleSave = React.useCallback(async () => {
    const normalized = trimmedDraft.length ? trimmedDraft : ''
    if (normalized.length && !EMAIL_REGEX.test(normalized)) {
      setError(t('customers.people.detail.inline.emailInvalid', 'Enter a valid email address.'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave(normalized.length ? normalized : null)
      setEditing(false)
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('customers.people.detail.inline.error', 'Failed to save value.')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [onSave, t, trimmedDraft])

  const interactiveProps =
    !editing && !saving
      ? {
          role: 'button' as const,
          tabIndex: 0,
          onClick: () => setEditing(true),
          onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setEditing(true)
            }
          },
        }
      : {}

  return (
    <div className={cn('group rounded-lg border bg-card p-4', !editing ? 'cursor-pointer' : null)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0" {...interactiveProps}>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <form
              className="mt-2 space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (!saving) void handleSave()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  setError(null)
                  return
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!saving) void handleSave()
                }
              }}
            >
              <div className="relative">
                <Mail className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  className="w-full rounded-md border pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={draft}
                  onChange={(event) => {
                    if (error) setError(null)
                    setDraft(event.target.value)
                  }}
                  placeholder={placeholder}
                  type="email"
                  autoFocus
                  spellCheck={false}
                />
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              {!error && duplicate ? (
                <p className="text-xs text-muted-foreground">
                  {t('customers.people.detail.inline.emailDuplicate', undefined, { name: duplicate.displayName })}{' '}
                  <Link
                    className="font-medium text-primary underline underline-offset-2"
                    href={`/backend/customers/people/${duplicate.id}`}
                  >
                    {t('customers.people.detail.inline.emailDuplicateLink')}
                  </Link>
                </p>
              ) : null}
              {!error && !duplicate && checking ? (
                <p className="text-xs text-muted-foreground">{t('customers.people.detail.inline.emailChecking')}</p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? <Spinner className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t('customers.people.detail.inline.saveShortcut', 'Save ⌘⏎ / Ctrl+Enter')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false)
                    setDraft(value ?? '')
                    setError(null)
                  }}
                  disabled={saving}
                >
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-1">{renderDisplay({ value, emptyLabel })}</div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground transition-opacity duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation()
            if (editing) {
              setDraft(value ?? '')
              setError(null)
            }
            setEditing((prev) => !prev)
          }}
          aria-label={editing ? t('ui.detail.inline.cancel', 'Cancel') : t('ui.detail.inline.edit', 'Edit')}
          disabled={saving}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

function ChannelInlineEditor({
  label,
  value,
  emptyLabel,
  options,
  loading,
  onLoadOptions,
  onSave,
  saveLabel,
}: {
  label: string
  value: string | null | undefined
  emptyLabel: string
  options: ChannelOption[]
  loading: boolean
  onLoadOptions: (query?: string) => Promise<ChannelOption[]>
  onSave: (next: string | null) => Promise<void>
  saveLabel: string
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string | null>(value ?? null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const setSearchQueryRef = React.useRef<((value: string) => void) | null>(null)
  const containerClasses = cn(
    'group relative rounded border bg-muted/30 p-3',
    !editing ? 'cursor-pointer' : null
  )
  const triggerClasses = cn(
    'h-8 w-8 shrink-0 text-muted-foreground transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
  )

  React.useEffect(() => {
    if (!editing) {
      setDraft(value ?? null)
      setError(null)
    }
  }, [editing, value])

  React.useEffect(() => {
    if (!editing) setSearchQueryRef.current = null
  }, [editing])

  const current = React.useMemo(
    () => (draft ?? value ? options.find((opt) => opt.id === (draft ?? value)) ?? null : null),
    [draft, options, value]
  )

  const prefillSearch = React.useCallback(() => {
    if (!editing || !setSearchQueryRef.current) return
    const query = current?.label ?? value ?? ''
    setSearchQueryRef.current(query)
  }, [current?.label, editing, value])

  React.useEffect(() => {
    if (editing) prefillSearch()
  }, [editing, prefillSearch])

  const handleActivate = React.useCallback(() => {
    if (!editing) {
      setEditing(true)
      prefillSearch()
      void onLoadOptions()
    }
  }, [editing, onLoadOptions, prefillSearch])

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft ?? null)
      setEditing(false)
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : t('sales.documents.detail.updateError', 'Failed to update document.')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, t])

  return (
    <div
      className={cn('group rounded-lg border bg-card p-4', !editing ? 'cursor-pointer' : null)}
      role={!editing ? 'button' : undefined}
      tabIndex={!editing ? 0 : undefined}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (editing) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleActivate()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <div
              className="mt-2 space-y-2"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  setDraft(value ?? null)
                  setError(null)
                  return
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!saving) void handleSave()
                }
              }}
            >
              <LookupSelect
                value={draft}
                onChange={setDraft}
                fetchItems={async (query) => {
                  const items = await onLoadOptions(query)
                  return items.map<LookupSelectItem>((item) => ({
                    id: item.id,
                    title: item.label,
                    icon: <Store className="h-5 w-5 text-muted-foreground" />,
                  }))
                }}
                onReady={({ setQuery }) => {
                  setSearchQueryRef.current = setQuery
                  prefillSearch()
                }}
                searchPlaceholder={t('sales.documents.form.channel.placeholder', 'Select a channel')}
                loadingLabel={t('sales.documents.form.channel.loading', 'Loading channels…')}
                emptyLabel={t('sales.documents.form.channel.empty', 'No channels found.')}
                selectedHintLabel={(id) => t('sales.documents.form.channel.selected', 'Selected channel: {{id}}', { id })}
              />
              {loading ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5 animate-spin" />
                  {t('sales.documents.form.channel.loading', 'Loading channels…')}
                </p>
              ) : null}
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Spinner className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {saveLabel}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false)
                    setDraft(value ?? null)
                    setError(null)
                  }}
                  disabled={saving}
                >
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-sm text-foreground">
              {current ? (
                <span className="text-sm">{current.label}</span>
              ) : value ? (
                <span className="text-sm">{value}</span>
              ) : (
                <span className="text-sm text-muted-foreground">{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground transition-opacity duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation()
            if (editing) {
              setDraft(value ?? null)
              setError(null)
            }
            setEditing((prev) => {
              const next = !prev
              if (!prev && next) prefillSearch()
              return next
            })
            void onLoadOptions()
          }}
          aria-label={editing ? t('ui.detail.inline.cancel', 'Cancel') : t('ui.detail.inline.edit', 'Edit')}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

type MethodOption = ShippingMethodOption | PaymentMethodOption

function MethodInlineEditor({
  label,
  value,
  snapshot,
  emptyLabel,
  options,
  loading,
  onLoadOptions,
  onSave,
  saveLabel,
  placeholder,
  loadingLabel,
  emptyResultsLabel,
  selectedHint,
  icon,
  allowClear = true,
}: {
  label: string
  value: string | null | undefined
  snapshot: Record<string, unknown> | null
  emptyLabel: string
  options: MethodOption[]
  loading: boolean
  onLoadOptions: (query?: string) => Promise<MethodOption[]>
  onSave: (nextId: string | null) => Promise<void>
  saveLabel: string
  placeholder: string
  loadingLabel: string
  emptyResultsLabel: string
  selectedHint: (id: string) => string
  icon: React.ReactNode
  allowClear?: boolean
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string | null>(value ?? null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const setSearchQueryRef = React.useRef<((value: string) => void) | null>(null)

  const containerClasses = cn(
    'group relative rounded border bg-muted/30 p-3',
    !editing ? 'cursor-pointer' : null
  )

  const triggerClasses = cn(
    'h-8 w-8 shrink-0 text-muted-foreground transition-opacity duration-150',
    editing
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
  )

  React.useEffect(() => {
    if (!editing) {
      setDraft(value ?? null)
      setError(null)
    }
  }, [editing, value])

  React.useEffect(() => {
    if (!editing) setSearchQueryRef.current = null
  }, [editing])

  const resolveDisplay = React.useCallback(
    (id: string | null | undefined): { label: string | null; description: string | null } => {
      if (!id) return { label: null, description: null }
      const option = options.find((entry) => entry.id === id)
      if (option) {
        return {
          label: option.name ?? option.code,
          description: option.description ?? null,
        }
      }
      const snapName =
        snapshot && typeof (snapshot as any)?.name === 'string' ? (snapshot as any).name : null
      const snapCode =
        snapshot && typeof (snapshot as any)?.code === 'string' ? (snapshot as any).code : null
      const snapDescription =
        snapshot && typeof (snapshot as any)?.description === 'string'
          ? (snapshot as any).description
          : null
      return {
        label: snapName ?? snapCode ?? id,
        description: snapDescription,
      }
    },
    [options, snapshot]
  )

  const currentDisplay = React.useMemo(
    () => resolveDisplay(draft ?? value ?? null),
    [draft, resolveDisplay, value]
  )

  const prefillSearch = React.useCallback(() => {
    if (!editing || !setSearchQueryRef.current) return
    setSearchQueryRef.current('')
  }, [editing])

  React.useEffect(() => {
    if (editing) prefillSearch()
  }, [editing, prefillSearch])

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft ?? null)
      setEditing(false)
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('sales.documents.detail.updateError', 'Failed to update document.')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, t])

  return (
    <div
      className={containerClasses}
      role={!editing ? 'button' : undefined}
      tabIndex={!editing ? 0 : undefined}
      onClick={() => {
        if (editing) return
        setEditing(true)
        prefillSearch()
        void onLoadOptions('')
      }}
      onKeyDown={(event) => {
        if (editing) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setEditing(true)
          prefillSearch()
          void onLoadOptions('')
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <div
              className="mt-2 space-y-2"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  setDraft(value ?? null)
                  setError(null)
                  return
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!saving) void handleSave()
                }
              }}
            >
              <LookupSelect
                value={draft}
                onChange={setDraft}
                fetchItems={async (query) => {
                  const items = await onLoadOptions(query)
                  return items.map<LookupSelectItem>((item) => ({
                    id: item.id,
                    title: item.name ?? item.code,
                    subtitle: item.code,
                    icon: icon,
                  }))
                }}
                minQuery={0}
                onReady={({ setQuery }) => {
                  setSearchQueryRef.current = setQuery
                  prefillSearch()
                }}
                searchPlaceholder={placeholder}
                loadingLabel={loadingLabel}
                emptyLabel={emptyResultsLabel}
                selectedHintLabel={(id) => selectedHint(id)}
              />
              {loading ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5 animate-spin" />
                  {loadingLabel}
                </p>
              ) : null}
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Spinner className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {saveLabel}
                </Button>
                {allowClear ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setDraft(null)}
                    disabled={saving}
                  >
                    {t('ui.actions.clear', 'Clear')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false)
                    setDraft(value ?? null)
                    setError(null)
                  }}
                  disabled={saving}
                >
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-sm">
              {currentDisplay.label ? (
                <div className="space-y-1">
                  <span className="text-sm">{currentDisplay.label}</span>
                  {currentDisplay.description ? (
                    <p className="text-xs text-muted-foreground">{currentDisplay.description}</p>
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">{emptyLabel}</span>
              )}
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={triggerClasses}
          onClick={(event) => {
            event.stopPropagation()
            if (editing) {
              setDraft(value ?? null)
              setError(null)
            }
            setEditing((prev) => {
              const next = !prev
              if (!prev && next) prefillSearch()
              return next
            })
            void onLoadOptions('')
          }}
          aria-label={editing ? t('ui.detail.inline.cancel', 'Cancel') : t('ui.detail.inline.edit', 'Edit')}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

function StatusInlineEditor({
  label,
  value,
  emptyLabel,
  options,
  onSave,
  onLoadOptions,
  labels,
  manageHref,
  loading,
  saveLabel,
  dictionaryMap,
}: {
  label: string
  value: string | null | undefined
  emptyLabel: string
  options: StatusOption[]
  onSave: (entryId: string | null, value: string | null) => Promise<void>
  onLoadOptions: () => Promise<StatusOption[]>
  labels: DictionarySelectLabels
  manageHref?: string
  loading: boolean
  saveLabel: string
  dictionaryMap: DictionaryMap
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string | undefined>(value ?? undefined)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fetchStatusOptions = React.useCallback(
    async () =>
      (await onLoadOptions()).map((option) => ({
        value: option.value,
        label: option.label,
        color: option.color,
        icon: option.icon,
      })),
    [onLoadOptions]
  )

  React.useEffect(() => {
    if (!editing) {
      setDraft(value ?? undefined)
      setError(null)
    }
  }, [editing, value])

  const handleSave = React.useCallback(async () => {
    const selected = draft ? options.find((opt) => opt.value === draft) ?? null : null
    if (draft && !selected) {
      setError(t('sales.documents.detail.statusInvalid', 'Selected status could not be found.'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(selected?.id ?? null, draft ?? null)
      setEditing(false)
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : t('sales.documents.detail.updateError', 'Failed to update document.')
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [draft, onSave, options, t])

  return (
    <div
      className={cn('group rounded-lg border bg-card p-4', !editing ? 'cursor-pointer' : null)}
      role={!editing ? 'button' : undefined}
      tabIndex={!editing ? 0 : undefined}
      onClick={() => {
        if (!editing) {
          setEditing(true)
          void onLoadOptions()
        }
      }}
      onKeyDown={(event) => {
        if (editing) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setEditing(true)
          void onLoadOptions()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          {editing ? (
            <div
              className="mt-2 space-y-2"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(false)
                  setDraft(value ?? undefined)
                  setError(null)
                  return
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!saving) void handleSave()
                }
              }}
            >
              <DictionaryEntrySelect
                value={draft}
                onChange={(next) => setDraft(next ?? undefined)}
                fetchOptions={fetchStatusOptions}
                allowInlineCreate={false}
                allowAppearance
                manageHref={manageHref}
                labels={labels}
              />
              {loading ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5 animate-spin" />
                  {labels.loadingLabel}
                </p>
              ) : null}
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Spinner className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {saveLabel}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false)
                    setDraft(value ?? undefined)
                    setError(null)
                  }}
                  disabled={saving}
                >
                  {t('ui.detail.inline.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-sm">
              <DictionaryValue
                value={value}
                map={dictionaryMap}
                fallback={<span className="text-sm text-muted-foreground">{emptyLabel}</span>}
                className="text-sm"
                iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
                iconClassName="h-4 w-4"
                colorClassName="h-3 w-3 rounded-full"
              />
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground transition-opacity duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            event.stopPropagation()
            if (editing) {
              setDraft(normalizedValue)
              setError(null)
            }
            setEditing((prev) => !prev)
            void onLoadOptions()
          }}
          aria-label={editing ? t('ui.detail.inline.cancel', 'Cancel') : t('ui.detail.inline.edit', 'Edit')}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

export default function SalesDocumentDetailPage({
  params,
  initialKind,
}: {
  params: { id: string }
  initialKind?: 'order' | 'quote'
}) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [loading, setLoading] = React.useState(true)
  const [record, setRecord] = React.useState<DocumentRecord | null>(null)
  const [tags, setTags] = React.useState<TagOption[]>([])
  const [kind, setKind] = React.useState<'order' | 'quote'>('quote')
  const [error, setError] = React.useState<string | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)
  const [activeTab, setActiveTab] = React.useState<string>('comments')
  const [sectionAction, setSectionAction] = React.useState<SectionAction | null>(null)
  const detailSectionRef = React.useRef<HTMLDivElement | null>(null)
  const [generating, setGenerating] = React.useState(false)
  const [converting, setConverting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [sendOpen, setSendOpen] = React.useState(false)
  const [validForDays, setValidForDays] = React.useState(14)
  const [numberEditing, setNumberEditing] = React.useState(false)
  const [canEditNumber, setCanEditNumber] = React.useState(false)
  const [currencyError, setCurrencyError] = React.useState<string | null>(null)
  const [hasItems, setHasItems] = React.useState(false)
  const [hasPayments, setHasPayments] = React.useState(false)
  const [customerOptions, setCustomerOptions] = React.useState<CustomerOption[]>([])
  const [customerLoading, setCustomerLoading] = React.useState(false)
  const [customerSaving, setCustomerSaving] = React.useState(false)
  const [customerError, setCustomerError] = React.useState<string | null>(null)
  const [editingGuards, setEditingGuards] = React.useState<{
    customer: string[] | null
    addresses: string[] | null
  } | null>(null)
  const [channelOptions, setChannelOptions] = React.useState<ChannelOption[]>([])
  const [channelLoading, setChannelLoading] = React.useState(false)
  const channelOptionsRef = React.useRef<Map<string, ChannelOption>>(new Map())
  const [shippingMethodOptions, setShippingMethodOptions] = React.useState<ShippingMethodOption[]>([])
  const [shippingMethodLoading, setShippingMethodLoading] = React.useState(false)
  const shippingMethodOptionsRef = React.useRef<Map<string, ShippingMethodOption>>(new Map())
  const [paymentMethodOptions, setPaymentMethodOptions] = React.useState<PaymentMethodOption[]>([])
  const [paymentMethodLoading, setPaymentMethodLoading] = React.useState(false)
  const paymentMethodOptionsRef = React.useRef<Map<string, PaymentMethodOption>>(new Map())
  const [statusOptions, setStatusOptions] = React.useState<StatusOption[]>([])
  const [statusLoading, setStatusLoading] = React.useState(false)
  const statusOptionsRef = React.useRef<Map<string, StatusOption>>(new Map())
  const [adjustmentRows, setAdjustmentRows] = React.useState<AdjustmentRowData[]>([])
  const mutationContextId = React.useMemo(
    () => (record?.id ? `sales-document:${kind}:${record.id}` : `sales-document:${kind}:pending`),
    [kind, record?.id],
  )
  const detailsInjectionSpotId = React.useMemo(() => `sales.document.detail.${kind}:details`, [kind])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    kind: SalesDocumentKind
    record: DocumentRecord | null
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const detailInjectionContext = React.useMemo(
    () => ({
      kind,
      record,
      formId: mutationContextId,
      resourceKind: `sales.${kind}`,
      resourceId: record?.id ?? undefined,
      retryLastMutation,
    }),
    [kind, mutationContextId, record, retryLastMutation],
  )
  const runMutationWithContext = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: detailInjectionContext,
      })
    },
    [detailInjectionContext, runMutation],
  )
  const clearCustomerError = React.useCallback(() => setCustomerError(null), [])
  const { data: currencyDictionary } = useCurrencyDictionary()
  const scopeVersion = useOrganizationScopeVersion()
  const parseNumber = React.useCallback((value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length) {
      const parsed = Number(value)
      if (!Number.isNaN(parsed)) return parsed
    }
    return NaN
  }, [])

  const loadErrorMessage = React.useMemo(
    () => t('sales.documents.detail.error', 'Document not found or inaccessible.'),
    [t]
  )

  React.useEffect(() => {
    let active = true
    async function loadNumberPermission() {
      try {
        const call = await apiCall<{ granted?: unknown[] }>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ features: ['sales.documents.number.edit'] }),
          }
        )
        if (!active) return
        const granted = Array.isArray(call.result?.granted)
          ? call.result?.granted.map((item) => String(item))
          : []
        const has = granted.some((feature) => {
          if (feature === '*') return true
          if (feature === 'sales.documents.number.edit') return true
          if (feature.endsWith('.*')) {
            const prefix = feature.slice(0, -2)
            return 'sales.documents.number.edit' === prefix || 'sales.documents.number.edit'.startsWith(`${prefix}.`)
          }
          return false
        })
        setCanEditNumber(Boolean(call.ok && has))
      } catch {
        if (active) setCanEditNumber(false)
      }
    }
    loadNumberPermission().catch(() => {})
    return () => {
      active = false
    }
  }, [scopeVersion])
  const saveShortcutLabel = React.useMemo(
    () => t('sales.documents.detail.inline.save', 'Save ⌘⏎ / Ctrl+Enter'),
    [t]
  )
  const customDataLabels = React.useMemo(
    () => ({
      loading: t('sales.documents.detail.customDataLoading', 'Loading custom data…'),
      emptyValue: t('sales.documents.detail.empty', 'Not set'),
      noFields: t('entities.customFields.empty'),
      defineFields: t('sales.documents.detail.customDataDefine', 'Define custom fields first.'),
      saveShortcut: saveShortcutLabel,
      edit: t('ui.forms.actions.edit'),
      cancel: t('ui.forms.actions.cancel'),
    }),
    [saveShortcutLabel, t],
  )
  const tagLabels = React.useMemo(
    () => ({
      loading: t('sales.documents.detail.tags.loading', 'Loading tags…'),
      placeholder: t('sales.documents.detail.tags.placeholder', 'Type to add tags'),
      empty: t('sales.documents.detail.tags.placeholder', 'No tags yet. Add labels to keep documents organized.'),
      loadError: t('sales.documents.detail.tags.loadError', 'Failed to load tags.'),
      createError: t('sales.documents.detail.tags.createError', 'Failed to create tag.'),
      updateError: t('sales.documents.detail.tags.updateError', 'Failed to update tags.'),
      labelRequired: t('sales.documents.detail.tags.labelRequired', 'Tag name is required.'),
      saveShortcut: t('sales.documents.detail.tags.saveShortcut', 'Save ⌘⏎ / Ctrl+Enter'),
      cancelShortcut: t('sales.documents.detail.tags.cancelShortcut', 'Cancel (Esc)'),
      edit: t('ui.forms.actions.edit'),
      cancel: t('ui.forms.actions.cancel'),
    }),
    [t],
  )

  const upsertChannelOptions = React.useCallback((options: ChannelOption[]) => {
    setChannelOptions((prev) => {
      const map = new Map(prev.map((opt) => [opt.id, opt]))
      options.forEach((opt) => map.set(opt.id, opt))
      channelOptionsRef.current = map
      return Array.from(map.values())
    })
  }, [])

  const upsertShippingMethodOptions = React.useCallback((options: ShippingMethodOption[]) => {
    setShippingMethodOptions((prev) => {
      const map = new Map(prev.map((opt) => [opt.id, opt]))
      options.forEach((opt) => map.set(opt.id, opt))
      shippingMethodOptionsRef.current = map
      return Array.from(map.values())
    })
  }, [])

  const upsertPaymentMethodOptions = React.useCallback((options: PaymentMethodOption[]) => {
    setPaymentMethodOptions((prev) => {
      const map = new Map(prev.map((opt) => [opt.id, opt]))
      options.forEach((opt) => map.set(opt.id, opt))
      paymentMethodOptionsRef.current = map
      return Array.from(map.values())
    })
  }, [])

  const upsertStatusOptions = React.useCallback((options: StatusOption[]) => {
    setStatusOptions((prev) => {
      const map = new Map(prev.map((opt) => [opt.value, opt]))
      options.forEach((opt) => map.set(opt.value, opt))
      statusOptionsRef.current = map
      return Array.from(map.values())
    })
  }, [])

  const loadCustomers = React.useCallback(
    async (query?: string) => {
      setCustomerLoading(true)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '20' })
        if (query && query.trim().length) params.set('search', query.trim())
        const [people, companies] = await Promise.all([
          apiCall<{ items?: unknown[] }>(`/api/customers/people?${params.toString()}`),
          apiCall<{ items?: unknown[] }>(`/api/customers/companies?${params.toString()}`),
        ])
        const peopleItems = Array.isArray(people.result?.items) ? people.result?.items ?? [] : []
        const companyItems = Array.isArray(companies.result?.items) ? companies.result?.items ?? [] : []
        const merged = [...parseCustomerOptions(peopleItems, 'person'), ...parseCustomerOptions(companyItems, 'company')]
        setCustomerOptions((prev) => {
          const combined = [...prev]
          merged.forEach((entry) => {
            if (!combined.some((item) => item.id === entry.id)) {
              combined.push(entry)
            }
          })
          return combined
        })
        return merged
      } catch (err) {
        console.error('sales.documents.loadCustomers', err)
        flash(t('sales.documents.form.errors.customers', 'Failed to load customers.'), 'error')
        return []
      } finally {
        setCustomerLoading(false)
      }
    },
    [t]
  )

  const loadChannels = React.useCallback(
    async (query?: string) => {
      setChannelLoading(true)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '20' })
        if (query && query.trim().length) params.set('search', query.trim())
        const call = await apiCall<{ items?: Array<{ id?: string; name?: string; code?: string | null }> }>(
          `/api/sales/channels?${params.toString()}`
        )
        if (call.ok && Array.isArray(call.result?.items)) {
          const options = call.result.items
            .map((item) => {
              const id = typeof item?.id === 'string' ? item.id : null
              if (!id) return null
              const label = typeof item?.name === 'string' && item.name.trim().length ? item.name : id
              const code = typeof item?.code === 'string' && item.code.trim().length ? item.code : null
              return { id, label: code ? `${label} (${code})` : label }
            })
            .filter((opt): opt is ChannelOption => !!opt)
          if (!query) upsertChannelOptions(options)
          return options
        }
        if (!query) upsertChannelOptions([])
        return []
      } catch (err) {
        console.error('sales.documents.loadChannels', err)
        if (!query) {
          flash(t('sales.channels.offers.filters.channelsLoadError', 'Failed to load channels'), 'error')
        }
        return []
      } finally {
        setChannelLoading(false)
      }
    },
    [t, upsertChannelOptions]
  )

  const loadShippingMethods = React.useCallback(
    async (query?: string) => {
      setShippingMethodLoading(true)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' })
        if (query && query.trim().length) params.set('search', query.trim())
        const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/sales/shipping-methods?${params.toString()}`
        )
        if (call.ok && Array.isArray(call.result?.items)) {
          const options = call.result.items
            .map((item) => {
              const id = typeof item?.id === 'string' ? item.id : null
              const name = typeof item?.name === 'string' ? item.name : null
              const code = typeof item?.code === 'string' ? item.code : null
              if (!id || !name || !code) return null
              const metadata =
                item && typeof item?.metadata === 'object' && item.metadata ? (item.metadata as Record<string, unknown>) : null
              const providerSettings =
                item && typeof (item as any)?.providerSettings === 'object' && (item as any).providerSettings
                  ? ((item as any).providerSettings as Record<string, unknown>)
                  : metadata && typeof metadata.providerSettings === 'object'
                    ? (metadata.providerSettings as Record<string, unknown>)
                    : null
              return {
                id,
                name,
                code,
                description: typeof item?.description === 'string' ? item.description : null,
                carrierCode: typeof (item as any)?.carrierCode === 'string' ? (item as any).carrierCode : null,
                serviceLevel: typeof (item as any)?.serviceLevel === 'string' ? (item as any).serviceLevel : null,
                estimatedTransitDays:
                  typeof (item as any)?.estimatedTransitDays === 'number'
                    ? (item as any).estimatedTransitDays
                    : null,
                currencyCode: typeof item?.currencyCode === 'string' ? item.currencyCode : null,
                baseRateNet:
                  typeof (item as any)?.baseRateNet === 'string'
                    ? (item as any).baseRateNet
                    : typeof (item as any)?.baseRateNet === 'number'
                      ? (item as any).baseRateNet.toString()
                      : null,
                baseRateGross:
                  typeof (item as any)?.baseRateGross === 'string'
                    ? (item as any).baseRateGross
                    : typeof (item as any)?.baseRateGross === 'number'
                      ? (item as any).baseRateGross.toString()
                      : null,
                providerKey: typeof (item as any)?.providerKey === 'string' ? (item as any).providerKey : null,
                providerSettings,
                metadata,
              }
            })
            .filter((entry): entry is ShippingMethodOption => !!entry)
          if (!query) upsertShippingMethodOptions(options)
          return options
        }
        if (!query) upsertShippingMethodOptions([])
        return []
      } catch (err) {
        console.error('sales.documents.loadShippingMethods', err)
        if (!query) {
          flash(
            t('sales.documents.detail.shippingMethodLoadError', 'Failed to load shipping methods.'),
            'error'
          )
        }
        return []
      } finally {
        setShippingMethodLoading(false)
      }
    },
    [t, upsertShippingMethodOptions]
  )

  const loadPaymentMethods = React.useCallback(
    async (query?: string) => {
      setPaymentMethodLoading(true)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100' })
        if (query && query.trim().length) params.set('search', query.trim())
        const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/sales/payment-methods?${params.toString()}`
        )
        if (call.ok && Array.isArray(call.result?.items)) {
          const options = call.result.items
            .map((item) => {
              const id = typeof item?.id === 'string' ? item.id : null
              const name = typeof item?.name === 'string' ? item.name : null
              const code = typeof item?.code === 'string' ? item.code : null
              if (!id || !name || !code) return null
              const metadata =
                item && typeof item?.metadata === 'object' && item.metadata ? (item.metadata as Record<string, unknown>) : null
              const providerSettings =
                item && typeof (item as any)?.providerSettings === 'object' && (item as any).providerSettings
                  ? ((item as any).providerSettings as Record<string, unknown>)
                  : metadata && typeof metadata.providerSettings === 'object'
                    ? (metadata.providerSettings as Record<string, unknown>)
                    : null
              return {
                id,
                name,
                code,
                description: typeof item?.description === 'string' ? item.description : null,
                providerKey: typeof (item as any)?.providerKey === 'string' ? (item as any).providerKey : null,
                terms: typeof (item as any)?.terms === 'string' ? (item as any).terms : null,
                providerSettings,
                metadata,
              }
            })
            .filter((entry): entry is PaymentMethodOption => !!entry)
          if (!query) upsertPaymentMethodOptions(options)
          return options
        }
        if (!query) upsertPaymentMethodOptions([])
        return []
      } catch (err) {
        console.error('sales.documents.loadPaymentMethods', err)
        if (!query) {
          flash(
            t('sales.documents.detail.paymentMethodLoadError', 'Failed to load payment methods.'),
            'error'
          )
        }
        return []
      } finally {
        setPaymentMethodLoading(false)
      }
    },
    [t, upsertPaymentMethodOptions]
  )

  const refreshPaymentPresence = React.useCallback(async () => {
    if (!record?.id || kind !== 'order') {
      setHasPayments(false)
      return
    }
    const params = new URLSearchParams({ page: '1', pageSize: '1', orderId: record.id })
    try {
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/payments?${params.toString()}`,
        undefined,
        { fallback: { items: [] } }
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      setHasPayments(items.some((item) => item && typeof (item as any).id === 'string'))
    } catch (err) {
      console.error('sales.documents.currency.paymentsGuard', err)
    }
  }, [kind, record?.id])

  const fetchCustomerEmail = React.useCallback(
    async (id: string, kindHint?: 'person' | 'company'): Promise<string | null> => {
      try {
        const kind = kindHint ?? customerOptions.find((item) => item.id === id)?.kind ?? null
        const endpoint = kind === 'company' ? '/api/customers/companies' : '/api/customers/people'
        const params = new URLSearchParams({ id, pageSize: '1', page: '1' })
        const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(`${endpoint}?${params.toString()}`)
        if (!call.ok || !Array.isArray(call.result?.items) || !call.result.items.length) return null
        const item = call.result.items[0]
        const email =
          (typeof item?.primary_email === 'string' && item.primary_email) ||
          (typeof (item as any)?.primaryEmail === 'string' && (item as any).primaryEmail) ||
          null
        if (email) {
          setCustomerOptions((prev) =>
            prev.map((entry) => (entry.id === id ? { ...entry, primaryEmail: email } : entry))
          )
        }
        return email ?? null
      } catch (err) {
        console.error('sales.documents.fetchCustomerEmail', err)
        return null
      }
    },
    [customerOptions],
  )

  const ensureChannelOption = React.useCallback(
    async (id: string | null | undefined) => {
      if (!id) return null
      const existing = channelOptionsRef.current.get(id)
      if (existing) return existing
      try {
        const params = new URLSearchParams({ id, page: '1', pageSize: '1' })
        const call = await apiCall<{ items?: Array<{ id?: string; name?: string; code?: string | null }> }>(
          `/api/sales/channels?${params.toString()}`
        )
        if (call.ok && Array.isArray(call.result?.items) && call.result.items.length) {
          const item = call.result.items[0]
          const label = typeof item?.name === 'string' && item.name.trim().length ? item.name : id
          const code = typeof item?.code === 'string' && item.code.trim().length ? item.code : null
          const option: ChannelOption = { id, label: code ? `${label} (${code})` : label }
          upsertChannelOptions([option])
          return option
        }
      } catch (err) {
        console.error('sales.documents.channel.ensure', err)
      }
      return null
    },
    [upsertChannelOptions]
  )

  const ensureShippingMethodOption = React.useCallback(
    (id: string | null | undefined, snapshot?: Record<string, unknown> | null) => {
      if (!id) return null
      const existing = shippingMethodOptionsRef.current.get(id)
      if (existing) return existing
      const name =
        (snapshot && typeof (snapshot as any)?.name === 'string' && (snapshot as any).name) || null
      const code =
        (snapshot && typeof (snapshot as any)?.code === 'string' && (snapshot as any).code) || null
      if (!name && !code) return null
      const option: ShippingMethodOption = {
        id,
        name: name ?? code ?? id,
        code: code ?? id,
        description:
          snapshot && typeof (snapshot as any)?.description === 'string'
            ? (snapshot as any).description
            : null,
        carrierCode:
          snapshot && typeof (snapshot as any)?.carrierCode === 'string'
            ? (snapshot as any).carrierCode
            : null,
        serviceLevel:
          snapshot && typeof (snapshot as any)?.serviceLevel === 'string'
            ? (snapshot as any).serviceLevel
            : null,
        estimatedTransitDays:
          snapshot && typeof (snapshot as any)?.estimatedTransitDays === 'number'
            ? (snapshot as any).estimatedTransitDays
            : null,
        currencyCode:
          snapshot && typeof (snapshot as any)?.currencyCode === 'string'
            ? (snapshot as any).currencyCode
            : null,
      }
      upsertShippingMethodOptions([option])
      return option
    },
    [upsertShippingMethodOptions]
  )

  const ensurePaymentMethodOption = React.useCallback(
    (id: string | null | undefined, snapshot?: Record<string, unknown> | null) => {
      if (!id) return null
      const existing = paymentMethodOptionsRef.current.get(id)
      if (existing) return existing
      const name =
        (snapshot && typeof (snapshot as any)?.name === 'string' && (snapshot as any).name) || null
      const code =
        (snapshot && typeof (snapshot as any)?.code === 'string' && (snapshot as any).code) || null
      if (!name && !code) return null
      const option: PaymentMethodOption = {
        id,
        name: name ?? code ?? id,
        code: code ?? id,
        description:
          snapshot && typeof (snapshot as any)?.description === 'string'
            ? (snapshot as any).description
            : null,
        providerKey:
          snapshot && typeof (snapshot as any)?.providerKey === 'string'
            ? (snapshot as any).providerKey
            : null,
        terms:
          snapshot && typeof (snapshot as any)?.terms === 'string' ? (snapshot as any).terms : null,
      }
      upsertPaymentMethodOptions([option])
      return option
    },
    [upsertPaymentMethodOptions]
  )

  const loadStatuses = React.useCallback(async () => {
    setStatusLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const call = await apiCall<{ items?: Array<{ id?: string; value?: string; label?: string | null; color?: string | null; icon?: string | null }> }>(
        `/api/sales/order-statuses?${params.toString()}`
      )
      if (call.ok && Array.isArray(call.result?.items)) {
        const options = call.result.items
          .map((item) => {
            const id = typeof item?.id === 'string' ? item.id : null
            const value = typeof item?.value === 'string' ? item.value : null
            if (!id || !value) return null
            const label = typeof item?.label === 'string' && item.label.trim().length ? item.label : value
            const color = typeof item?.color === 'string' && item.color.trim().length ? item.color : null
            const icon = typeof item?.icon === 'string' && item.icon.trim().length ? item.icon : null
            return { id, value, label, color, icon }
          })
          .filter((opt): opt is StatusOption => !!opt)
        upsertStatusOptions(options)
        return options
      }
      upsertStatusOptions([])
      return []
    } catch (err) {
      console.error('sales.documents.loadStatuses', err)
      flash(t('sales.documents.detail.status.errorLoad', 'Failed to load statuses.'), 'error')
      return []
    } finally {
      setStatusLoading(false)
    }
  }, [t, upsertStatusOptions])

  const ensureStatusOption = React.useCallback(
    (value: string | null | undefined, entryId: string | null | undefined) => {
      if (!value) return
      if (statusOptionsRef.current.has(value)) return
      upsertStatusOptions([
        {
          id: entryId ?? value,
          value,
          label: value,
          color: null,
          icon: null,
        },
      ])
    },
    [upsertStatusOptions]
  )

  const fetchDocumentByKind = React.useCallback(
    async (documentId: string, candidateKind: 'order' | 'quote') => {
      return fetchDocument(documentId, candidateKind, loadErrorMessage)
    },
    [loadErrorMessage]
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const requestedKind = searchParams.get('kind')
      const preferredKind = requestedKind === 'order' ? 'order' : requestedKind === 'quote' ? 'quote' : initialKind ?? null
      const kindsToTry: Array<'order' | 'quote'> = preferredKind
        ? [preferredKind, preferredKind === 'order' ? 'quote' : 'order']
        : ['quote', 'order']
      let lastError: string | null = null
      for (const candidate of kindsToTry) {
        try {
          const entry = await fetchDocumentByKind(params.id, candidate)
          if (entry && !cancelled) {
            setRecord(entry)
            setKind(candidate)
            setLoading(false)
            return
          }
        } catch (err) {
          const message = err instanceof Error && err.message ? err.message : loadErrorMessage
          lastError = message
        }
      }
      if (!cancelled) {
        setLoading(false)
        setError(lastError ?? loadErrorMessage)
      }
    }
    load().catch((err) => {
      if (cancelled) return
      const message = err instanceof Error && err.message ? err.message : loadErrorMessage
      setError(message)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [fetchDocumentByKind, initialKind, loadErrorMessage, params.id, reloadKey, searchParams])

  React.useEffect(() => {
    loadCustomers().catch(() => {})
  }, [loadCustomers])

  React.useEffect(() => {
    setTags(Array.isArray(record?.tags) ? record.tags : [])
  }, [record?.tags])

  React.useEffect(() => {
    if (!record) {
      setHasItems(false)
      return
    }
    const lineItemCount = resolveLineItemCount(record)
    if (lineItemCount !== null) {
      setHasItems(lineItemCount > 0)
    }
  }, [record])

  React.useEffect(() => {
    loadChannels().catch(() => {})
    loadStatuses().catch(() => {})
    loadShippingMethods().catch(() => {})
    loadPaymentMethods().catch(() => {})
  }, [loadChannels, loadPaymentMethods, loadShippingMethods, loadStatuses, scopeVersion])

  React.useEffect(() => {
    void refreshPaymentPresence()
  }, [refreshPaymentPresence])

  const normalizeGuardList = React.useCallback((value: unknown): string[] | null => {
    if (value === null) return null
    if (!Array.isArray(value)) return []
    const set = new Set<string>()
    value.forEach((entry) => {
      if (typeof entry === 'string' && entry.trim().length) set.add(entry.trim())
    })
    return Array.from(set)
  }, [])

  React.useEffect(() => {
    if (kind !== 'order') {
      setEditingGuards(null)
      return
    }
    let cancelled = false
    async function loadGuards() {
      try {
        const call = await apiCall<{
          orderCustomerEditableStatuses?: unknown
          orderAddressEditableStatuses?: unknown
        }>('/api/sales/settings/order-editing')
        if (!call.ok || cancelled) return
        setEditingGuards({
          customer: normalizeGuardList(call.result?.orderCustomerEditableStatuses ?? null),
          addresses: normalizeGuardList(call.result?.orderAddressEditableStatuses ?? null),
        })
      } catch (err) {
        console.error('sales.documents.loadGuards', err)
      }
    }
    void loadGuards()
    return () => {
      cancelled = true
    }
  }, [kind, normalizeGuardList, scopeVersion])

  React.useEffect(() => {
    if (!record?.channelId) return
    void ensureChannelOption(record.channelId)
  }, [ensureChannelOption, record?.channelId])

  React.useEffect(() => {
    if (kind !== 'order') return
    ensureShippingMethodOption(record?.shippingMethodId ?? null, record?.shippingMethodSnapshot ?? null)
    ensurePaymentMethodOption(record?.paymentMethodId ?? null, record?.paymentMethodSnapshot ?? null)
  }, [
    ensurePaymentMethodOption,
    ensureShippingMethodOption,
    kind,
    record?.paymentMethodId,
    record?.paymentMethodSnapshot,
    record?.shippingMethodId,
    record?.shippingMethodSnapshot,
  ])

  React.useEffect(() => {
    ensureStatusOption(record?.status ?? null, record?.statusEntryId ?? null)
  }, [ensureStatusOption, record?.status, record?.statusEntryId])

  const handleRetry = React.useCallback(() => {
    setReloadKey((prev) => prev + 1)
  }, [])

  const loadAdjustmentsForTotals = React.useCallback(async () => {
    if (!record?.id) return
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100', [kind === 'order' ? 'orderId' : 'quoteId']: record.id })
      const resourcePath = kind === 'order' ? '/api/sales/order-adjustments' : '/api/sales/quote-adjustments'
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `${resourcePath}?${params.toString()}`,
        undefined,
        { fallback: { items: [] } }
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const mapped: AdjustmentRowData[] = items
        .map((item) => {
          const id = typeof item.id === 'string' ? item.id : null
          if (!id) return null
          const amountNet = parseNumber(
            (item as any).amount_net ?? (item as any).amountNet ?? (item as any).amount_net_amount
          )
          const amountGross = parseNumber(
            (item as any).amount_gross ?? (item as any).amountGross ?? (item as any).amount_gross_amount
          )
          const rateRaw = parseNumber((item as any).rate)
          const kindValue =
            typeof item.kind === 'string' && item.kind.trim().length
              ? (item.kind.trim() as SalesAdjustmentKind)
              : 'custom'
          const currency =
            typeof (item as any).currency_code === 'string'
              ? (item as any).currency_code
              : typeof (item as any).currencyCode === 'string'
                ? (item as any).currencyCode
                : record?.currencyCode ?? null
          return {
            id,
            label: typeof item.label === 'string' ? item.label : null,
            code: typeof item.code === 'string' ? item.code : null,
            kind: kindValue,
            calculatorKey:
              typeof (item as any).calculator_key === 'string'
                ? (item as any).calculator_key
                : typeof (item as any).calculatorKey === 'string'
                  ? (item as any).calculatorKey
                  : null,
            rate: Number.isFinite(rateRaw) ? rateRaw : null,
            amountNet: Number.isFinite(amountNet) ? amountNet : null,
            amountGross: Number.isFinite(amountGross) ? amountGross : null,
            currencyCode: currency,
            position:
              typeof item.position === 'number'
                ? item.position
                : typeof (item as any).position === 'string'
                  ? Number((item as any).position)
                  : 0,
            customFields: null,
            customFieldSetId:
              typeof (item as any).custom_field_set_id === 'string'
                ? (item as any).custom_field_set_id
                : typeof (item as any).customFieldSetId === 'string'
                  ? (item as any).customFieldSetId
                  : null,
          }
        })
        .filter((entry): entry is AdjustmentRowData => Boolean(entry))
      const ordered = [...mapped].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      setAdjustmentRows(ordered)
    } catch (err) {
      console.error('sales.documents.adjustments.totals.load', err)
    }
  }, [kind, parseNumber, record?.currencyCode, record?.id])

  React.useEffect(() => {
    void loadAdjustmentsForTotals()
  }, [loadAdjustmentsForTotals])

  const refreshDocumentTotals = React.useCallback(async () => {
    if (!record?.id) return
    try {
      const updated = await fetchDocumentByKind(record.id, kind)
      if (updated) {
        setRecord(updated)
      }
      await loadAdjustmentsForTotals()
    } catch (err) {
      console.error('sales.documents.totals.refresh', err)
    }
  }, [fetchDocumentByKind, kind, loadAdjustmentsForTotals, record?.id])

  React.useEffect(
    () =>
      subscribeSalesDocumentTotalsRefresh((detail) => {
        if (!record?.id) return
        if (detail.documentId !== record.id) return
        if (detail.kind && detail.kind !== kind) return
        void refreshDocumentTotals()
      }),
    [kind, record?.id, refreshDocumentTotals],
  )

  // Subscribe to document data refresh events (e.g., from workflow status updates)
  React.useEffect(
    () =>
      subscribeSalesDocumentDataRefresh((detail) => {
        if (!record?.id) return
        if (detail.documentId !== record.id) return
        if (detail.kind && detail.kind !== kind) return
        // Increment reloadKey to trigger a full document reload
        setReloadKey((prev) => prev + 1)
      }),
    [kind, record?.id],
  )

  const statusDictionaryMap = React.useMemo(
    () =>
      createDictionaryMap(
        statusOptions.map((option) => ({
          value: option.value,
          label: option.label,
          color: option.color,
          icon: option.icon,
        }))
      ),
    [statusOptions]
  )
  const statusOptionsForEditor = React.useMemo(() => {
    if (kind === 'order') {
      return statusOptions.filter((option) => option.value !== 'sent')
    }
    return statusOptions
  }, [kind, statusOptions])
  const number = record?.orderNumber ?? record?.quoteNumber ?? record?.id
  const numberEditorKey = `${record?.id ?? 'unknown'}:${number ?? ''}`
  const customerSnapshot = (record?.customerSnapshot ?? null) as CustomerSnapshot | null
  const billingSnapshot = (record?.billingAddressSnapshot ?? null) as AddressSnapshot | null
  const shippingSnapshot = (record?.shippingAddressSnapshot ?? null) as AddressSnapshot | null
  const customerName = resolveCustomerName(customerSnapshot, record?.customerName ?? record?.customerEntityId ?? null)
  const metadataEmail =
    record?.metadata && typeof (record.metadata as Record<string, unknown>).customerEmail === 'string'
      ? (record.metadata as Record<string, unknown>).customerEmail
      : null
  const contactEmail = resolveCustomerEmail(customerSnapshot) ?? metadataEmail ?? record?.contactEmail ?? null
  const statusDisplay = record?.status ? statusDictionaryMap[record.status] ?? null : null
  const contactRecordId = customerSnapshot?.contact?.id ?? customerSnapshot?.customer?.id ?? record?.customerEntityId ?? null
  const resolveAdjustmentLabel = React.useCallback(
    (row: AdjustmentRowData) => {
      const base = (row.label ?? '').trim()
      const fallback = t(`sales.documents.adjustments.kindLabels.${row.kind}`, row.kind)
      const label = base.length ? base : fallback
      const hasRate = Number.isFinite(row.rate) && row.rate !== null
      const suffix = hasRate ? ` (${row.rate}%)` : ''
      return `${label}${suffix}`
    },
    [t]
  )
  const totalsItems = React.useMemo(() => {
    if (!record) return []
    const items: { key: string; label: string; amount: number | null | undefined; emphasize?: boolean }[] = [
      {
        key: 'subtotalNetAmount',
        label: t('sales.documents.detail.totals.subtotalNet', 'Subtotal (net)'),
        amount: record.subtotalNetAmount ?? null,
      },
      {
        key: 'subtotalGrossAmount',
        label: t('sales.documents.detail.totals.subtotalGross', 'Subtotal (gross)'),
        amount: record.subtotalGrossAmount ?? null,
      },
      {
        key: 'discountTotalAmount',
        label: t('sales.documents.detail.totals.discountTotal', 'Discounts'),
        amount: record.discountTotalAmount ?? null,
      },
      {
        key: 'taxTotalAmount',
        label: t('sales.documents.detail.totals.taxTotal', 'Tax total'),
        amount: record.taxTotalAmount ?? null,
      },
    ]
    if (kind === 'order') {
      items.push(
        {
          key: 'shippingNetAmount',
          label: t('sales.documents.detail.totals.shippingNet', 'Shipping (net)'),
          amount: record.shippingNetAmount ?? null,
        },
        {
          key: 'shippingGrossAmount',
          label: t('sales.documents.detail.totals.shippingGross', 'Shipping (gross)'),
          amount: record.shippingGrossAmount ?? null,
        },
        {
          key: 'surchargeTotalAmount',
          label: t('sales.documents.detail.totals.surchargeTotal', 'Surcharges'),
          amount: record.surchargeTotalAmount ?? null,
        }
      )
    }
    if (adjustmentRows.length) {
      adjustmentRows.forEach((adj) => {
        items.push({
          key: `adjustment-${adj.id}`,
          label: resolveAdjustmentLabel(adj),
          amount: adj.amountGross ?? adj.amountNet ?? null,
        })
      })
    }
    items.push(
      {
        key: 'grandTotalNetAmount',
        label: t('sales.documents.detail.totals.grandTotalNet', 'Grand total (net)'),
        amount: record.grandTotalNetAmount ?? null,
        emphasize: true,
      },
      {
        key: 'grandTotalGrossAmount',
        label: t('sales.documents.detail.totals.grandTotalGross', 'Grand total (gross)'),
        amount: record.grandTotalGrossAmount ?? null,
        emphasize: true,
      }
    )
    if (kind === 'order') {
      items.push(
        {
          key: 'paidTotalAmount',
          label: t('sales.documents.detail.totals.paidTotal', 'Paid'),
          amount: record.paidTotalAmount ?? null,
        },
        {
          key: 'refundedTotalAmount',
          label: t('sales.documents.detail.totals.refundedTotal', 'Refunded'),
          amount: record.refundedTotalAmount ?? null,
        },
        {
          key: 'outstandingAmount',
          label: t('sales.documents.detail.totals.outstandingTotal', 'Outstanding'),
          amount: record.outstandingAmount ?? null,
          emphasize: true,
        }
      )
    }
    return items
  }, [
    kind,
    record,
    record?.discountTotalAmount,
    record?.grandTotalGrossAmount,
    record?.grandTotalNetAmount,
    record?.outstandingAmount,
    record?.paidTotalAmount,
    record?.refundedTotalAmount,
    record?.shippingGrossAmount,
    record?.shippingNetAmount,
    record?.surchargeTotalAmount,
    record?.subtotalGrossAmount,
    record?.subtotalNetAmount,
    record?.taxTotalAmount,
    adjustmentRows,
    resolveAdjustmentLabel,
    t,
  ])
  const guardAllows = (list: string[] | null | undefined, status: string | null | undefined) => {
    if (list === null || list === undefined) return true
    if (list.length === 0) return false
    if (!status) return false
    return list.includes(status)
  }
  const customerGuardBlocked =
    kind === 'order' && !guardAllows(editingGuards?.customer ?? null, record?.status ?? null)
  const addressGuardBlocked =
    kind === 'order' && !guardAllows(editingGuards?.addresses ?? null, record?.status ?? null)
  const customerGuardMessage = customerGuardBlocked
    ? t('sales.documents.detail.customerBlocked', 'Customer cannot be changed for the current status.')
    : null
  const addressGuardMessage = addressGuardBlocked
    ? t('sales.documents.detail.addresses.blocked', 'Addresses cannot be changed for the current status.')
    : null
  React.useEffect(() => {
    const id = record?.customerEntityId ?? null
    if (!id) return
    const label = customerName ?? id
    setCustomerOptions((prev) => {
      const exists = prev.some((entry) => entry.id === id)
      if (exists) return prev
      const next: CustomerOption = {
        id,
        label,
        subtitle: contactEmail ?? null,
        kind: 'company',
        primaryEmail: contactEmail ?? null,
      }
      return [next, ...prev]
    })
  }, [contactEmail, customerName, record?.customerEntityId])
  const currencyEntries = React.useMemo(() => {
    const entries = Array.isArray(currencyDictionary?.entries) ? currencyDictionary.entries : []
    return entries.map((entry) => ({
      value: entry.value.toUpperCase(),
      label: entry.label,
      color: entry.color ?? null,
      icon: entry.icon ?? null,
    }))
  }, [currencyDictionary?.entries])
  const currencyOptions = React.useMemo(() => {
    const set = new Map<string, { value: string; label: string; color: string | null; icon: string | null }>()
    currencyEntries.forEach((entry) => {
      set.set(entry.value, { value: entry.value, label: entry.label, color: entry.color ?? null, icon: entry.icon ?? null })
    })
    const currentCode = typeof record?.currencyCode === 'string' ? record.currencyCode.toUpperCase() : null
    if (currentCode && !set.has(currentCode)) {
      set.set(currentCode, { value: currentCode, label: currentCode, color: null, icon: null })
    }
    return Array.from(set.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }, [currencyEntries, record?.currencyCode])
  const currencyLabels = React.useMemo(
    () => ({
      placeholder: t('sales.documents.form.currency.placeholder', 'Select currency'),
      addLabel: t('sales.documents.form.currency.add', 'Add currency'),
      dialogTitle: t('sales.documents.form.currency.dialogTitle', 'Add currency'),
      valueLabel: t('sales.documents.form.currency.valueLabel', 'Currency code'),
      valuePlaceholder: t('sales.documents.form.currency.valuePlaceholder', 'e.g. USD'),
      labelLabel: t('sales.documents.form.currency.labelLabel', 'Label'),
      labelPlaceholder: t('sales.documents.form.currency.labelPlaceholder', 'Display name'),
      emptyError: t('sales.documents.form.currency.emptyError', 'Currency code is required'),
      cancelLabel: t('sales.documents.form.currency.cancel', 'Cancel'),
      saveLabel: t('sales.documents.form.currency.save', 'Save'),
      saveShortcutHint: '⌘/Ctrl + Enter',
      successCreateLabel: t('sales.documents.form.currency.created', 'Currency saved.'),
      errorLoad: t('sales.documents.form.currency.errorLoad', 'Failed to load currencies.'),
      errorSave: t('sales.documents.form.currency.errorSave', 'Failed to save currency.'),
      loadingLabel: t('sales.documents.form.currency.loading', 'Loading currencies…'),
      manageTitle: t('sales.documents.form.currency.manage', 'Manage currency dictionary'),
    }),
    [t]
  )
  const currencyLocked = React.useMemo(
    () => hasItems || (kind === 'order' && hasPayments),
    [hasItems, hasPayments, kind]
  )
  const currencyLockMessage = React.useMemo(
    () =>
      currencyLocked
        ? t(
            'sales.documents.detail.currencyLocked',
            'Currency cannot be changed after adding items or payments.'
          )
        : null,
    [currencyLocked, t]
  )
  const statusLabels = React.useMemo<DictionarySelectLabels>(
    () => ({
      placeholder: t('sales.documents.detail.status.placeholder', 'Select status'),
      addLabel: t('sales.config.statuses.actions.add', 'Add status'),
      dialogTitle: t('sales.documents.detail.status.dialogTitle', 'Add status'),
      valueLabel: t('sales.documents.detail.status.valueLabel', 'Value'),
      valuePlaceholder: t('sales.documents.detail.status.valuePlaceholder', 'e.g. confirmed'),
      labelLabel: t('sales.documents.detail.status.labelLabel', 'Label'),
      labelPlaceholder: t('sales.documents.detail.status.labelPlaceholder', 'Display label'),
      emptyError: t('sales.documents.detail.status.emptyError', 'Status value is required.'),
      cancelLabel: t('sales.documents.detail.status.cancel', 'Cancel'),
      saveLabel: t('sales.documents.detail.status.save', 'Save'),
      saveShortcutHint: 'Ctrl/Cmd + Enter',
      successCreateLabel: t('sales.documents.detail.status.created', 'Status saved.'),
      errorLoad: t('sales.documents.detail.status.errorLoad', 'Failed to load statuses.'),
      errorSave: t('sales.documents.detail.status.errorSave', 'Failed to save status.'),
      loadingLabel: t('sales.documents.detail.status.loading', 'Loading statuses…'),
      manageTitle: t('sales.documents.detail.status.manage', 'Manage statuses'),
    }),
    [t]
  )

  const updateDocument = React.useCallback(
    async (patch: Record<string, unknown>) => {
      if (!record) {
        throw new Error(t('sales.documents.detail.updateError', 'Failed to update document.'))
      }
      const endpoint = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
      const mutation = { id: record.id, ...patch }
      return runMutationWithContext(
        () =>
          apiCallOrThrow<DocumentUpdateResult>(
            endpoint,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(mutation),
            },
            { errorMessage: t('sales.documents.detail.updateError', 'Failed to update document.') }
          ),
        mutation,
      )
    },
    [kind, record, runMutationWithContext, t]
  )

  const handleUpdateCurrency = React.useCallback(
    async (next: string | null) => {
      if (!record) return
      if (currencyLocked) {
        const message =
          currencyLockMessage ??
          t('sales.documents.detail.currencyLocked', 'Currency cannot be changed after adding items or payments.')
        flash(message, 'error')
        throw new Error(message)
      }
      const normalized = typeof next === 'string' ? next.trim().toUpperCase() : ''
      if (!/^[A-Z]{3}$/.test(normalized)) {
        const message = t('sales.documents.detail.currencyInvalid', 'Currency code must be 3 letters.')
        flash(message, 'error')
        throw new Error(message)
      }
      try {
        const call = await updateDocument({ currencyCode: normalized })
        const savedCode = call.result?.currencyCode ?? normalized
        setRecord((prev) => (prev ? { ...prev, currencyCode: savedCode } : prev))
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
        return savedCode
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [currencyLockMessage, currencyLocked, record, t, updateDocument]
  )

  const handleUpdatePlacedAt = React.useCallback(
    async (next: string | null) => {
      if (!record) return
      const raw = typeof next === 'string' ? next.trim() : ''
      const payload: { placedAt: string | null } = { placedAt: null }
      if (raw.length) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(raw).getTime())) {
          const message = t('sales.documents.detail.dateInvalid', 'Enter a valid date in YYYY-MM-DD format.')
          flash(message, 'error')
          throw new Error(message)
        }
        payload.placedAt = raw
      }
      try {
        const call = await updateDocument(payload)
        const savedPlacedAt =
          typeof call.result?.placedAt === 'string' ? call.result.placedAt : payload.placedAt
        setRecord((prev) => (prev ? { ...prev, placedAt: savedPlacedAt } : prev))
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [record, t, updateDocument]
  )

  const handleUpdateExpectedDeliveryAt = React.useCallback(
    async (next: string | null) => {
      if (!record || kind !== 'order') return
      const raw = typeof next === 'string' ? next.trim() : ''
      const payload: { expectedDeliveryAt: string | null } = { expectedDeliveryAt: null }
      if (raw.length) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(raw).getTime())) {
          const message = t('sales.documents.detail.dateInvalid', 'Enter a valid date in YYYY-MM-DD format.')
          flash(message, 'error')
          throw new Error(message)
        }
        payload.expectedDeliveryAt = raw
      }
      try {
        const call = await updateDocument(payload)
        const savedExpectedDelivery =
          typeof call.result?.expectedDeliveryAt === 'string'
            ? call.result.expectedDeliveryAt
            : payload.expectedDeliveryAt
        setRecord((prev) => (prev ? { ...prev, expectedDeliveryAt: savedExpectedDelivery } : prev))
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [canEditNumber, kind, record, t, updateDocument]
  )

  const handleUpdateComment = React.useCallback(
    async (next: string | null) => {
      if (!record) return
      const normalized = typeof next === 'string' ? next.trim() : ''
      try {
        const call = await updateDocument({ comment: normalized.length ? normalized : null })
        const savedComment =
          typeof call.result?.comment === 'string'
            ? call.result.comment
            : normalized.length
              ? normalized
              : null
        setRecord((prev) => (prev ? { ...prev, comment: savedComment } : prev))
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [record, t, updateDocument]
  )

  const handleUpdateExternalReference = React.useCallback(
    async (next: string | null) => {
      if (!record) return
      const normalized = typeof next === 'string' ? next.trim() : ''
      try {
        const call = await updateDocument({ externalReference: normalized.length ? normalized : null })
        const savedExternalReference =
          typeof call.result?.externalReference === 'string'
            ? call.result.externalReference
            : normalized.length
              ? normalized
              : null
        setRecord((prev) => (prev ? { ...prev, externalReference: savedExternalReference } : prev))
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [record, t, updateDocument]
  )

  const handleUpdateCustomerReference = React.useCallback(
    async (next: string | null) => {
      if (!record) return
      const normalized = typeof next === 'string' ? next.trim() : ''
      try {
        const call = await updateDocument({ customerReference: normalized.length ? normalized : null })
        const savedCustomerReference =
          typeof call.result?.customerReference === 'string'
            ? call.result.customerReference
            : normalized.length
              ? normalized
              : null
        setRecord((prev) => (prev ? { ...prev, customerReference: savedCustomerReference } : prev))
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [record, t, updateDocument]
  )

  const handleUpdateContactEmail = React.useCallback(
    async (next: string | null) => {
      if (!record) return
      if (customerGuardMessage) {
        flash(customerGuardMessage, 'error')
        throw new Error(customerGuardMessage)
      }
      const baseMetadata = (record.metadata ?? {}) as Record<string, unknown>
      const trimmed = typeof next === 'string' ? next.trim() : ''
      const nextValue = trimmed.length ? trimmed : null
      const updatedMetadata =
        nextValue === null
          ? Object.fromEntries(Object.entries(baseMetadata).filter(([key]) => key !== 'customerEmail'))
          : { ...baseMetadata, customerEmail: nextValue }
      const metadataPayload = Object.keys(updatedMetadata).length ? updatedMetadata : null
      const snapshotBase = (record.customerSnapshot ?? null) as CustomerSnapshot | null
      const nextSnapshot =
        snapshotBase || nextValue !== null
          ? {
              ...(snapshotBase ?? {}),
              customer: {
                ...(snapshotBase?.customer ?? {}),
                primaryEmail: nextValue,
              },
            }
          : null
      try {
        const call = await updateDocument({ metadata: metadataPayload, customerSnapshot: nextSnapshot })
        const savedMetadata =
          (call.result?.metadata as Record<string, unknown> | null | undefined) ?? metadataPayload ?? null
        const snapshotFromResult = (call.result?.customerSnapshot ?? null) as CustomerSnapshot | null
        const hasSnapshotInResponse =
          call.result && Object.prototype.hasOwnProperty.call(call.result, 'customerSnapshot')
        const savedSnapshot = hasSnapshotInResponse ? snapshotFromResult : nextSnapshot
        const savedEmail =
          resolveCustomerEmail(savedSnapshot ?? null) ??
          (typeof call.result?.contactEmail === 'string' ? call.result.contactEmail : undefined) ??
          (typeof savedMetadata?.customerEmail === 'string' ? (savedMetadata.customerEmail as string) : undefined) ??
          nextValue
        setRecord((prev) => {
          if (!prev) return prev
          const resolvedEmail = savedEmail === undefined ? prev.contactEmail ?? null : savedEmail ?? null
          return {
            ...prev,
            metadata: savedMetadata ?? null,
            customerSnapshot: savedSnapshot ?? prev.customerSnapshot ?? null,
            contactEmail: resolvedEmail,
          }
        })
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw new Error(message)
      }
    },
    [customerGuardMessage, record, t, updateDocument]
  )

  const handleUpdateChannel = React.useCallback(
    async (nextId: string | null) => {
      if (!record) return
      try {
        const call = await updateDocument({ channelId: nextId })
        const savedChannelId =
          typeof call.result?.channelId === 'string' ? call.result.channelId : nextId ?? null
        setRecord((prev) => (prev ? { ...prev, channelId: savedChannelId } : prev))
        if (savedChannelId) {
          void ensureChannelOption(savedChannelId)
        }
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [ensureChannelOption, record, t, updateDocument]
  )

  const handleUpdateShippingMethod = React.useCallback(
    async (nextId: string | null) => {
      if (!record) return
      const option =
        nextId
          ? shippingMethodOptionsRef.current.get(nextId) ??
            shippingMethodOptions.find((entry) => entry.id === nextId) ??
            null
          : null
      try {
        const call = await updateDocument({
          shippingMethodId: nextId,
          shippingMethodCode: option?.code ?? null,
        })
        const savedId =
          typeof call.result?.shippingMethodId === 'string' ? call.result.shippingMethodId : nextId ?? null
        const savedSnapshot =
          (call.result?.shippingMethodSnapshot as Record<string, unknown> | null | undefined) ?? null
        const savedCode =
          typeof call.result?.shippingMethodCode === 'string'
            ? call.result.shippingMethodCode
            : option?.code ?? null
        setRecord((prev) =>
          prev
            ? {
                ...prev,
                shippingMethodId: savedId,
                shippingMethodCode: savedCode,
                shippingMethodSnapshot: savedSnapshot,
              }
            : prev
        )
        if (savedId && savedSnapshot) {
          ensureShippingMethodOption(savedId, savedSnapshot)
        }
        emitSalesDocumentTotalsRefresh({ documentId: record.id, kind })
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [
      ensureShippingMethodOption,
      record,
      kind,
      shippingMethodOptions,
      shippingMethodOptionsRef,
      t,
      updateDocument,
    ]
  )

  const handleUpdatePaymentMethod = React.useCallback(
    async (nextId: string | null) => {
      if (!record) return
      const option =
        nextId
          ? paymentMethodOptionsRef.current.get(nextId) ??
            paymentMethodOptions.find((entry) => entry.id === nextId) ??
            null
          : null
      try {
        const call = await updateDocument({
          paymentMethodId: nextId,
          paymentMethodCode: option?.code ?? null,
        })
        const savedId =
          typeof call.result?.paymentMethodId === 'string' ? call.result.paymentMethodId : nextId ?? null
        const savedSnapshot =
          (call.result?.paymentMethodSnapshot as Record<string, unknown> | null | undefined) ?? null
        const savedCode =
          typeof call.result?.paymentMethodCode === 'string'
            ? call.result.paymentMethodCode
            : option?.code ?? null
        setRecord((prev) =>
          prev
            ? {
                ...prev,
                paymentMethodId: savedId,
                paymentMethodCode: savedCode,
                paymentMethodSnapshot: savedSnapshot,
              }
            : prev
        )
        if (savedId && savedSnapshot) {
          ensurePaymentMethodOption(savedId, savedSnapshot)
        }
        emitSalesDocumentTotalsRefresh({ documentId: record.id, kind })
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [
      ensurePaymentMethodOption,
      kind,
      paymentMethodOptions,
      paymentMethodOptionsRef,
      record,
      t,
      updateDocument,
    ]
  )

  const handleUpdateStatus = React.useCallback(
    async (entryId: string | null, value: string | null) => {
      if (!record) return
      try {
        const call = await updateDocument({ statusEntryId: entryId })
        const savedStatusEntryId =
          typeof call.result?.statusEntryId === 'string' ? call.result.statusEntryId : entryId ?? null
        const savedStatus =
          typeof call.result?.status === 'string'
            ? call.result.status
            : value
        setRecord((prev) => (prev ? { ...prev, statusEntryId: savedStatusEntryId, status: savedStatus ?? null } : prev))
        if (savedStatus) {
          ensureStatusOption(savedStatus, savedStatusEntryId)
        }
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [ensureStatusOption, record, t, updateDocument]
  )

  const handleUpdateCustomer = React.useCallback(
    async (nextId: string | null, email: string | null) => {
      if (!record) return
      const changedCustomer = nextId !== record.customerEntityId
      if (customerGuardMessage) {
        setCustomerError(customerGuardMessage)
        flash(customerGuardMessage, 'error')
        throw new Error(customerGuardMessage)
      }
      if (changedCustomer) {
        const hasAddresses =
          !!record.shippingAddressId ||
          !!record.billingAddressId ||
          !!record.shippingAddressSnapshot ||
          !!record.billingAddressSnapshot
        if (hasAddresses) {
          const confirmed = await confirm({
            title: t(
              'sales.documents.detail.customerChangeConfirm',
              'Change the customer? Existing shipping and billing addresses will be unassigned.'
            ),
            variant: 'default',
          })
          if (!confirmed) return
        }
      }
      setCustomerSaving(true)
      setCustomerError(null)
      try {
        const payload: Record<string, unknown> = { customerEntityId: nextId }
        if (email && email.trim().length) {
          payload.metadata = { customerEmail: email.trim() }
        }
        const call = await updateDocument(payload)
        const snapshot = (call.result?.customerSnapshot ?? null) as CustomerSnapshot | null
        const hasSnapshotInResponse =
          call.result && Object.prototype.hasOwnProperty.call(call.result, 'customerSnapshot')
        const selected = customerOptions.find((entry) => entry.id === nextId) ?? null
        const resolvedName =
          (call.result?.customerName as string | undefined) ??
          resolveCustomerName(snapshot, selected?.label ?? record.customerName ?? record.customerEntityId ?? null)
        const resolvedEmail =
          resolveCustomerEmail(snapshot) ??
          (call.result?.contactEmail as string | undefined | null) ??
          email ??
          selected?.primaryEmail ??
          null
        setRecord((prev) =>
          prev
            ? {
                ...prev,
                customerEntityId: nextId ?? null,
                customerName: nextId ? resolvedName ?? prev.customerName : resolvedName ?? null,
                contactEmail: resolvedEmail ?? (nextId ? prev.contactEmail ?? null : null),
                customerSnapshot:
                  hasSnapshotInResponse || changedCustomer
                    ? snapshot
                    : prev.customerSnapshot ?? null,
                shippingAddressId: changedCustomer ? null : prev.shippingAddressId ?? null,
                billingAddressId: changedCustomer ? null : prev.billingAddressId ?? null,
                shippingAddressSnapshot: changedCustomer ? null : prev.shippingAddressSnapshot ?? null,
                billingAddressSnapshot: changedCustomer ? null : prev.billingAddressSnapshot ?? null,
              }
            : prev
        )
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        setCustomerError(message)
        flash(message, 'error')
        throw err
      } finally {
        setCustomerSaving(false)
      }
    },
    [customerOptions, record, t, updateDocument]
  )

  const handleUpdateCustomerSnapshot = React.useCallback(
    async (snapshot: CustomerSnapshot) => {
      if (!record) return
      if (customerGuardMessage) {
        setCustomerError(customerGuardMessage)
        flash(customerGuardMessage, 'error')
        throw new Error(customerGuardMessage)
      }
      setCustomerSaving(true)
      setCustomerError(null)
      try {
        const call = await updateDocument({ customerSnapshot: snapshot })
        const hasSnapshotInResponse =
          call.result && Object.prototype.hasOwnProperty.call(call.result, 'customerSnapshot')
        const savedSnapshot =
          (hasSnapshotInResponse ? (call.result?.customerSnapshot ?? null) : snapshot) as CustomerSnapshot | null
        const resolvedName = resolveCustomerName(
          savedSnapshot,
          record.customerName ?? record.customerEntityId ?? null,
        )
        const resolvedEmail =
          resolveCustomerEmail(savedSnapshot) ??
          (typeof call.result?.contactEmail === 'string' ? call.result.contactEmail : record.contactEmail ?? null)
        setRecord((prev) =>
          prev
            ? {
                ...prev,
                customerSnapshot: savedSnapshot ?? null,
                customerName: resolvedName,
                contactEmail: resolvedEmail ?? null,
              }
            : prev,
        )
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        setCustomerError(message)
        flash(message, 'error')
        throw err
      } finally {
        setCustomerSaving(false)
      }
    },
    [customerGuardMessage, record, t, updateDocument],
  )

  const handleGenerateNumber = React.useCallback(async () => {
    if (!canEditNumber) {
      const message = t('sales.documents.detail.numberEditForbidden', 'You cannot edit document numbers.')
      flash(message, 'error')
      throw new Error(message)
    }
    setGenerating(true)
    try {
      const call = await apiCall<{ number?: string }>(`/api/sales/document-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      })
      const nextNumber = typeof call.result?.number === 'string' ? call.result.number : null
      if (!call.ok || !nextNumber) {
        throw new Error(t('sales.documents.detail.numberGenerateError', 'Could not generate number.'))
      }
      const payload = kind === 'order' ? { orderNumber: nextNumber } : { quoteNumber: nextNumber }
      const update = await updateDocument(payload)
      const savedNumber =
        kind === 'order'
          ? (typeof update.result?.orderNumber === 'string' ? update.result.orderNumber : nextNumber)
          : (typeof update.result?.quoteNumber === 'string' ? update.result.quoteNumber : nextNumber)
      setRecord((prev) =>
        prev
          ? {
              ...prev,
              orderNumber: kind === 'order' ? savedNumber : prev.orderNumber,
              quoteNumber: kind === 'quote' ? savedNumber : prev.quoteNumber,
            }
          : prev
      )
      setNumberEditing(false)
      flash(t('sales.documents.detail.numberGenerated', 'New number generated.'), 'success')
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('sales.documents.detail.numberGenerateError', 'Could not generate number.')
      flash(message, 'error')
      throw err
    } finally {
      setGenerating(false)
    }
  }, [canEditNumber, kind, t, updateDocument])

  const handleUpdateNumber = React.useCallback(
    async (next: string | null) => {
      if (!record) return
      if (!canEditNumber) {
        const message = t('sales.documents.detail.numberEditForbidden', 'You cannot edit document numbers.')
        flash(message, 'error')
        throw new Error(message)
      }
      const normalized = typeof next === 'string' ? next.trim() : ''
      if (!normalized.length) {
        const message = t('sales.documents.detail.numberRequired', 'Document number is required.')
        flash(message, 'error')
        throw new Error(message)
      }
      try {
        const payload = kind === 'order' ? { orderNumber: normalized } : { quoteNumber: normalized }
        const call = await updateDocument(payload)
        const savedNumber =
          kind === 'order'
            ? (typeof call.result?.orderNumber === 'string' ? call.result.orderNumber : normalized)
            : (typeof call.result?.quoteNumber === 'string' ? call.result.quoteNumber : normalized)
        setRecord((prev) =>
          prev
            ? {
                ...prev,
                orderNumber: kind === 'order' ? savedNumber : prev.orderNumber,
                quoteNumber: kind === 'quote' ? savedNumber : prev.quoteNumber,
              }
            : prev
        )
        flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.updateError', 'Failed to update document.')
        flash(message, 'error')
        throw err
      }
    },
    [canEditNumber, kind, record, t, updateDocument]
  )

  const handleConvert = React.useCallback(async () => {
    if (!record || kind !== 'quote') return
    setConverting(true)
    try {
      await runMutationWithContext(async () => {
        const call = await apiCallOrThrow<{ orderId?: string }>(
          '/api/sales/quotes/convert',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quoteId: record.id }),
          },
          { errorMessage: t('sales.documents.detail.convertError', 'Failed to convert quote.') },
        )
        const orderId = call.result?.orderId ?? record.id
        flash(t('sales.documents.detail.convertSuccess', 'Quote converted to order.'), 'success')
        router.replace(`/backend/sales/orders/${orderId}`)
      }, { quoteId: record.id })
    } catch (err) {
      console.error('sales.documents.convert', err)
      flash(t('sales.documents.detail.convertError', 'Failed to convert quote.'), 'error')
    } finally {
      setConverting(false)
    }
  }, [kind, record, router, runMutationWithContext, t])

  const handleSendQuote = React.useCallback(async () => {
    if (!record || kind !== 'quote') return
    setSending(true)
    try {
      await runMutationWithContext(async () => {
        await apiCallOrThrow('/api/sales/quotes/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quoteId: record.id, validForDays }),
        })
        flash(t('sales.quotes.send.success', 'Quote sent.'), 'success')
        setSendOpen(false)
        const updated = await fetchDocumentByKind(record.id, 'quote')
        if (updated) setRecord(updated)
      }, { quoteId: record.id, validForDays })
    } catch (err) {
      console.error('sales.quotes.send', err)
      flash(t('sales.quotes.send.failed', 'Failed to send quote.'), 'error')
    } finally {
      setSending(false)
    }
  }, [fetchDocumentByKind, kind, record, runMutationWithContext, t, validForDays])

  const handleDelete = React.useCallback(async () => {
    if (!record) return
    const ok = await confirm({
      title: t('sales.documents.detail.deleteConfirm', 'Delete this document? This cannot be undone.'),
      variant: 'default',
    })
    if (!ok) return
    setDeleting(true)
    const endpoint = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
    try {
      await runMutationWithContext(async () => {
        await apiCallOrThrow(endpoint, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: record.id }),
        }, {
          errorMessage: t('sales.documents.detail.deleteFailed', 'Could not delete document.'),
        })
      }, { id: record.id })
      flash(t('sales.documents.detail.deleted', 'Document deleted.'), 'success')
      const listPath = kind === 'order' ? '/backend/sales/orders' : '/backend/sales/quotes'
      router.push(listPath)
    } catch (err) {
      console.error('sales.documents.delete', err)
      flash(t('sales.documents.detail.deleteFailed', 'Could not delete document.'), 'error')
    }
    setDeleting(false)
  }, [kind, record, router, runMutationWithContext, t])

  const detailFields = React.useMemo(() => {
    const fields: DetailFieldConfig[] = [
      {
        key: 'shippingMethod',
        kind: 'custom',
        label: '',
        emptyLabel: '',
        render: () => (
          <MethodInlineEditor
            label={t('sales.documents.detail.shippingMethod.label', 'Shipping method')}
            value={record?.shippingMethodId ?? null}
            snapshot={(record?.shippingMethodSnapshot ?? null) as Record<string, unknown> | null}
            emptyLabel={t('sales.documents.detail.empty', 'Not set')}
            options={shippingMethodOptions}
            loading={shippingMethodLoading}
            onLoadOptions={loadShippingMethods}
            onSave={handleUpdateShippingMethod}
            saveLabel={saveShortcutLabel}
            placeholder={t('sales.documents.detail.shippingMethod.placeholder', 'Select shipping method')}
            loadingLabel={t('sales.documents.detail.shippingMethod.loading', 'Loading shipping methods…')}
            emptyResultsLabel={t('sales.documents.detail.shippingMethod.empty', 'No shipping methods found.')}
            selectedHint={(id) =>
              t('sales.documents.detail.shippingMethod.selected', 'Selected shipping method: {{id}}', { id })
            }
            icon={<Truck className="h-5 w-5 text-muted-foreground" />}
          />
        ),
      },
      {
        key: 'paymentMethod',
        kind: 'custom',
        label: '',
        emptyLabel: '',
        render: () => (
          <MethodInlineEditor
            label={t('sales.documents.detail.paymentMethod.label', 'Payment method')}
            value={record?.paymentMethodId ?? null}
            snapshot={(record?.paymentMethodSnapshot ?? null) as Record<string, unknown> | null}
            emptyLabel={t('sales.documents.detail.empty', 'Not set')}
            options={paymentMethodOptions}
            loading={paymentMethodLoading}
            onLoadOptions={loadPaymentMethods}
            onSave={handleUpdatePaymentMethod}
            saveLabel={saveShortcutLabel}
            placeholder={t('sales.documents.detail.paymentMethod.placeholder', 'Select payment method')}
            loadingLabel={t('sales.documents.detail.paymentMethod.loading', 'Loading payment methods…')}
            emptyResultsLabel={t('sales.documents.detail.paymentMethod.empty', 'No payment methods found.')}
            selectedHint={(id) =>
              t('sales.documents.detail.paymentMethod.selected', 'Selected payment method: {{id}}', { id })
            }
            icon={<CreditCard className="h-5 w-5 text-muted-foreground" />}
          />
        ),
      },
    ]
    if (kind === 'order') {
      fields.push({
        key: 'expectedDeliveryAt',
        kind: 'text',
        label: t('sales.documents.detail.expectedDeliveryAt.label', 'Expected delivery'),
        emptyLabel: t('sales.documents.detail.empty', 'Not set'),
        placeholder: t('sales.documents.detail.expectedDeliveryAt.placeholder', 'Add expected delivery date'),
        value: record?.expectedDeliveryAt
          ? new Date(record.expectedDeliveryAt).toISOString().slice(0, 10)
          : null,
        onSave: handleUpdateExpectedDeliveryAt,
        inputType: 'date',
        renderDisplay: (params) => {
          const { value, emptyLabel } = params
          if (value && value.length) {
            return <span className="text-sm text-muted-foreground">{new Date(value).toLocaleDateString()}</span>
          }
          return <span className="text-sm text-muted-foreground">{emptyLabel}</span>
        },
      })
    }
    fields.push(
      {
        key: 'externalRef',
        kind: 'text',
        label: t('sales.documents.detail.externalRef', 'External reference'),
        emptyLabel: t('sales.documents.detail.empty', 'Not set'),
        placeholder: t('sales.documents.detail.externalRef.placeholder', 'Add external reference'),
        value: record?.externalReference ?? null,
        onSave: handleUpdateExternalReference,
      },
      {
        key: 'customerRef',
        kind: 'text',
        label: t('sales.documents.detail.customerRef', 'Customer reference'),
        emptyLabel: t('sales.documents.detail.empty', 'Not set'),
        placeholder: t('sales.documents.detail.customerRef.placeholder', 'Customer PO or note'),
        value: record?.customerReference ?? null,
        onSave: handleUpdateCustomerReference,
      },
      {
        key: 'comment',
        kind: 'multiline',
        label: t('sales.documents.detail.comment', 'Comment'),
        emptyLabel: t('sales.documents.detail.empty', 'Not set'),
        placeholder: t('sales.documents.detail.comment.placeholder', 'Add comment'),
        value: record?.comment ?? null,
        onSave: handleUpdateComment,
        gridClassName: 'sm:col-span-2 xl:col-span-3',
      },
      {
        key: 'timestamps',
        kind: 'custom',
        label: '',
        emptyLabel: '',
        render: () => (
          <SectionCard title={t('sales.documents.detail.timestamps', 'Timestamps')} muted>
            <p className="text-sm text-muted-foreground">
              {t('sales.documents.detail.created', 'Created')}: {record?.createdAt ?? '—'}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('sales.documents.detail.updated', 'Updated')}: {record?.updatedAt ?? '—'}
            </p>
          </SectionCard>
        ),
      }
    )
    return fields
  }, [
    handleUpdateComment,
    handleUpdateCustomerReference,
    handleUpdateExpectedDeliveryAt,
    handleUpdateExternalReference,
    handleUpdatePaymentMethod,
    handleUpdateShippingMethod,
    loadPaymentMethods,
    loadShippingMethods,
    paymentMethodLoading,
    paymentMethodOptions,
    record?.comment,
    record?.createdAt,
    record?.customerReference,
    record?.expectedDeliveryAt,
    record?.externalReference,
    record?.paymentMethodId,
    record?.paymentMethodSnapshot,
    record?.shippingMethodId,
    record?.shippingMethodSnapshot,
    record?.updatedAt,
    shippingMethodLoading,
    shippingMethodOptions,
    t,
    kind,
    saveShortcutLabel,
  ])

  const summaryCards: Array<{
    key: 'email' | 'channel' | 'status' | 'currency'
    title: string
    value: string | null | undefined
    placeholder?: string
    emptyLabel?: string
    type?: 'email'
    containerClassName?: string
  }> = [
    {
      key: 'email',
      title: t('sales.documents.detail.email', 'Primary email'),
      value: contactEmail,
      placeholder: t('sales.documents.detail.email.placeholder', 'Add email'),
      emptyLabel: t('sales.documents.detail.empty', 'Not set'),
      type: 'email' as const,
    },
    {
      key: 'channel',
      title: t('sales.documents.detail.channel', 'Channel'),
      value: record?.channelId ?? null,
    },
    {
      key: 'status',
      title: t('sales.documents.detail.status', 'Status'),
      value: record?.status ?? null,
    },
    {
      key: 'currency',
      title: t('sales.documents.detail.currency', 'Currency'),
      value: record?.currencyCode ?? null,
      containerClassName: 'md:col-start-4 md:row-start-1',
    },
  ]

  const renderEmailDisplay = React.useCallback(
    ({ value, emptyLabel }: { value: string | null | undefined; emptyLabel: string }) => {
      const emailValue = typeof value === 'string' ? value.trim() : ''
      if (!emailValue.length) {
        return <span className="text-sm text-muted-foreground">{emptyLabel}</span>
      }
      return (
        <a
          className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 hover:underline"
          href={`mailto:${emailValue}`}
        >
          <Mail className="h-4 w-4" aria-hidden />
          <span className="truncate">{emailValue}</span>
        </a>
      )
    },
    []
  )

  const tabInjectionSpotId = React.useMemo(() => `sales.document.detail.${kind}:tabs`, [kind])
  const { widgets: injectedTabWidgets } = useInjectionWidgets(tabInjectionSpotId, {
    context: detailInjectionContext,
    triggerOnLoad: true,
  })
  const injectedTabs = React.useMemo(
    () =>
      (injectedTabWidgets ?? [])
        .filter((widget) => (widget.placement?.kind ?? 'tab') === 'tab')
        .map((widget) => {
          const id = widget.placement?.groupId ?? widget.widgetId
          const label = widget.placement?.groupLabel
            ? t(widget.placement.groupLabel, widget.module.metadata.title)
            : widget.module.metadata.title
          const priority = typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0
          const render = () => (
            <widget.module.Widget
              context={detailInjectionContext}
              data={record}
              onDataChange={(next) => setRecord(next as unknown as DocumentRecord)}
            />
          )
          return { id, label, priority, render }
        })
        .sort((a, b) => b.priority - a.priority),
    [detailInjectionContext, injectedTabWidgets, record, setRecord],
  )
  const injectedTabMap = React.useMemo(() => new Map(injectedTabs.map((tab) => [tab.id, tab.render])), [injectedTabs])

  const tabButtons = React.useMemo<Array<{ id: string; label: string }>>(
    () => {
      const tabs: Array<{ id: string; label: string }> = [
        { id: 'comments', label: t('sales.documents.detail.tabs.comments', 'Comments') },
        { id: 'addresses', label: t('sales.documents.detail.tabs.addresses', 'Addresses') },
        { id: 'items', label: t('sales.documents.detail.tabs.items', 'Items') },
      ]
      if (kind === 'order') {
        tabs.push(
          { id: 'shipments', label: t('sales.documents.detail.tabs.shipments', 'Shipments') },
          { id: 'payments', label: t('sales.documents.detail.tabs.payments', 'Payments') },
        )
      }
      tabs.push({ id: 'adjustments', label: t('sales.documents.detail.tabs.adjustments', 'Adjustments') })
      injectedTabs.forEach((tab) => {
        tabs.push({ id: tab.id, label: tab.label })
      })
      return tabs
    },
    [injectedTabs, kind, t],
  )

  React.useEffect(() => {
    if (tabButtons.some((tab) => tab.id === activeTab)) return
    const fallbackTab = tabButtons[0]?.id ?? 'comments'
    if (activeTab !== fallbackTab) {
      setActiveTab(fallbackTab)
    }
  }, [activeTab, tabButtons])

  const notesViewerLabel = React.useMemo(() => t('customers.people.detail.notes.you', 'You'), [t])

  const salesNotesAdapter = React.useMemo<NotesDataAdapter>(
    () => ({
      list: async ({ entityId }) => {
        if (!record || !entityId || record.id !== entityId) return []
        const params = new URLSearchParams({ contextType: kind, contextId: entityId })
        const payload = await readApiResultOrThrow<Record<string, unknown>>(
          `/api/sales/notes?${params.toString()}`,
          undefined,
          { errorMessage: t('sales.documents.detail.updateError', 'Failed to update document.') }
        )
        const items = Array.isArray(payload?.items) ? payload.items : []
        return items.map(mapCommentSummary)
      },
      create: async ({ entityId, body, appearanceIcon, appearanceColor }) => {
        if (!record || record.id !== entityId) {
          throw new Error(t('sales.documents.detail.updateError', 'Failed to update document.'))
        }
        const response = await apiCallOrThrow<Record<string, unknown>>(
          '/api/sales/notes',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contextType: kind,
              contextId: entityId,
              body,
              appearanceIcon: appearanceIcon ?? undefined,
              appearanceColor: appearanceColor ?? undefined,
            }),
          },
          { errorMessage: t('sales.documents.detail.updateError', 'Failed to update document.') }
        )
        return response.result ?? {}
      },
      update: async ({ id, patch }) => {
        if (!record) throw new Error(t('sales.documents.detail.updateError', 'Failed to update document.'))
        const payload: Record<string, unknown> = { id }
        if (patch.body !== undefined) payload.body = patch.body
        if (patch.appearanceIcon !== undefined) payload.appearanceIcon = patch.appearanceIcon
        if (patch.appearanceColor !== undefined) payload.appearanceColor = patch.appearanceColor
        await apiCallOrThrow(
          '/api/sales/notes',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
          { errorMessage: t('sales.documents.detail.updateError', 'Failed to update document.') }
        )
      },
      delete: async ({ id }) => {
        if (!record) throw new Error(t('sales.documents.detail.updateError', 'Failed to update document.'))
        await apiCallOrThrow(
          `/api/sales/notes?id=${encodeURIComponent(id)}`,
          {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
          },
          { errorMessage: t('sales.documents.detail.updateError', 'Failed to update document.') }
        )
      },
    }),
    [kind, record, t],
  )

  const appendShipmentComment = React.useCallback(
    async (body: string) => {
      if (!record) return
      try {
        await salesNotesAdapter.create?.({
          entityId: record.id,
          body,
          appearanceIcon: 'lucide:truck',
          appearanceColor: '#0ea5e9',
        })
      } catch (err) {
        console.error('sales.shipments.comment', err)
      }
    },
    [record, salesNotesAdapter],
  )

  const commentEmptyState = React.useMemo(
    () => ({
      title: t('sales.documents.detail.empty.comments.title', 'No comments yet.'),
      description: t('sales.documents.detail.empty.comments.description', 'Notes from teammates will appear here.'),
      actionLabel: t('sales.documents.detail.comments.add', 'Add comment'),
    }),
    [t]
  )

  const handleSectionActionChange = React.useCallback((action: SectionAction | null) => {
    setSectionAction(action)
  }, [])

  const handleSectionAction = React.useCallback(() => {
    if (!sectionAction || sectionAction.disabled) return
    sectionAction.onClick()
  }, [sectionAction])

  const tabEmptyStates = React.useMemo<Record<string, { title: string; description?: string }>>(
    () => ({
      items: {
        title: t('sales.documents.detail.empty.items.title', 'No items yet.'),
        description: t('sales.documents.detail.empty.items.description', 'Line items editor is coming in the next iteration.'),
      },
      shipments: {
        title: t('sales.documents.detail.empty.shipments.title', 'No shipments yet.'),
        description: t(
          'sales.documents.shipments.empty.description',
          'Add shipments for this document to let the user track the order.'
        ),
      },
      payments: {
        title: t('sales.documents.detail.empty.payments.title', 'No payments yet.'),
        description: t('sales.documents.detail.empty.payments.description', 'Payments are work in progress.'),
      },
      adjustments: {
        title: t('sales.documents.detail.empty.adjustments.title', 'No adjustments yet.'),
        description: t(
          'sales.documents.detail.empty.adjustments.description',
          'Add discounts, surcharges, taxes, or shipping to refine totals.'
        ),
      },
    }),
    [t]
  )

  const renderTabContent = () => {
    const injectedRenderer = injectedTabMap.get(activeTab)
    if (injectedRenderer) {
      return injectedRenderer()
    }
    if (activeTab === 'comments') {
      return (
        <NotesSection
          entityId={record.id}
          emptyLabel={t('sales.documents.detail.empty', 'Not set')}
          viewerUserId={null}
          viewerName={notesViewerLabel}
          addActionLabel={commentEmptyState.actionLabel}
          emptyState={{
            title: commentEmptyState.title,
            description: commentEmptyState.description,
            actionLabel: commentEmptyState.actionLabel,
          }}
          translator={t}
          dataAdapter={salesNotesAdapter}
          onActionChange={handleSectionActionChange}
          renderIcon={renderDictionaryIcon}
          renderColor={renderDictionaryColor}
          iconSuggestions={ICON_SUGGESTIONS}
          readMarkdownPreference={readMarkdownPreferenceCookie}
          writeMarkdownPreference={writeMarkdownPreferenceCookie}
        />
      )
    }
    if (activeTab === 'addresses') {
      return (
        <SalesDocumentAddressesSection
          documentId={record.id}
          kind={kind}
          customerId={record.customerEntityId ?? null}
          shippingAddressId={record.shippingAddressId ?? null}
          billingAddressId={record.billingAddressId ?? null}
          shippingAddressSnapshot={shippingSnapshot ?? null}
          billingAddressSnapshot={billingSnapshot ?? null}
          lockedReason={addressGuardMessage}
          onUpdated={(patch) => setRecord((prev) => (prev ? { ...prev, ...patch } : prev))}
        />
      )
    }
    if (activeTab === 'items') {
      return (
        <SalesDocumentItemsSection
          documentId={record.id}
          kind={kind}
          currencyCode={record.currencyCode ?? null}
          organizationId={(record as any)?.organizationId ?? (record as any)?.organization_id ?? null}
          tenantId={(record as any)?.tenantId ?? (record as any)?.tenant_id ?? null}
          onActionChange={handleSectionActionChange}
          onItemsChange={(items) => setHasItems(items.length > 0)}
        />
      )
    }
    if (activeTab === 'shipments') {
      if (kind !== 'order') {
        const placeholder = tabEmptyStates.shipments
        return (
          <TabEmptyState
            title={placeholder.title}
            description={placeholder.description}
          />
        )
      }
      return (
        <SalesShipmentsSection
          orderId={record.id}
          currencyCode={record.currencyCode ?? null}
          organizationId={(record as any)?.organizationId ?? (record as any)?.organization_id ?? null}
          tenantId={(record as any)?.tenantId ?? (record as any)?.tenant_id ?? null}
          shippingAddressSnapshot={shippingSnapshot ?? null}
          onActionChange={handleSectionActionChange}
          onAddComment={appendShipmentComment}
        />
      )
    }
    if (activeTab === 'adjustments') {
      return (
        <SalesDocumentAdjustmentsSection
          documentId={record.id}
          kind={kind}
          currencyCode={record.currencyCode ?? null}
          organizationId={(record as any)?.organizationId ?? (record as any)?.organization_id ?? null}
          tenantId={(record as any)?.tenantId ?? (record as any)?.tenant_id ?? null}
          onActionChange={handleSectionActionChange}
          onRowsChange={setAdjustmentRows}
        />
      )
    }
    if (activeTab === 'payments') {
      if (kind !== 'order') {
        const placeholder = tabEmptyStates.payments
        return (
          <TabEmptyState
            title={placeholder.title}
            description={placeholder.description}
          />
        )
      }
      return (
        <SalesDocumentPaymentsSection
          orderId={record.id}
          currencyCode={record.currencyCode ?? null}
          organizationId={(record as any)?.organizationId ?? (record as any)?.organization_id ?? null}
          tenantId={(record as any)?.tenantId ?? (record as any)?.tenant_id ?? null}
          onActionChange={handleSectionActionChange}
          onPaymentsChange={(payments) => setHasPayments(payments.length > 0)}
          onTotalsChange={(totals) =>
            setRecord((prev) =>
              prev
                ? {
                    ...prev,
                    paidTotalAmount:
                      totals?.paidTotalAmount ?? prev.paidTotalAmount ?? null,
                    refundedTotalAmount:
                      totals?.refundedTotalAmount ?? prev.refundedTotalAmount ?? null,
                    outstandingAmount:
                      totals?.outstandingAmount ?? prev.outstandingAmount ?? null,
                  }
                : prev
            )
          }
        />
      )
    }
    const placeholder =
      tabEmptyStates[activeTab] ??
      {
        title: t('sales.documents.detail.empty.generic', 'Nothing to show here yet.'),
        description: undefined,
      }
    return (
      <TabEmptyState
        title={placeholder.title}
        description={placeholder.description}
      />
    )
  }

  const customFieldValues = React.useMemo(() => {
    const merged: Record<string, unknown> = {}
    if (record?.customValues && typeof record.customValues === 'object' && !Array.isArray(record.customValues)) {
      Object.assign(merged, record.customValues as Record<string, unknown>)
    }
    const rawFields = record?.customFields
    if (Array.isArray(rawFields)) {
      rawFields.forEach((entry) => {
        const key = entry && typeof entry === 'object' && 'key' in entry ? (entry as any).key : null
        const value = entry && typeof entry === 'object' && 'value' in entry ? (entry as any).value : undefined
        if (typeof key === 'string' && key.trim()) merged[key] = value
      })
    } else if (rawFields && typeof rawFields === 'object') {
      Object.assign(merged, rawFields as Record<string, unknown>)
    }
    return prefixCustomFieldValues(merged)
  }, [record?.customFields, record?.customValues])

  const handleCustomFieldsSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (!record) {
        throw new Error(t('sales.documents.detail.inlineError', 'Unable to update document.'))
      }
      const customPayload = collectCustomFieldValues(values, {
        transform: (value) => normalizeCustomFieldSubmitValue(value),
        accept: (fieldId) => !fieldId.startsWith('cf_'),
      })
      if (!Object.keys(customPayload).length) {
        flash(t('ui.forms.flash.saveSuccess', 'Saved successfully.'), 'success')
        return
      }
      const endpoint = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
      try {
        await runMutationWithContext(async () => {
          await apiCallOrThrow(
            endpoint,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: record.id, customFields: customPayload }),
            },
            { errorMessage: t('sales.documents.detail.inlineError', 'Unable to update document.') },
          )
        }, { id: record.id, customFields: customPayload })
      } catch (err) {
        const { message: helperMessage, fieldErrors } = mapCrudServerErrorToFormErrors(err)
        const mappedErrors = fieldErrors
          ? Object.entries(fieldErrors).reduce<Record<string, string>>((acc, [key, value]) => {
              const formKey = key.startsWith('cf_') ? key : `cf_${key}`
              acc[formKey] = value
              return acc
            }, {})
          : undefined
        const error = new Error(helperMessage ?? t('sales.documents.detail.inlineError', 'Unable to update document.')) as Error & {
          fieldErrors?: Record<string, string>
        }
        if (mappedErrors && Object.keys(mappedErrors).length) error.fieldErrors = mappedErrors
        throw error
      }
      setRecord((prev) =>
        prev
          ? {
              ...prev,
              customFields: customPayload,
              customValues: customPayload,
            }
          : prev,
      )
      flash(t('ui.forms.flash.saveSuccess', 'Saved successfully.'), 'success')
    },
    [kind, record, runMutationWithContext, t],
  )

  const loadTagOptions = React.useCallback(
    async (query?: string): Promise<TagOption[]> => {
      const params = new URLSearchParams({ pageSize: '100' })
      if (query) params.set('search', query)
      const payload = await readApiResultOrThrow<Record<string, unknown>>(
        `/api/sales/tags?${params.toString()}`,
        undefined,
        { errorMessage: t('sales.documents.detail.tags.loadError', 'Failed to load tags.') },
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      return items
        .map((item: unknown): TagOption | null => {
          if (!item || typeof item !== 'object') return null
          const raw = item as { id?: unknown; tagId?: unknown; label?: unknown; slug?: unknown; color?: unknown }
          const rawId =
            typeof raw.id === 'string'
              ? raw.id
              : typeof raw.tagId === 'string'
                ? raw.tagId
                : null
          if (!rawId) return null
          const labelValue =
            (typeof raw.label === 'string' && raw.label.trim().length && raw.label.trim()) ||
            (typeof raw.slug === 'string' && raw.slug.trim().length && raw.slug.trim()) ||
            rawId
          const color = typeof raw.color === 'string' && raw.color.trim().length ? raw.color.trim() : null
          return { id: rawId, label: labelValue, color }
        })
        .filter((entry): entry is TagOption => entry !== null)
    },
    [t],
  )

  const createTag = React.useCallback(
    async (label: string): Promise<TagOption> => {
      const trimmed = label.trim()
      if (!trimmed.length) {
        throw new Error(t('sales.documents.detail.tags.labelRequired', 'Tag name is required.'))
      }
      const response = await apiCallOrThrow<Record<string, unknown>>(
        '/api/sales/tags',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: trimmed }),
        },
        { errorMessage: t('sales.documents.detail.tags.createError', 'Failed to create tag.') },
      )
      const payload = response.result ?? {}
      const id =
        typeof payload?.id === 'string'
          ? payload.id
          : typeof (payload as any)?.tagId === 'string'
            ? (payload as any).tagId
            : ''
      if (!id) throw new Error(t('sales.documents.detail.tags.createError', 'Failed to create tag.'))
      const color = typeof (payload as any)?.color === 'string' && (payload as any).color.trim().length
        ? (payload as any).color.trim()
        : null
      return { id, label: trimmed, color }
    },
    [t],
  )

  const handleTagsSave = React.useCallback(
    async ({ next }: { next: TagOption[] }) => {
      if (!record) return
      const endpoint = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
      const tagIds = Array.from(new Set(next.map((tag) => tag.id)))
      await runMutationWithContext(async () => {
        await apiCallOrThrow(
          endpoint,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: record.id, tags: tagIds }),
          },
          { errorMessage: t('sales.documents.detail.tags.updateError', 'Failed to update tags.') },
        )
      }, { id: record.id, tags: tagIds })
      setRecord((prev) => (prev ? { ...prev, tags: next } : prev))
      setTags(next)
      flash(t('sales.documents.detail.tags.success', 'Tags updated.'), 'success')
    },
    [kind, record, runMutationWithContext, t],
  )

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] items-center justify-center">
            <LoadingMessage
              label={t('sales.documents.detail.loading', 'Loading document…')}
              className="min-w-[280px] justify-center border-0 bg-transparent text-base shadow-none"
            />
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => handleRetry()}>
                  {t('sales.documents.detail.retry', 'Try again')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push('/backend/sales/documents/create')}
                >
                  {t('sales.documents.detail.backToCreate', 'Create a new document')}
                </Button>
              </div>
            }
          />
        </PageBody>
      </Page>
    )
  }

  if (!record) return null

  return (
    <Page>
      <PageBody className="space-y-6">
        <FormHeader
          mode="detail"
          backHref={kind === 'order' ? '/backend/sales/orders' : '/backend/sales/quotes'}
          backLabel={t('sales.documents.detail.back', 'Back to documents')}
          utilityActions={record ? (
            <VersionHistoryAction
              config={{
                resourceKind: kind === 'order' ? 'sales.order' : 'sales.quote',
                resourceId: record.id,
              }}
              t={t}
            />
          ) : null}
          entityTypeLabel={kind === 'order'
            ? t('sales.documents.detail.order', 'Sales order')
            : t('sales.documents.detail.quote', 'Sales quote')}
          title={
            canEditNumber ? (
              <InlineTextEditor
                key={numberEditorKey}
                label={t('sales.documents.detail.number', 'Document number')}
                value={number}
                emptyLabel={t('sales.documents.detail.numberEmpty', 'No number yet')}
                onSave={handleUpdateNumber}
                variant="plain"
                activateOnClick
                hideLabel
                triggerClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 mt-1"
                containerClassName="max-w-full w-full flex-1 sm:min-w-[28rem] lg:min-w-[36rem] xl:min-w-[44rem]"
                renderDisplay={({ value: displayValue, emptyLabel }) =>
                  displayValue && displayValue.length ? (
                    <span className="text-2xl font-semibold leading-tight whitespace-nowrap">{displayValue}</span>
                  ) : (
                    <span className="text-muted-foreground">{emptyLabel}</span>
                  )
                }
                onEditingChange={setNumberEditing}
                renderActions={
                  numberEditing ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => void handleGenerateNumber()}
                      disabled={generating}
                      className="h-9 w-9"
                    >
                      {generating ? <Spinner className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      <span className="sr-only">{t('sales.documents.detail.generateNumber', 'Generate number')}</span>
                    </Button>
                  ) : null
                }
              />
            ) : (
              <div className="flex items-center gap-2">
                {number && number.length ? (
                  <span className="text-2xl font-semibold leading-tight whitespace-nowrap">{number}</span>
                ) : (
                  <span className="text-muted-foreground">
                    {t('sales.documents.detail.numberEmpty', 'No number yet')}
                  </span>
                )}
              </div>
            )
          }
          statusBadge={record.status ? (
            <Badge variant="secondary" className="inline-flex items-center gap-2">
              {statusDisplay?.icon ? renderDictionaryIcon(statusDisplay.icon, 'h-4 w-4') : null}
              <span className="inline-flex items-center gap-1">
                {statusDisplay?.color
                  ? renderDictionaryColor(statusDisplay.color, 'h-2.5 w-2.5 rounded-full border border-border/60')
                  : <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              <span>{statusDisplay?.label ?? record.status}</span>
            </Badge>
          ) : undefined}
          menuActions={kind === 'quote' ? ([
            { id: 'convert', label: t('sales.documents.detail.convertToOrder', 'Convert to order'), icon: ArrowRightLeft, onSelect: () => void handleConvert(), disabled: converting, loading: converting },
            { id: 'send', label: t('sales.quotes.send.action', 'Send to customer'), icon: Send, onSelect: () => setSendOpen(true), disabled: !contactEmail || sending, loading: sending },
          ] satisfies ActionItem[]) : undefined}
          onDelete={() => void handleDelete()}
          isDeleting={deleting}
          deleteLabel={t('sales.documents.detail.delete', 'Delete')}
        />
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-3">
            <CustomerInlineEditor
              label={t('sales.documents.detail.customer', 'Customer')}
              customerId={record.customerEntityId ?? null}
              customerName={customerName}
              customerEmail={contactEmail ?? null}
              customerSnapshot={customerSnapshot}
              customers={customerOptions}
              customerLoading={customerLoading}
              onLoadCustomers={loadCustomers}
              fetchCustomerEmail={fetchCustomerEmail}
              onSave={handleUpdateCustomer}
              onSaveSnapshot={handleUpdateCustomerSnapshot}
              saving={customerSaving}
              error={customerError}
              guardMessage={customerGuardMessage}
              onClearError={clearCustomerError}
            />
          </div>
          <InlineTextEditor
            key="date"
            label={t('sales.documents.detail.date', 'Date')}
            value={
              record?.placedAt
                ? new Date(record.placedAt).toISOString().slice(0, 10)
                : record?.createdAt
                  ? new Date(record.createdAt).toISOString().slice(0, 10)
                  : null
            }
            emptyLabel={t('sales.documents.detail.empty', 'Not set')}
            onSave={handleUpdatePlacedAt}
            inputType="date"
            activateOnClick
            containerClassName="h-full"
            saveLabel={t('customers.people.detail.inline.saveShortcut')}
            renderDisplay={({ value, emptyLabel }) =>
              value && value.length ? (
                <span className="text-sm text-muted-foreground">
                  {new Date(value).toLocaleDateString()}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">{emptyLabel}</span>
              )
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {summaryCards.map((card) => {
            if (card.key === 'email') {
              return (
                <ContactEmailInlineEditor
                  key={card.key}
                  label={card.title}
                  value={card.value}
                  placeholder={card.placeholder}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  onSave={handleUpdateContactEmail}
                  renderDisplay={renderEmailDisplay}
                  recordId={contactRecordId}
                />
              )
            }
            if (card.key === 'channel') {
              return (
                <ChannelInlineEditor
                  key={card.key}
                  label={card.title}
                  value={record?.channelId ?? null}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  options={channelOptions}
                  loading={channelLoading}
                  onLoadOptions={loadChannels}
                  onSave={handleUpdateChannel}
                  saveLabel={saveShortcutLabel}
                />
              )
            }
            if (card.key === 'status') {
              return (
                <StatusInlineEditor
                  key={card.key}
                  label={card.title}
                  value={card.value}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  options={statusOptionsForEditor}
                  onSave={handleUpdateStatus}
                  onLoadOptions={loadStatuses}
                  labels={statusLabels}
                  manageHref="/backend/config/sales"
                  loading={statusLoading}
                  saveLabel={saveShortcutLabel}
                  dictionaryMap={statusDictionaryMap}
                />
              )
            }
            if (card.key === 'date') {
              return (
                <InlineTextEditor
                  key={card.key}
                  label={card.title}
                  value={card.value}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  onSave={async () => flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')}
                  inputType="date"
                  activateOnClick
                  containerClassName={card.containerClassName}
                  renderDisplay={({ value, emptyLabel }) =>
                    value && value.length ? (
                      <span className="text-sm text-foreground">{value}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">{emptyLabel}</span>
                    )
                  }
                />
              )
            }
            if (card.key === 'currency') {
              return (
                <CurrencyInlineEditor
                  key={card.key}
                  label={card.title}
                  value={card.value}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  options={currencyOptions}
                  labels={currencyLabels}
                  error={currencyError}
                  onClearError={() => setCurrencyError(null)}
                  locked={currencyLocked}
                  onLocked={() => {
                    if (currencyLockMessage) {
                      flash(currencyLockMessage, 'error')
                    }
                  }}
                  onSave={async (next) => {
                    setCurrencyError(null)
                    try {
                      await handleUpdateCurrency(next)
                    } catch (err) {
                      const message = err instanceof Error && err.message ? err.message : t('sales.documents.detail.updateError', 'Failed to update document.')
                      setCurrencyError(message)
                      throw err
                    }
                  }}
                />
              )
            }
            return (
              <InlineTextEditor
                key={card.key}
                label={card.title}
                value={card.value}
                emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                placeholder={card.placeholder}
                onSave={async () => flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')}
                inputType={card.type === 'email' ? 'email' : 'text'}
                activateOnClick
                containerClassName={card.containerClassName}
                renderDisplay={(params) =>
                  card.key === 'email'
                    ? renderEmailDisplay(params)
                    : params.value && params.value.length
                      ? <span className="text-base font-medium">{params.value}</span>
                      : <span className="text-sm text-muted-foreground">{params.emptyLabel}</span>
                }
              />
            )
          })}
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              {tabButtons.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                    'px-3 py-2 text-sm font-medium transition-colors',
                    activeTab === tab.id
                      ? 'border-b-2 border-primary text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {sectionAction ? (
              <Button
                type="button"
                size="sm"
                onClick={handleSectionAction}
                disabled={sectionAction.disabled}
              >
                {sectionAction.icon ?? <Plus className="mr-2 h-4 w-4" />}
                {sectionAction.label}
              </Button>
            ) : null}
          </div>
          {renderTabContent()}
        </div>

        <DocumentTotals
          title={t('sales.documents.detail.totals.title', 'Totals')}
          currency={record.currencyCode ?? null}
          items={totalsItems}
        />

        <div className="space-y-4" ref={detailSectionRef}>
          <p className="text-sm font-semibold">{t('sales.documents.detail.details', 'Details')}</p>
          <DetailFieldsSection fields={detailFields} />
          <InjectionSpot
            spotId={detailsInjectionSpotId}
            context={detailInjectionContext}
            data={record}
            onDataChange={(next) => setRecord(next as unknown as DocumentRecord)}
          />
        </div>

        <div className="space-y-4">
          <CustomDataSection
            title={t('sales.documents.detail.customData', 'Custom data')}
            entityIds={[kind === 'order' ? E.sales.sales_order : E.sales.sales_quote]}
            values={customFieldValues}
            onSubmit={handleCustomFieldsSubmit}
            labels={customDataLabels}
          />
          <TagsSection
            title={t('sales.documents.detail.tags', 'Tags')}
            tags={tags}
            onChange={setTags}
            isSubmitting={false}
            canEdit
            loadOptions={loadTagOptions}
            createTag={createTag}
            onSave={({ next }) => handleTagsSave({ next })}
            labels={tagLabels}
          />
        </div>
      </PageBody>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setSendOpen(false)
              return
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              if (!sending) void handleSendQuote()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('sales.quotes.send.title', 'Send quote to customer')}</DialogTitle>
            <DialogDescription>
              {t('sales.quotes.send.description', 'Email will be sent to:')} {contactEmail ?? t('sales.quotes.send.noEmail', 'No email')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('sales.quotes.send.validForDays', 'Valid for (days)')}</label>
            <Input
              type="number"
              min={1}
              max={365}
              value={validForDays}
              onChange={(e) => setValidForDays(Number(e.target.value || 14))}
              disabled={sending}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSendOpen(false)} disabled={sending}>
              {t('sales.quotes.send.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => void handleSendQuote()} disabled={sending || !contactEmail}>
              {sending ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('sales.quotes.send.submit', 'Send quote')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </Page>
  )
}