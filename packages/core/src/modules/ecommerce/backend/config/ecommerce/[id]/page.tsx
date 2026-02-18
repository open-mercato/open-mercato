'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'

// ─── Types ────────────────────────────────────────────────────────────────────

type StoreData = {
  id: string
  name: string
  code: string
  slug: string
  status: string
  default_locale: string
  supported_locales: string[]
  default_currency_code: string
  is_primary: boolean
}

type DomainRow = {
  id: string
  host: string
  is_primary: boolean
  tls_mode: string
  verification_status: string
}

type BindingRow = {
  id: string
  sales_channel_id: string
  price_kind_id: string | null
  is_default: boolean
}

type StoreFormValues = {
  name: string
  code: string
  slug: string
  status: string
  defaultLocale: string
  supportedLocales: string
  defaultCurrencyCode: string
  isPrimary: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapStore(item: Record<string, unknown>): StoreData | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    name: typeof item.name === 'string' ? item.name : '',
    code: typeof item.code === 'string' ? item.code : '',
    slug: typeof item.slug === 'string' ? item.slug : '',
    status: typeof item.status === 'string' ? item.status : 'draft',
    default_locale: typeof item.default_locale === 'string' ? item.default_locale : 'en',
    supported_locales: Array.isArray(item.supported_locales) ? item.supported_locales as string[] : [],
    default_currency_code: typeof item.default_currency_code === 'string' ? item.default_currency_code : 'USD',
    is_primary: typeof item.is_primary === 'boolean' ? item.is_primary : false,
  }
}

function mapDomain(item: Record<string, unknown>): DomainRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    host: typeof item.host === 'string' ? item.host : '',
    is_primary: typeof item.is_primary === 'boolean' ? item.is_primary : false,
    tls_mode: typeof item.tls_mode === 'string' ? item.tls_mode : 'platform',
    verification_status: typeof item.verification_status === 'string' ? item.verification_status : 'pending',
  }
}

function mapBinding(item: Record<string, unknown>): BindingRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  return {
    id,
    sales_channel_id: typeof item.sales_channel_id === 'string' ? item.sales_channel_id : '',
    price_kind_id: typeof item.price_kind_id === 'string' ? item.price_kind_id : null,
    is_default: typeof item.is_default === 'boolean' ? item.is_default : false,
  }
}

function verificationBadge(status: string) {
  if (status === 'verified') return <Badge variant="default">Verified</Badge>
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>
  return <Badge variant="outline">Pending</Badge>
}

// ─── Domain Add Form ──────────────────────────────────────────────────────────

