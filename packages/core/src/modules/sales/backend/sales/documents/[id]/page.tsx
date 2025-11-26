"use client"

import * as React from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DetailFieldsSection, ErrorMessage, InlineSelectEditor, InlineTextEditor, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Mail, Pencil, Trash2, Wand2, X } from 'lucide-react'
import Link from 'next/link'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { DocumentCustomerCard } from '@open-mercato/core/modules/sales/components/DocumentCustomerCard'
import { SalesDocumentAddressesSection } from '@open-mercato/core/modules/sales/components/documents/AddressesSection'
import type { DictionarySelectLabels } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { useCurrencyDictionary } from '@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { DictionaryEntrySelect } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'

function CurrencyInlineEditor({
  label,
  value,
  options,
  labels,
  emptyLabel,
  onSave,
  error,
  onClearError,
}: {
  label: string
  value: string | null | undefined
  options: { value: string; label: string; color?: string | null; icon?: string | null }[]
  labels: DictionarySelectLabels
  emptyLabel: string
  onSave: (next: string | null) => Promise<void>
  error: string | null
  onClearError: () => void
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<string | undefined>(value ?? undefined)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!editing) setDraft(value ?? undefined)
  }, [editing, value])

  const current = options.find((opt) => opt.value === (value ?? undefined))
  const fetchOptions = React.useCallback(async () => options, [options])

  const handleActivate = React.useCallback(() => {
    if (!editing) {
      setEditing(true)
    }
  }, [editing])

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
                onChange={(next) => setDraft(next ?? undefined)}
                fetchOptions={fetchOptions}
                allowInlineCreate={false}
                manageHref="/backend/config/dictionaries?key=currency"
                selectClassName="w-full"
                labels={labels}
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
            <div className="mt-1 flex items-center gap-2 text-sm text-foreground">
              {current ? (
                <>
                  {renderDictionaryIcon(current.icon, 'h-4 w-4')}
                  <span className={current.color ? 'font-medium' : 'text-foreground'}>{current.label}</span>
                  {renderDictionaryColor(current.color, 'h-3 w-3 rounded-full')}
                </>
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
              onClearError()
              setDraft(value ?? undefined)
            }
            setEditing((prev) => !prev)
          }}
          aria-label={editing ? t('ui.detail.inline.cancel', 'Cancel') : t('ui.detail.inline.edit', 'Edit')}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

