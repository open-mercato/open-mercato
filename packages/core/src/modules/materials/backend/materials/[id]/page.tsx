'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Badge } from '@open-mercato/ui/primitives/badge'

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

export default function MaterialDetailPage() {
  const t = useT()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [material, setMaterial] = React.useState<MaterialDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

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
  }, [id, t])

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

  if (loading) return <LoadingMessage>{t('materials.detail.loading', 'Loading material…')}</LoadingMessage>
  if (error || !material) return <ErrorMessage>{error ?? t('materials.detail.error.unknown', 'Unknown error')}</ErrorMessage>

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
              <TabsTrigger value="sales" disabled>
                {t('materials.detail.tab.sales', 'Sales')}
              </TabsTrigger>
              <TabsTrigger value="units" disabled>
                {t('materials.detail.tab.units', 'Units')}
              </TabsTrigger>
              <TabsTrigger value="suppliers" disabled>
                {t('materials.detail.tab.suppliers', 'Suppliers')}
              </TabsTrigger>
              <TabsTrigger value="prices" disabled>
                {t('materials.detail.tab.prices', 'Prices')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview">
              <CrudForm<MaterialFormValues>
                title={t('materials.detail.section.overview', 'Overview')}
                groups={formGroups}
                initialValues={initialValues}
                submitLabel={t('materials.detail.save', 'Save changes')}
                showDelete
                deleteLabel={t('materials.detail.delete', 'Delete material')}
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
                    confirmLabel: t('materials.detail.delete.confirm', 'Delete'),
                    cancelLabel: t('materials.detail.delete.cancel', 'Cancel'),
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
              <p className="p-4 text-sm text-muted-foreground">
                {t(
                  'materials.detail.tab.sales.placeholder',
                  'Sales profile editor lands in Step 5 — toggle "Listed for sales" here will create/delete a MaterialSalesProfile and mirror is_sellable on the master.',
                )}
              </p>
            </TabsContent>
            <TabsContent value="units">
              <p className="p-4 text-sm text-muted-foreground">
                {t('materials.detail.tab.units.placeholder', 'Units management lands in Step 6.')}
              </p>
            </TabsContent>
            <TabsContent value="suppliers">
              <p className="p-4 text-sm text-muted-foreground">
                {t('materials.detail.tab.suppliers.placeholder', 'Supplier links land in Step 7.')}
              </p>
            </TabsContent>
            <TabsContent value="prices">
              <p className="p-4 text-sm text-muted-foreground">
                {t('materials.detail.tab.prices.placeholder', 'Prices land in Step 8 (FX subscriber Step 9, expiration worker Step 11).')}
              </p>
            </TabsContent>
          </Tabs>
        </div>
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