function AddDomainForm({
  storeId,
  onAdded,
  onCancel,
}: {
  storeId: string
  onAdded: () => void
  onCancel: () => void
}) {
  const t = useT()
  const [host, setHost] = React.useState('')
  const [isPrimary, setIsPrimary] = React.useState(false)
  const [tlsMode, setTlsMode] = React.useState<'platform' | 'external'>('platform')
  const [submitting, setSubmitting] = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedHost = host.trim()
    if (!trimmedHost) return
    setSubmitting(true)
    try {
      await apiCallOrThrow(
        '/api/ecommerce/store-domains',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ storeId, host: trimmedHost, isPrimary, tlsMode }),
        },
        { errorMessage: t('ecommerce.store_domains.addError', 'Failed to add domain') },
      )
      flash(t('ecommerce.store_domains.addSuccess', 'Domain added'), 'success')
      onAdded()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('ecommerce.store_domains.addError', 'Failed to add domain'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-md border p-4 space-y-3 bg-muted/30">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2 space-y-1">
          <Label htmlFor="domain-host">{t('ecommerce.store_domains.fields.host', 'Hostname')}</Label>
          <Input
            id="domain-host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="shop.example.com"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="domain-tls">{t('ecommerce.store_domains.fields.tlsMode', 'TLS Mode')}</Label>
          <select
            id="domain-tls"
            value={tlsMode}
            onChange={(e) => setTlsMode(e.target.value as 'platform' | 'external')}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="platform">{t('ecommerce.store_domains.tls_mode.platform', 'Platform')}</option>
            <option value="external">{t('ecommerce.store_domains.tls_mode.external', 'External')}</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
          className="h-4 w-4 rounded border"
        />
        {t('ecommerce.store_domains.fields.isPrimary', 'Primary Domain')}
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {t('ecommerce.store_domains.add', 'Add Domain')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          {t('ecommerce.stores.form.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}

// ─── Channel Binding Add Form ─────────────────────────────────────────────────

function AddBindingForm({
  storeId,
  onAdded,
  onCancel,
}: {
  storeId: string
  onAdded: () => void
  onCancel: () => void
}) {
  const t = useT()
  const [salesChannelId, setSalesChannelId] = React.useState('')
  const [priceKindId, setPriceKindId] = React.useState('')
  const [isDefault, setIsDefault] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const channelId = salesChannelId.trim()
    if (!channelId) return
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { storeId, salesChannelId: channelId, isDefault }
      const pkId = priceKindId.trim()
      if (pkId) body.priceKindId = pkId
      await apiCallOrThrow(
        '/api/ecommerce/store-channel-bindings',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        { errorMessage: t('ecommerce.store_channel_bindings.addError', 'Failed to add binding') },
      )
      flash(t('ecommerce.store_channel_bindings.addSuccess', 'Binding added'), 'success')
      onAdded()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('ecommerce.store_channel_bindings.addError', 'Failed to add binding'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-md border p-4 space-y-3 bg-muted/30">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="binding-channel">{t('ecommerce.store_channel_bindings.fields.salesChannelId', 'Sales Channel ID')}</Label>
          <Input
            id="binding-channel"
            value={salesChannelId}
            onChange={(e) => setSalesChannelId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="binding-price-kind">{t('ecommerce.store_channel_bindings.fields.priceKindId', 'Price Kind ID')}</Label>
          <Input
            id="binding-price-kind"
            value={priceKindId}
            onChange={(e) => setPriceKindId(e.target.value)}
            placeholder={t('ecommerce.store_channel_bindings.form.optional', 'Optional')}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-4 w-4 rounded border"
        />
        {t('ecommerce.store_channel_bindings.fields.isDefault', 'Default Binding')}
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {t('ecommerce.store_channel_bindings.create', 'Add Binding')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          {t('ecommerce.stores.form.cancel', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EcommerceStoreDetailPage() {
  const t = useT()
  const params = useParams()
  const storeId = typeof params?.id === 'string' ? params.id : ''
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()

  const [store, setStore] = React.useState<StoreData | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  const [domains, setDomains] = React.useState<DomainRow[]>([])
  const [domainsLoading, setDomainsLoading] = React.useState(false)
  const [showAddDomain, setShowAddDomain] = React.useState(false)

  const [bindings, setBindings] = React.useState<BindingRow[]>([])
  const [bindingsLoading, setBindingsLoading] = React.useState(false)
  const [showAddBinding, setShowAddBinding] = React.useState(false)

  const [reloadToken, setReloadToken] = React.useState(0)

  // Load store
  React.useEffect(() => {
    if (!storeId) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/ecommerce/stores?id=${encodeURIComponent(storeId)}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (cancelled) return
        if (!call.ok) {
          setLoadError(t('ecommerce.stores.loadError', 'Failed to load store'))
          return
        }
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        const found = items.map((i) => mapStore(i)).find((s): s is StoreData => !!s) ?? null
        if (!found) {
          setLoadError(t('ecommerce.errors.store_not_found', 'Store not found'))
          return
        }
        setStore(found)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [storeId, reloadToken, scopeVersion, t])

  // Load domains
  const loadDomains = React.useCallback(async () => {
    if (!storeId) return
    setDomainsLoading(true)
    try {
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/ecommerce/store-domains?storeId=${encodeURIComponent(storeId)}&pageSize=50`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setDomains(items.map((i) => mapDomain(i)).filter((d): d is DomainRow => !!d))
    } finally {
      setDomainsLoading(false)
    }
  }, [storeId])

  // Load bindings
  const loadBindings = React.useCallback(async () => {
    if (!storeId) return
    setBindingsLoading(true)
    try {
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/ecommerce/store-channel-bindings?storeId=${encodeURIComponent(storeId)}&pageSize=50`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      setBindings(items.map((i) => mapBinding(i)).filter((b): b is BindingRow => !!b))
    } finally {
      setBindingsLoading(false)
    }
  }, [storeId])

  React.useEffect(() => { loadDomains() }, [loadDomains])
  React.useEffect(() => { loadBindings() }, [loadBindings])

  const handleDeleteDomain = React.useCallback(async (domain: DomainRow) => {
    const confirmed = await confirm({
      title: t('ecommerce.store_domains.deleteConfirm', 'Remove domain "{{host}}"?', { host: domain.host }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await apiCallOrThrow(
        `/api/ecommerce/store-domains?id=${encodeURIComponent(domain.id)}`,
        { method: 'DELETE', headers: { 'content-type': 'application/json' } },
        { errorMessage: t('ecommerce.store_domains.deleteError', 'Failed to remove domain') },
      )
      setDomains((prev) => prev.filter((d) => d.id !== domain.id))
      flash(t('ecommerce.store_domains.deleteSuccess', 'Domain removed'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('ecommerce.store_domains.deleteError', 'Failed to remove domain'), 'error')
    }
  }, [confirm, t])

  const handleDeleteBinding = React.useCallback(async (binding: BindingRow) => {
    const confirmed = await confirm({
      title: t('ecommerce.store_channel_bindings.deleteConfirm', 'Remove this channel binding?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await apiCallOrThrow(
        `/api/ecommerce/store-channel-bindings?id=${encodeURIComponent(binding.id)}`,
        { method: 'DELETE', headers: { 'content-type': 'application/json' } },
        { errorMessage: t('ecommerce.store_channel_bindings.deleteError', 'Failed to remove binding') },
      )
      setBindings((prev) => prev.filter((b) => b.id !== binding.id))
      flash(t('ecommerce.store_channel_bindings.deleteSuccess', 'Binding removed'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('ecommerce.store_channel_bindings.deleteError', 'Failed to remove binding'), 'error')
    }
  }, [confirm, t])

  // Form fields for editing the store
  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('ecommerce.stores.fields.name', 'Name'),
      type: 'text',
      required: true,
    },
    {
      id: 'code',
      label: t('ecommerce.stores.fields.code', 'Code'),
      type: 'text',
      required: true,
      description: t('ecommerce.stores.form.descriptions.code', 'Lowercase alphanumeric with dashes/underscores.'),
    },
    {
      id: 'slug',
      label: t('ecommerce.stores.fields.slug', 'Slug'),
      type: 'text',
      required: true,
    },
    {
      id: 'status',
      label: t('ecommerce.stores.fields.status', 'Status'),
      type: 'select',
      options: [
        { value: 'draft', label: t('ecommerce.stores.status.draft', 'Draft') },
        { value: 'active', label: t('ecommerce.stores.status.active', 'Active') },
        { value: 'archived', label: t('ecommerce.stores.status.archived', 'Archived') },
      ],
    },
    {
      id: 'defaultLocale',
      label: t('ecommerce.stores.fields.defaultLocale', 'Default Locale'),
      type: 'text',
    },
    {
      id: 'supportedLocales',
      label: t('ecommerce.stores.fields.supportedLocales', 'Supported Locales'),
      type: 'text',
      description: t('ecommerce.stores.form.descriptions.supportedLocales', 'Comma-separated locale codes.'),
    },
    {
      id: 'defaultCurrencyCode',
      label: t('ecommerce.stores.fields.defaultCurrencyCode', 'Default Currency'),
      type: 'text',
    },
    {
      id: 'isPrimary',
      label: t('ecommerce.stores.fields.isPrimary', 'Primary Store'),
      type: 'checkbox',
    },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identity',
      title: t('ecommerce.stores.form.groups.identity', 'Identity'),
      column: 1,
      fields: ['name', 'code', 'slug', 'status'],
    },
    {
      id: 'locale',
      title: t('ecommerce.stores.form.groups.locale', 'Locale & Currency'),
      column: 2,
      fields: ['defaultLocale', 'supportedLocales', 'defaultCurrencyCode', 'isPrimary'],
    },
  ], [t])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('ecommerce.stores.loading', 'Loading store...')} /></PageBody></Page>
  if (loadError || !store) return <Page><PageBody><ErrorMessage label={loadError ?? t('ecommerce.errors.store_not_found', 'Store not found')} /></PageBody></Page>

  const initialValues: StoreFormValues = {
    name: store.name,
    code: store.code,
    slug: store.slug,
    status: store.status,
    defaultLocale: store.default_locale,
    supportedLocales: store.supported_locales.join(', '),
    defaultCurrencyCode: store.default_currency_code,
    isPrimary: store.is_primary,
  }

  return (
    <Page>
      <PageBody>
        {/* Store edit form */}
        <CrudForm<StoreFormValues>
          title={store.name}
          backHref="/backend/config/ecommerce"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('ecommerce.stores.form.submit', 'Save')}
          cancelHref="/backend/config/ecommerce"
          onSubmit={async (values) => {
            const name = values.name?.trim() ?? ''
            const code = values.code?.trim() ?? ''
            const slug = values.slug?.trim() ?? ''
            if (!name) {
              const msg = t('ecommerce.stores.form.errors.name', 'Store name is required.')
              throw createCrudFormError(msg, { name: msg })
            }
            if (!code) {
              const msg = t('ecommerce.stores.form.errors.code', 'Store code is required.')
              throw createCrudFormError(msg, { code: msg })
            }
            if (!slug) {
              const msg = t('ecommerce.stores.form.errors.slug', 'Store slug is required.')
              throw createCrudFormError(msg, { slug: msg })
            }
            const supportedLocales = (values.supportedLocales ?? '')
              .split(',')
              .map((l) => l.trim())
              .filter(Boolean)
            await updateCrud('ecommerce/stores', {
              id: store.id,
              name,
              code,
              slug,
              status: values.status,
              defaultLocale: values.defaultLocale?.trim() || store.default_locale,
              supportedLocales: supportedLocales.length ? supportedLocales : store.supported_locales,
              defaultCurrencyCode: (values.defaultCurrencyCode?.trim() || store.default_currency_code).toUpperCase(),
              isPrimary: values.isPrimary ?? store.is_primary,
            })
            flash(t('ecommerce.stores.detail.updateSuccess', 'Store updated'), 'success')
            setReloadToken((n) => n + 1)
          }}
        />

        {/* ── Domains ──────────────────────────────────────────────── */}
        <div className="mt-10 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('ecommerce.store_domains.title', 'Domains')}</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddDomain((v) => !v)}
            >
              {showAddDomain
                ? t('ecommerce.stores.form.cancel', 'Cancel')
                : t('ecommerce.store_domains.create', 'Add Domain')}
            </Button>
          </div>

          {showAddDomain && (
            <AddDomainForm
              storeId={store.id}
              onAdded={() => { setShowAddDomain(false); loadDomains() }}
              onCancel={() => setShowAddDomain(false)}
            />
          )}

          {domainsLoading ? (
            <LoadingMessage label={t('ecommerce.stores.loading', 'Loading...')} />
          ) : domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ecommerce.store_domains.empty', 'No domains configured')}</p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">{t('ecommerce.store_domains.fields.host', 'Hostname')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('ecommerce.store_domains.fields.tlsMode', 'TLS')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('ecommerce.store_domains.fields.verificationStatus', 'Status')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('ecommerce.store_domains.fields.isPrimary', 'Primary')}</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {domains.map((domain) => (
                    <tr key={domain.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono">{domain.host}</td>
                      <td className="px-4 py-2">{t(`ecommerce.store_domains.tls_mode.${domain.tls_mode}`, domain.tls_mode)}</td>
                      <td className="px-4 py-2">{verificationBadge(domain.verification_status)}</td>
                      <td className="px-4 py-2">
                        {domain.is_primary && <Badge variant="secondary">{t('ecommerce.store_domains.fields.isPrimary', 'Primary')}</Badge>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteDomain(domain)}
                        >
                          {t('ecommerce.stores.list.actions.delete', 'Delete')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Channel Bindings ──────────────────────────────────────── */}
        <div className="mt-10 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('ecommerce.store_channel_bindings.title', 'Channel Bindings')}</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddBinding((v) => !v)}
            >
              {showAddBinding
                ? t('ecommerce.stores.form.cancel', 'Cancel')
                : t('ecommerce.store_channel_bindings.create', 'Add Binding')}
            </Button>
          </div>

          {showAddBinding && (
            <AddBindingForm
              storeId={store.id}
              onAdded={() => { setShowAddBinding(false); loadBindings() }}
              onCancel={() => setShowAddBinding(false)}
            />
          )}

          {bindingsLoading ? (
            <LoadingMessage label={t('ecommerce.stores.loading', 'Loading...')} />
          ) : bindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ecommerce.store_channel_bindings.empty', 'No channel bindings configured')}</p>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">{t('ecommerce.store_channel_bindings.fields.salesChannelId', 'Sales Channel')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('ecommerce.store_channel_bindings.fields.priceKindId', 'Price Kind')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('ecommerce.store_channel_bindings.fields.isDefault', 'Default')}</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bindings.map((binding) => (
                    <tr key={binding.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-xs">{binding.sales_channel_id}</td>
                      <td className="px-4 py-2 font-mono text-xs">{binding.price_kind_id ?? '—'}</td>
                      <td className="px-4 py-2">
                        {binding.is_default && <Badge variant="secondary">{t('ecommerce.store_channel_bindings.fields.isDefault', 'Default')}</Badge>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteBinding(binding)}
                        >
                          {t('ecommerce.stores.list.actions.delete', 'Delete')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