type CustomerSnapshot = {
  customer?: {
    id?: string | null
    displayName?: string | null
    primaryEmail?: string | null
    primaryPhone?: string | null
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

type DocumentRecord = {
  id: string
  orderNumber?: string | null
  quoteNumber?: string | null
  status?: string | null
  currencyCode?: string | null
  customerEntityId?: string | null
  billingAddressId?: string | null
  shippingAddressId?: string | null
  customerReference?: string | null
  externalReference?: string | null
  channelId?: string | null
  placedAt?: string | null
  customerSnapshot?: Record<string, unknown> | null
  billingAddressSnapshot?: Record<string, unknown> | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  customerName?: string | null
  contactEmail?: string | null
  channelCode?: string | null
  comment?: string | null
  createdAt?: string
  updatedAt?: string
}

type DocumentUpdateResult = {
  currencyCode?: string | null
  placedAt?: string | null
  shippingAddressId?: string | null
  billingAddressId?: string | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  billingAddressSnapshot?: Record<string, unknown> | null
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
  const base = snapshot.customer?.displayName ?? null
  if (base) return base
  const contact = snapshot.contact
  if (contact) {
    const parts = [contact.firstName, contact.lastName].filter((part) => part && part.trim().length)
    if (parts.length) return parts.join(' ')
  }
  return fallback ?? null
}

function resolveCustomerEmail(snapshot: CustomerSnapshot | null | undefined) {
  if (!snapshot) return null
  if (snapshot.customer?.primaryEmail) return snapshot.customer.primaryEmail
  return null
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
  const [loading, setLoading] = React.useState(true)
  const [record, setRecord] = React.useState<DocumentRecord | null>(null)
  const [kind, setKind] = React.useState<'order' | 'quote'>('quote')
  const [error, setError] = React.useState<string | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)
  const [activeTab, setActiveTab] = React.useState<'comments' | 'addresses' | 'items' | 'shipments' | 'payments' | 'adjustments'>('comments')
  const [generating, setGenerating] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [numberEditing, setNumberEditing] = React.useState(false)
  const [currencyError, setCurrencyError] = React.useState<string | null>(null)
  const { data: currencyDictionary } = useCurrencyDictionary()

  const loadErrorMessage = React.useMemo(
    () => t('sales.documents.detail.error', 'Document not found or inaccessible.'),
    [t]
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

  const handleRetry = React.useCallback(() => {
    setReloadKey((prev) => prev + 1)
  }, [])

  const number = record?.orderNumber ?? record?.quoteNumber ?? record?.id
  const customerSnapshot = (record?.customerSnapshot ?? null) as CustomerSnapshot | null
  const billingSnapshot = (record?.billingAddressSnapshot ?? null) as AddressSnapshot | null
  const shippingSnapshot = (record?.shippingAddressSnapshot ?? null) as AddressSnapshot | null
  const customerName = resolveCustomerName(customerSnapshot, record?.customerName ?? record?.customerEntityId ?? null)
  const contactEmail = resolveCustomerEmail(customerSnapshot) ?? record?.contactEmail ?? null
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

  const updateDocument = React.useCallback(
    async (patch: Record<string, unknown>) => {
      if (!record) {
        throw new Error(t('sales.documents.detail.updateError', 'Failed to update document.'))
      }
      const endpoint = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
      return apiCallOrThrow<DocumentUpdateResult>(
        endpoint,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: record.id, ...patch }),
        },
        { errorMessage: t('sales.documents.detail.updateError', 'Failed to update document.') }
      )
    },
    [kind, record, t]
  )

  const handleUpdateCurrency = React.useCallback(
    async (next: string | null) => {
      if (!record) return
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
    [record, t, updateDocument]
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

  const handleGenerateNumber = React.useCallback(async () => {
    setGenerating(true)
    const call = await apiCall<{ number?: string }>(`/api/sales/document-numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
    if (call.ok && call.result?.number) {
      setRecord((prev) => (prev ? { ...prev, orderNumber: kind === 'order' ? call.result?.number : prev.orderNumber, quoteNumber: kind === 'quote' ? call.result?.number : prev.quoteNumber } : prev))
      flash(t('sales.documents.detail.numberGenerated', 'New number generated.'), 'success')
    } else {
      flash(t('sales.documents.detail.numberGenerateError', 'Could not generate number.'), 'error')
    }
    setGenerating(false)
  }, [kind, t])

  const handleDelete = React.useCallback(async () => {
    if (!record) return
    const confirmed = window.confirm(
      t('sales.documents.detail.deleteConfirm', 'Delete this document? This cannot be undone.')
    )
    if (!confirmed) return
    setDeleting(true)
    const endpoint = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
    const call = await apiCall(endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: record.id }),
    })
    if (call.ok) {
      flash(t('sales.documents.detail.deleted', 'Document deleted.'), 'success')
      const listPath = kind === 'order' ? '/backend/sales/orders' : '/backend/sales/quotes'
      router.push(listPath)
    } else {
      flash(t('sales.documents.detail.deleteFailed', 'Could not delete document.'), 'error')
    }
    setDeleting(false)
  }, [kind, record, router, t])

  const detailFields = React.useMemo(() => {
    return [
      {
        key: 'externalRef',
        kind: 'text' as const,
        label: t('sales.documents.detail.externalRef', 'External reference'),
        emptyLabel: t('sales.documents.detail.empty', 'Not set'),
        placeholder: t('sales.documents.detail.externalRef.placeholder', 'Add external reference'),
        value: record?.externalReference ?? null,
        onSave: async () => {
          flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')
        },
      },
      {
        key: 'customerRef',
        kind: 'text' as const,
        label: t('sales.documents.detail.customerRef', 'Customer reference'),
        emptyLabel: t('sales.documents.detail.empty', 'Not set'),
        placeholder: t('sales.documents.detail.customerRef.placeholder', 'Customer PO or note'),
        value: record?.customerReference ?? null,
        onSave: async () => {
          flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')
        },
      },
      {
        key: 'comment',
        kind: 'text' as const,
        label: t('sales.documents.detail.comment', 'Comment'),
        emptyLabel: t('sales.documents.detail.empty', 'Not set'),
        placeholder: t('sales.documents.detail.comment.placeholder', 'Add comment'),
        value: record?.comment ?? null,
        onSave: async () => {
          flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')
        },
      },
      {
        key: 'timestamps',
        kind: 'custom' as const,
        label: '',
        emptyLabel: '',
        render: () => (
          <SectionCard title={t('sales.documents.detail.timestamps', 'Timestamps')} muted>
            <p className="text-sm">
              {t('sales.documents.detail.created', 'Created')}: {record?.createdAt ?? '—'}
            </p>
            <p className="text-sm">
              {t('sales.documents.detail.updated', 'Updated')}: {record?.updatedAt ?? '—'}
            </p>
          </SectionCard>
        ),
      },
    ]
  }, [record?.createdAt, record?.currencyCode, record?.customerEntityId, record?.updatedAt, t])

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

  const tabButtons: Array<{ id: typeof activeTab; label: string }> = [
    { id: 'comments', label: t('sales.documents.detail.tabs.comments', 'Comments') },
    { id: 'addresses', label: t('sales.documents.detail.tabs.addresses', 'Addresses') },
    { id: 'items', label: t('sales.documents.detail.tabs.items', 'Items') },
    { id: 'shipments', label: t('sales.documents.detail.tabs.shipments', 'Shipments') },
    { id: 'payments', label: t('sales.documents.detail.tabs.payments', 'Payments') },
    { id: 'adjustments', label: t('sales.documents.detail.tabs.adjustments', 'Adjustments') },
  ]

  const renderTabContent = () => {
    if (activeTab === 'comments') {
      return (
        <SectionCard title={t('sales.documents.detail.comments', 'Comments')} muted>
          <p className="text-sm text-muted-foreground">
            {t('sales.documents.detail.commentsEmpty', 'No comments yet. Notes from teammates will appear here.')}
          </p>
        </SectionCard>
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
          onUpdated={(patch) => setRecord((prev) => (prev ? { ...prev, ...patch } : prev))}
        />
      )
    }
    const placeholders: Record<typeof activeTab, string> = {
      comments: '',
      addresses: '',
      items: t('sales.documents.detail.items.wip', 'Line items editor is coming in the next iteration.'),
      shipments: t('sales.documents.detail.shipments.wip', 'Shipments management is work in progress.'),
      payments: t('sales.documents.detail.payments.wip', 'Payments are work in progress.'),
      adjustments: t('sales.documents.detail.adjustments.wip', 'Adjustments are work in progress.'),
    }
    return (
      <SectionCard title={tabButtons.find((tab) => tab.id === activeTab)?.label ?? ''} muted>
        <p className="text-sm text-muted-foreground">{placeholders[activeTab]}</p>
      </SectionCard>
    )
  }

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

  const customerProvided = !!record.customerEntityId

  return (
    <Page>
      <PageBody className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={kind === 'order' ? '/backend/sales/orders' : '/backend/sales/quotes'}
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <span aria-hidden className="mr-1 text-base">←</span>
              <span className="sr-only">{t('sales.documents.detail.back', 'Back to documents')}</span>
            </Link>
            <div className="space-y-1">
              <p className="text-xs uppercase text-muted-foreground">
                {kind === 'order'
                  ? t('sales.documents.detail.order', 'Sales order')
                  : t('sales.documents.detail.quote', 'Sales quote')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <InlineTextEditor
                  label={t('sales.documents.detail.number', 'Document number')}
                  value={number}
                  emptyLabel={t('sales.documents.detail.numberEmpty', 'No number yet')}
                  onSave={async () => flash(t('sales.documents.detail.saveStub', 'Saving number will land soon.'), 'info')}
                  variant="plain"
                  activateOnClick
                  hideLabel
                  triggerClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 mt-1"
                  containerClassName="max-w-full"
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
              </div>
              {record.status ? (
                <Badge variant="secondary" className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  {record.status}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="rounded-none border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
            >
              {deleting ? <Spinner className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" aria-hidden />}
              {t('sales.documents.detail.delete', 'Delete')}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-3">
            <DocumentCustomerCard
              label={undefined}
              name={customerName}
              email={contactEmail ?? undefined}
              kind={customerProvided ? 'company' : 'company'}
              className="h-full"
              onEdit={() => flash(t('sales.documents.detail.saveStub', 'Assigning customers will land soon.'), 'info')}
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
            if (card.key === 'channel') {
              return (
                <InlineSelectEditor
                  key={card.key}
                  label={card.title}
                  value={card.value}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  onSave={async () => flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')}
                  options={[
                    { value: 'default', label: t('sales.documents.detail.channel.default', 'Default') },
                    { value: 'b2b', label: t('sales.documents.detail.channel.b2b', 'B2B storefront') },
                    { value: 'pos', label: t('sales.documents.detail.channel.pos', 'POS') },
                  ]}
                  activateOnClick
                  containerClassName={card.containerClassName}
                />
              )
            }
            if (card.key === 'status') {
              return (
                <InlineSelectEditor
                  key={card.key}
                  label={card.title}
                  value={card.value}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  onSave={async () => flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')}
                  options={[
                    { value: 'draft', label: t('sales.documents.detail.status.draft', 'Draft') },
                    { value: 'ready', label: t('sales.documents.detail.status.ready', 'Ready') },
                    { value: 'sent', label: t('sales.documents.detail.status.sent', 'Sent') },
                    { value: 'completed', label: t('sales.documents.detail.status.completed', 'Completed') },
                  ]}
                  activateOnClick
                  containerClassName={card.containerClassName}
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
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b pb-2">
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
          {renderTabContent()}
        </div>

        <div className="space-y-4">
          <p className="text-sm font-semibold">{t('sales.documents.detail.details', 'Details')}</p>
          <DetailFieldsSection fields={detailFields} />
        </div>

        <div className="space-y-4">
          <p className="text-sm font-semibold">{t('sales.documents.detail.customData', 'Custom data')}</p>
          <SectionCard title={t('sales.documents.detail.customDataTitle', 'Custom data')} muted>
            <p className="text-sm text-muted-foreground">
              {t('sales.documents.detail.customData.placeholder', 'Attach structured attributes here.')}
            </p>
          </SectionCard>
          <SectionCard title={t('sales.documents.detail.tags', 'Tags')} muted>
            <p className="text-sm text-muted-foreground">
              {t('sales.documents.detail.tags.placeholder', 'No tags yet. Add labels to keep documents organized.')}
            </p>
          </SectionCard>
        </div>
      </PageBody>
    </Page>
  )
}
