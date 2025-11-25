"use client"

import * as React from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DetailFieldsSection, InlineSelectEditor, InlineTextEditor, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

type DocumentRecord = {
  id: string
  orderNumber?: string | null
  quoteNumber?: string | null
  status?: string | null
  currencyCode?: string | null
  customerEntityId?: string | null
  billingAddressId?: string | null
  shippingAddressId?: string | null
  customerName?: string | null
  contactEmail?: string | null
  channelCode?: string | null
  createdAt?: string
  updatedAt?: string
}

async function fetchDocument(id: string, kind: 'order' | 'quote'): Promise<DocumentRecord | null> {
  const params = new URLSearchParams({ id, page: '1', pageSize: '1' })
  const call = await apiCall<{ items?: DocumentRecord[] }>(
    `/api/sales/${kind === 'order' ? 'orders' : 'quotes'}?${params.toString()}`
  )
  if (!call.ok) return null
  const items = Array.isArray(call.result?.items) ? call.result?.items : []
  return items.length ? (items[0] as DocumentRecord) : null
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

export default function SalesDocumentDetailPage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = React.useState(true)
  const [record, setRecord] = React.useState<DocumentRecord | null>(null)
  const [kind, setKind] = React.useState<'order' | 'quote'>('quote')
  const [error, setError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<'comments' | 'addresses' | 'items' | 'shipments' | 'payments' | 'adjustments'>('comments')
  const [generating, setGenerating] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const requestedKind = searchParams.get('kind')
      const preferredKind = requestedKind === 'order' ? 'order' : requestedKind === 'quote' ? 'quote' : null
      const kindsToTry: Array<'order' | 'quote'> = preferredKind ? [preferredKind] : ['quote', 'order']
      for (const candidate of kindsToTry) {
        try {
          const entry = await fetchDocument(params.id, candidate)
          if (entry && !cancelled) {
            setRecord(entry)
            setKind(candidate)
            setLoading(false)
            return
          }
        } catch (err) {
          console.error('sales.documents.detail.load', err)
        }
      }
      if (!cancelled) {
        setLoading(false)
        setError(t('sales.documents.detail.error', 'Document not found or inaccessible.'))
      }
    }
    load().catch(() => {})
    return () => { cancelled = true }
  }, [params.id, searchParams, t])

  const number = record?.orderNumber ?? record?.quoteNumber ?? record?.id

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

  const detailFields = React.useMemo(() => {
    return [
      {
        key: 'externalRef',
        kind: 'text' as const,
        label: t('sales.documents.detail.externalRef', 'External reference'),
        emptyLabel: t('sales.documents.detail.empty', 'Not set'),
        placeholder: t('sales.documents.detail.externalRef.placeholder', 'Add external reference'),
        value: record?.customerEntityId ?? null,
        onSave: async () => {
          flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')
        },
      },
      {
        key: 'currency',
        kind: 'text' as const,
        label: t('sales.documents.detail.currency', 'Currency'),
        emptyLabel: t('sales.documents.detail.empty', 'Not set'),
        placeholder: 'USD',
        value: record?.currencyCode ?? null,
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

  const summaryCards = [
    {
      key: 'email',
      title: t('sales.documents.detail.email', 'Primary email'),
      value: record?.contactEmail ?? null,
      placeholder: t('sales.documents.detail.email.placeholder', 'Add email'),
      emptyLabel: t('sales.documents.detail.empty', 'Not set'),
      type: 'email' as const,
    },
    {
      key: 'channel',
      title: t('sales.documents.detail.channel', 'Channel'),
      value: record?.channelCode ?? null,
    },
    {
      key: 'status',
      title: t('sales.documents.detail.status', 'Status'),
      value: record?.status ?? null,
    },
    {
      key: 'date',
      title: t('sales.documents.detail.date', 'Date'),
      value: record?.createdAt ?? null,
    },
  ]

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
        <div className="grid gap-3 md:grid-cols-2">
          <SectionCard title={t('sales.documents.detail.shipping', 'Shipping address')} muted>
            <p className="text-sm">{record?.shippingAddressId ?? t('sales.documents.detail.customer.empty', 'Not linked')}</p>
          </SectionCard>
          <SectionCard title={t('sales.documents.detail.billing', 'Billing address')} muted>
            <p className="text-sm">{record?.billingAddressId ?? t('sales.documents.detail.customer.empty', 'Not linked')}</p>
          </SectionCard>
        </div>
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
          <LoadingMessage label={t('sales.documents.detail.loading', 'Loading document…')} />
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <div className="space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => router.push('/backend/sales/documents/create')}>
              {t('sales.documents.detail.backToCreate', 'Create a new document')}
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (!record) return null

  const customerProvided = !!record.customerEntityId

  return (
    <Page>
      <PageBody className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase text-muted-foreground">
              {kind === 'order'
                ? t('sales.documents.detail.order', 'Sales order')
                : t('sales.documents.detail.quote', 'Sales quote')}
            </p>
            <InlineTextEditor
              label={t('sales.documents.detail.number', 'Document number')}
              value={number}
              emptyLabel={t('sales.documents.detail.numberEmpty', 'No number yet')}
              onSave={async () => flash(t('sales.documents.detail.saveStub', 'Saving number will land soon.'), 'info')}
              variant="plain"
              activateOnClick
              hideLabel
              triggerClassName="mt-1"
            />
            {record.status ? (
              <Badge variant="secondary" className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                {record.status}
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => router.push('/backend/sales/documents/create')}>
              {t('sales.documents.detail.back', 'Back to documents')}
            </Button>
            <Button variant="outline" onClick={() => void handleGenerateNumber()} disabled={generating}>
              {generating ? <Spinner className="mr-2 h-3.5 w-3.5" /> : null}
              {t('sales.documents.detail.generateNumber', 'Generate number')}
            </Button>
          </div>
        </div>

        <SectionCard
          title={t('sales.documents.detail.customer', 'Customer')}
          muted
          action={
            <Button variant="ghost" size="sm" onClick={() => flash(t('sales.documents.detail.saveStub', 'Assigning customers will land soon.'), 'info')}>
              {customerProvided ? t('sales.documents.detail.customer.change', 'Change') : t('sales.documents.detail.customer.assign', 'Assign')}
            </Button>
          }
        >
          {customerProvided ? (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted" />
              <div>
                <p className="text-sm font-medium">{record.customerName ?? record.customerEntityId}</p>
                <p className="text-xs text-muted-foreground">
                  {t('sales.documents.detail.customer.optional', 'Customer assignment is optional.')}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('sales.documents.detail.customer.empty', 'No customer linked yet. Keep it empty or assign one.')}
            </p>
          )}
        </SectionCard>

        <div className="grid gap-3 lg:grid-cols-4 md:grid-cols-2">
          {summaryCards.map((card) => (
            <SectionCard key={card.key} title={card.title} muted>
              {card.key === 'channel' ? (
                <InlineSelectEditor
                  label={card.title}
                  value={card.value}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  onSave={async () => flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')}
                  options={[
                    { value: 'default', label: t('sales.documents.detail.channel.default', 'Default') },
                    { value: 'b2b', label: t('sales.documents.detail.channel.b2b', 'B2B storefront') },
                    { value: 'pos', label: t('sales.documents.detail.channel.pos', 'POS') },
                  ]}
                  variant="plain"
                  activateOnClick
                />
              ) : card.key === 'status' ? (
                <InlineSelectEditor
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
                  variant="plain"
                  activateOnClick
                />
              ) : card.key === 'date' ? (
                <InlineTextEditor
                  label={card.title}
                  value={card.value}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  onSave={async () => flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')}
                  variant="plain"
                  inputType="date"
                  activateOnClick
                />
              ) : (
                <InlineTextEditor
                  label={card.title}
                  value={card.value}
                  emptyLabel={card.emptyLabel ?? t('sales.documents.detail.empty', 'Not set')}
                  placeholder={card.placeholder}
                  onSave={async () => flash(t('sales.documents.detail.saveStub', 'Saving details will land soon.'), 'info')}
                  inputType={card.type === 'email' ? 'email' : 'text'}
                  variant="plain"
                  activateOnClick
                />
              )}
            </SectionCard>
          ))}
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
