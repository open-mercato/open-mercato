'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { UnitsTab } from './UnitsTab'
import { SuppliersTab } from './SuppliersTab'
import { PricesTab } from './PricesTab'

const KIND_VALUES = ['raw', 'semi', 'final', 'tool', 'indirect'] as const
const LIFECYCLE_VALUES = ['draft', 'active', 'phase_out', 'obsolete'] as const

type MaterialDetail = {
  id: string
  code: string
  name: string
  description: string | null
  kind: (typeof KIND_VALUES)[number]
  lifecycle_state: (typeof LIFECYCLE_VALUES)[number]
  replacement_material_id: string | null
  base_unit_id: string | null
  is_purchasable: boolean
  is_sellable: boolean
  is_stockable: boolean
  is_producible: boolean
  is_active: boolean
  organization_id: string
  tenant_id: string
  created_at: string
  updated_at: string
}

type MaterialFormValues = {
  code: string
  name: string
  description?: string
  kind: (typeof KIND_VALUES)[number]
  lifecycleState: (typeof LIFECYCLE_VALUES)[number]
  isPurchasable?: boolean
  isStockable?: boolean
  isProducible?: boolean
  isActive?: boolean
}

type SalesProfile = {
  id: string
  material_id: string
  organization_id: string
  tenant_id: string
  gtin: string | null
  commodity_code: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type SalesProfileFormValues = {
  gtin?: string
  commodityCode?: string
}

export default function MaterialDetailPage() {
  const t = useT()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [material, setMaterial] = React.useState<MaterialDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Sales profile state (independent reload — toggling listed-for-sales mutates Material.is_sellable
  // via subscriber, so we reload Material as well after every toggle to keep the header badge fresh).
  const [salesProfile, setSalesProfile] = React.useState<SalesProfile | null>(null)
  const [salesProfileLoading, setSalesProfileLoading] = React.useState(true)
  const [salesProfileSaving, setSalesProfileSaving] = React.useState(false)
  const [salesReloadToken, setSalesReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      try {
        setLoading(true)
        const response = await apiCall<{ items: MaterialDetail[] }>(
          `/api/materials?ids=${encodeURIComponent(id)}`,
        )
        if (cancelled) return
        if (response.ok && response.result?.items?.length) {
          setMaterial(response.result.items[0])
          setError(null)
        } else {
          setError(t('materials.detail.error.notFound', 'Material not found'))
        }
      } catch {
        if (!cancelled) setError(t('materials.detail.error.load', 'Failed to load material'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, t, salesReloadToken])

  // Sales profile lifecycle is independent of the master form. Reloads on toggle so the
  // Switch state always reflects server-side truth (and Material.is_sellable badge re-syncs
  // via the parallel material reload above).
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      try {
        setSalesProfileLoading(true)
        const response = await apiCall<{ profile: SalesProfile | null; exists: boolean }>(
          `/api/materials/${encodeURIComponent(id)}/sales-profile`,
        )
        if (cancelled) return
        if (response.ok && response.result) {
          setSalesProfile(response.result.profile)
        } else {
          setSalesProfile(null)
        }
      } catch {
        if (!cancelled) setSalesProfile(null)
      } finally {
        if (!cancelled) setSalesProfileLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id, salesReloadToken])

  const upsertSalesProfile = React.useCallback(
    async (values: SalesProfileFormValues) => {
      if (!id) return
      setSalesProfileSaving(true)
      try {
        await apiCallOrThrow(`/api/materials/${encodeURIComponent(id)}/sales-profile`, {
          method: 'PUT',
          body: JSON.stringify({
            gtin: values.gtin?.trim() ? values.gtin.trim() : null,
            commodityCode: values.commodityCode?.trim() ? values.commodityCode.trim() : null,
          }),
          headers: { 'content-type': 'application/json' },
        })
        flash(t('materials.detail.sales.save.success', 'Sales profile saved'), 'success')
        setSalesReloadToken((x) => x + 1)
      } catch {
        flash(t('materials.detail.sales.save.error', 'Failed to save sales profile'), 'error')
      } finally {
        setSalesProfileSaving(false)
      }
    },
    [id, t],
  )

  const removeSalesProfile = React.useCallback(async () => {
    if (!id) return
    const confirmed = await confirmDialog({
      title: t('materials.detail.sales.remove.title', 'Stop selling this material?'),
      description: t(
        'materials.detail.sales.remove.description',
        'The sales profile (GTIN, commodity code) will be soft-deleted and the material will no longer be marked as sellable. You can re-enable it any time.',
      ),
      confirmText: t('materials.detail.sales.remove.confirm', 'Stop selling'),
      cancelText: t('materials.detail.sales.remove.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    setSalesProfileSaving(true)
    try {
      await apiCallOrThrow(`/api/materials/${encodeURIComponent(id)}/sales-profile`, {
        method: 'DELETE',
      })
      flash(t('materials.detail.sales.remove.success', 'Material is no longer listed for sales'), 'success')
      setSalesReloadToken((x) => x + 1)
    } catch {
      flash(t('materials.detail.sales.remove.error', 'Failed to remove sales profile'), 'error')
    } finally {
      setSalesProfileSaving(false)
    }
  }, [confirmDialog, id, t])

  const enableSalesProfile = React.useCallback(async () => {
    // Toggling on with no GTIN/commodity_code is allowed — creates an empty profile row.
    // The user can fill in fields afterwards via the form.
    await upsertSalesProfile({})
  }, [upsertSalesProfile])

  const salesFormGroups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'identifiers',
        column: 1,
        title: t('materials.detail.sales.section.identifiers', 'External identifiers'),
        description: t(
          'materials.detail.sales.section.identifiersHelp',
          'Optional. GTIN must be 8/12/13/14 digits (GS1 standards). CN/HS code must be 2–10 digits. Validation against PL providers will be added later.',
        ),
        fields: [
          {
            id: 'gtin',
            type: 'text',
            label: t('materials.detail.sales.field.gtin', 'GTIN / EAN'),
            placeholder: '5901234567890',
            maxLength: 20,
          },
          {
            id: 'commodityCode',
            type: 'text',
            label: t('materials.detail.sales.field.commodityCode', 'Commodity code (CN/HS)'),
            placeholder: '6109100090',
            maxLength: 20,
          },
        ],
      },
    ],
    [t],
  )

  const salesInitialValues = React.useMemo<SalesProfileFormValues>(
    () => ({
      gtin: salesProfile?.gtin ?? '',
      commodityCode: salesProfile?.commodity_code ?? '',
    }),
    [salesProfile],
  )

  const formGroups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'identity',
        column: 1,
        title: t('materials.form.group.identity', 'Identity'),
        fields: [
          { id: 'code', type: 'text', label: t('materials.form.field.code', 'Code'), required: true, maxLength: 64 },
          { id: 'name', type: 'text', label: t('materials.form.field.name', 'Name'), required: true, maxLength: 255 },
          { id: 'description', type: 'textarea', label: t('materials.form.field.description', 'Description'), rows: 3 },
        ],
      },
      {
        id: 'classification',
        column: 1,
        title: t('materials.form.group.classification', 'Classification'),
        fields: [
          {
            id: 'kind',
            type: 'select',
            label: t('materials.form.field.kind', 'Kind'),
            required: true,
            options: KIND_VALUES.map((k) => ({ value: k, label: t(`materials.kind.${k}`, k) })),
          },
          {
            id: 'lifecycleState',
            type: 'select',
            label: t('materials.form.field.lifecycle', 'Lifecycle state'),
            options: LIFECYCLE_VALUES.map((s) => ({ value: s, label: t(`materials.lifecycle.${s}`, s) })),
            helpText: t(
              'materials.form.field.lifecycle.help',
              'Step 10 will introduce a guarded lifecycle endpoint with audit log. Until then, transitions are unrestricted from this form.',
            ),
          },
        ],
      },
      {
        id: 'capabilities',
        column: 2,
        title: t('materials.form.group.capabilities', 'Capabilities'),
        description: t(
          'materials.form.group.capabilities.help.detail',
          'is_sellable is materialized from the Sales tab — toggle it there, not here.',
        ),
        fields: [
          { id: 'isPurchasable', type: 'checkbox', label: t('materials.form.field.isPurchasable', 'Purchasable') },
          { id: 'isStockable', type: 'checkbox', label: t('materials.form.field.isStockable', 'Stockable') },
          { id: 'isProducible', type: 'checkbox', label: t('materials.form.field.isProducible', 'Producible') },
          { id: 'isActive', type: 'checkbox', label: t('materials.form.field.isActive', 'Active') },
        ],
      },
    ],
    [t],
  )

  const initialValues = React.useMemo<MaterialFormValues | undefined>(() => {
    if (!material) return undefined
    return {
      code: material.code,
      name: material.name,
      description: material.description ?? undefined,
      kind: material.kind,
      lifecycleState: material.lifecycle_state,
      isPurchasable: material.is_purchasable,
      isStockable: material.is_stockable,
      isProducible: material.is_producible,
      isActive: material.is_active,
    }
  }, [material])

  if (loading) return <LoadingMessage label={t('materials.detail.loading', 'Loading material…')} />
  if (error || !material) return <ErrorMessage label={error ?? t('materials.detail.error.unknown', 'Unknown error')} />

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{material.name}</h1>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{material.code}</code>
                <Badge variant="outline">{t(`materials.kind.${material.kind}`, material.kind)}</Badge>
                <Badge variant="secondary">
                  {t(`materials.lifecycle.${material.lifecycle_state}`, material.lifecycle_state)}
                </Badge>
                {material.is_sellable ? (
                  <Badge>{t('materials.detail.flag.sellable', 'Listed for sales')}</Badge>
                ) : null}
              </div>
            </div>
          </header>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList>
              <TabsTrigger value="overview">{t('materials.detail.tab.overview', 'Overview')}</TabsTrigger>
              <TabsTrigger value="sales">{t('materials.detail.tab.sales', 'Sales')}</TabsTrigger>
              <TabsTrigger value="units">{t('materials.detail.tab.units', 'Units')}</TabsTrigger>
              <TabsTrigger value="suppliers">{t('materials.detail.tab.suppliers', 'Suppliers')}</TabsTrigger>
              <TabsTrigger value="prices">{t('materials.detail.tab.prices', 'Prices')}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <CrudForm<MaterialFormValues>
                title={t('materials.detail.section.overview', 'Overview')}
                fields={[]}
                groups={formGroups}
                initialValues={initialValues}
                submitLabel={t('materials.detail.save', 'Save changes')}
                deleteVisible
                onSubmit={async (values) => {
                  const payload: Record<string, unknown> = {
                    id: material.id,
                    code: values.code,
                    name: values.name,
                    description: values.description ?? null,
                    kind: values.kind,
                    lifecycleState: values.lifecycleState,
                    isPurchasable: !!values.isPurchasable,
                    isStockable: !!values.isStockable,
                    isProducible: !!values.isProducible,
                    isActive: !!values.isActive,
                    organizationId: material.organization_id,
                    tenantId: material.tenant_id,
                  }
                  await updateCrud('materials', payload)
                  flash(t('materials.detail.save.success', 'Material updated'), 'success')
                  router.refresh()
                }}
                onDelete={async () => {
                  const confirmed = await confirmDialog({
                    title: t('materials.detail.delete.title', 'Delete material?'),
                    description: t(
                      'materials.detail.delete.description',
                      'Material "{{code}}" will be soft-deleted. You can undo via the audit log.',
                    ).replace('{{code}}', material.code),
                    confirmText: t('materials.detail.delete.confirm', 'Delete'),
                    cancelText: t('materials.detail.delete.cancel', 'Cancel'),
                    variant: 'destructive',
                  })
                  if (!confirmed) return
                  await deleteCrud('materials', material.id)
                  flash(t('materials.detail.delete.success', 'Material deleted'), 'success')
                  router.push('/backend/materials')
                }}
              />
            </TabsContent>

            <TabsContent value="sales">
              <div className="flex flex-col gap-4 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold">
                      {t('materials.detail.sales.title', 'Listed for sales')}
                    </h2>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                      {t(
                        'materials.detail.sales.description',
                        'Toggle on to mark this material as sellable. Creates a sales profile holding the GTIN and commodity (CN/HS) code. Material.is_sellable mirrors this state.',
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {salesProfileLoading || salesProfileSaving ? <Spinner size="sm" /> : null}
                    <Switch
                      checked={!!salesProfile}
                      disabled={salesProfileLoading || salesProfileSaving}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          void enableSalesProfile()
                        } else {
                          void removeSalesProfile()
                        }
                      }}
                      aria-label={t('materials.detail.sales.toggle', 'Listed for sales')}
                    />
                  </div>
                </div>

                {salesProfile ? (
                  <CrudForm<SalesProfileFormValues>
                    title={t('materials.detail.sales.form.title', 'Sales identifiers')}
                    fields={[]}
                    groups={salesFormGroups}
                    initialValues={salesInitialValues}
                    submitLabel={t('materials.detail.sales.form.save', 'Save sales identifiers')}
                    onSubmit={async (values) => {
                      await upsertSalesProfile(values)
                    }}
                  />
                ) : (
                  <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                    {t(
                      'materials.detail.sales.empty',
                      'No sales profile yet. Toggle "Listed for sales" above to create one and unlock GTIN / CN-HS code editing.',
                    )}
                  </p>
                )}
              </div>
            </TabsContent>
            <TabsContent value="units">
              <UnitsTab
                materialId={material.id}
                organizationId={material.organization_id}
                tenantId={material.tenant_id}
              />
            </TabsContent>
            <TabsContent value="suppliers">
              <SuppliersTab
                materialId={material.id}
                organizationId={material.organization_id}
                tenantId={material.tenant_id}
              />
            </TabsContent>
            <TabsContent value="prices">
              <PricesTab
                materialId={material.id}
                organizationId={material.organization_id}
                tenantId={material.tenant_id}
              />
            </TabsContent>
          </Tabs>
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
