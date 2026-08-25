"use client"

import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, PackageCheck } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import {
  ErrorMessage,
  LoadingMessage,
  RecordNotFoundState,
} from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { flashMutationError } from '../../lib/flashMutationError'
import {
  applyAsnCompleteLockTokenFromConflict,
  applyAsnReceiveLockTokenFromSuccess,
  resolveAsnReceiveLockToken,
} from './asnCompleteOptimisticLock'
import {
  loadAllAsnReceivingLines,
  type AsnReceivingLineRow,
} from './asnReceivingLinesLoader'
import {
  asnStatusVariant,
  lineHasDiscrepancy,
  qcStatusVariant,
  resolveAsnCompleteGate,
} from './inboundStatusUi'
import { ReceiveAsnLineDialog, type ReceiveAsnLineTarget } from './ReceiveAsnLineDialog'
import { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'
import {
  resolveCatalogVariantLabel,
  resolveLocationLabel,
  resolveWarehouseLabel,
} from './inventoryMutationLoaders'

const asnIdSchema = z.string().uuid()

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

type AsnRow = {
  id: string
  warehouse_id?: string | null
  vendor_id?: string | null
  status?: string | null
  expected_at?: string | null
  reference_number?: string | null
  notes?: string | null
  updated_at?: string | null
}

type ReceivingLineRow = AsnReceivingLineRow

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export default function WmsAsnDetailPage({ asnId }: { asnId: string }) {
  const t = useT()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const access = useWmsInventoryMutationAccess()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'wms-asn-complete',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  const parsedId = asnIdSchema.safeParse(asnId)
  const [receiveOpen, setReceiveOpen] = React.useState(false)
  const [activeLine, setActiveLine] = React.useState<ReceiveAsnLineTarget | null>(null)
  const [closeWhenShort, setCloseWhenShort] = React.useState(false)
  const [labelCache, setLabelCache] = React.useState<Record<string, string>>({})
  const asnCompleteLockRef = React.useRef<string | null>(null)
  // Fresh ASN If-Match across receives — query refetch is async after onSuccess.
  const asnReceiveLockRef = React.useRef<string | null>(null)

  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    [locale],
  )

  const asnQuery = useQuery({
    queryKey: ['wms-asn-detail', asnId, 'header'],
    enabled: parsedId.success,
    queryFn: async () => {
      const call = await apiCall<PagedResponse<AsnRow>>(
        `/api/wms/asns?ids=${encodeURIComponent(asnId)}&page=1&pageSize=1`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.asns.detail.errors.load', 'Failed to load ASN.'))
      }
      return call.result?.items?.[0] ?? null
    },
  })

  const linesQuery = useQuery({
    queryKey: ['wms-asn-detail', asnId, 'lines'],
    enabled: parsedId.success,
    queryFn: async () => {
      // Load-all for detail console: QC alerts, receive actions, and Complete ASN
      // must see every line — never truncate at the first page.
      const loaded = await loadAllAsnReceivingLines(asnId)
      if (loaded.ok) {
        return loaded.items
      }
      await raiseCrudError(
        loaded.response,
        t('wms.backend.asns.detail.errors.loadLines', 'Failed to load receiving lines.'),
      )
    },
  })

  const asn = asnQuery.data
  const lines = linesQuery.data ?? []

  React.useEffect(() => {
    if (typeof asn?.updated_at !== 'string' || !asn.updated_at.trim()) return
    const fromQuery = asn.updated_at.trim()
    // Prefer newer ISO tokens so a lagging refetch cannot demote a success token.
    if (!asnReceiveLockRef.current || fromQuery > asnReceiveLockRef.current) {
      asnReceiveLockRef.current = fromQuery
    }
  }, [asn?.updated_at])

  React.useEffect(() => {
    const ids = new Set<string>()
    if (asn?.warehouse_id) ids.add(asn.warehouse_id)
    for (const line of lines) {
      if (line.catalog_variant_id) ids.add(line.catalog_variant_id)
      if (line.target_staging_location_id) ids.add(line.target_staging_location_id)
    }
    const missing = [...ids].filter((id) => !labelCache[id])
    if (missing.length === 0) return
    let cancelled = false
    void Promise.all(
      missing.map(async (id) => {
        const [warehouse, variant, location] = await Promise.all([
          resolveWarehouseLabel(id),
          resolveCatalogVariantLabel(id),
          resolveLocationLabel(id),
        ])
        return [id, warehouse || variant || location] as const
      }),
    ).then((entries) => {
      if (cancelled) return
      setLabelCache((prev) => {
        const next = { ...prev }
        for (const [id, label] of entries) {
          if (label) next[id] = label
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [asn?.warehouse_id, labelCache, lines])

  const discrepancyLines = lines.filter((line) =>
    lineHasDiscrepancy(line.expected_qty, line.received_qty),
  )
  const failedLines = lines.filter((line) => line.qc_status === 'failed')
  const canReceiveMore = asn?.status === 'draft' || asn?.status === 'in_transit'
  const completeGate = resolveAsnCompleteGate({
    canManageAsn: access.canManageAsn,
    asnStatus: asn?.status,
    lines,
    closeWhenShort,
  })
  const { canShowComplete, canSubmitComplete, showCloseWhenShort } = completeGate

  const openReceive = React.useCallback((line: ReceivingLineRow) => {
    setActiveLine({
      lineId: line.id,
      catalogVariantId: line.catalog_variant_id ?? '',
      expectedQty: toNumber(line.expected_qty),
      receivedQty: toNumber(line.received_qty),
      lotNumber: line.lot_number,
      targetStagingLocationId: line.target_staging_location_id,
      variantLabel: line.catalog_variant_id
        ? labelCache[line.catalog_variant_id] ?? line.catalog_variant_id
        : null,
      updatedAt: line.updated_at ?? null,
      asnUpdatedAt: resolveAsnReceiveLockToken(asnReceiveLockRef, asn?.updated_at),
    })
    setReceiveOpen(true)
  }, [asn?.updated_at, labelCache])

  const applyAsnCompleteLockFromConflict = React.useCallback(
    (status: number, body: unknown) => {
      const refreshed = applyAsnCompleteLockTokenFromConflict(asnCompleteLockRef, {
        status,
        body,
      })
      if (!refreshed) return
      queryClient.setQueryData<AsnRow | null>(
        ['wms-asn-detail', asnId, 'header'],
        (previous) => (previous ? { ...previous, updated_at: refreshed } : previous),
      )
    },
    [asnId, queryClient],
  )

  const handleComplete = React.useCallback(async () => {
    if (!asn || !access.organizationId || !access.tenantId || !canSubmitComplete) return
    const confirmed = await confirm({
      title: t('wms.backend.asns.complete.confirm.title', 'Complete ASN?'),
      description: closeWhenShort
        ? t(
            'wms.backend.asns.complete.confirm.descriptionShort',
            'Close this ASN even if some lines are short of expected quantity.',
          )
        : t(
            'wms.backend.asns.complete.confirm.description',
            'Mark this ASN as received when receiving is finished.',
          ),
      confirmText: t('wms.backend.asns.complete.confirm.submit', 'Complete ASN'),
      cancelText: t('wms.backend.asns.complete.confirm.cancel', 'Cancel'),
    })
    if (!confirmed) return

    // Seed once per user action (outside operation) so guarded retry keeps the
    // refreshed token after a 409 instead of re-binding the original row version.
    if (typeof asn.updated_at === 'string' && asn.updated_at.trim()) {
      asnCompleteLockRef.current = asn.updated_at.trim()
    } else {
      asnCompleteLockRef.current = asn.updated_at ?? null
    }

    const payload = {
      organizationId: access.organizationId,
      tenantId: access.tenantId,
      closeWhenShort,
    }
    try {
      let conflictHandled = false
      await runMutation({
        operation: async () => {
          const call = await apiCall<{ ok?: boolean; status?: string }>(
            `/api/wms/asns/${encodeURIComponent(asn.id)}/complete`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...buildOptimisticLockHeader(asnCompleteLockRef.current ?? undefined),
              },
              body: JSON.stringify(payload),
            },
          )
          if (!call.ok) {
            const refreshLockFromConflict = () => {
              applyAsnCompleteLockFromConflict(call.status, call.result)
              void queryClient.invalidateQueries({ queryKey: ['wms-asn-detail', asnId] })
              void queryClient.invalidateQueries({ queryKey: ['wms-asns-list'] })
            }
            if (
              surfaceRecordConflict({ status: call.status, body: call.result }, t, {
                onRefresh: refreshLockFromConflict,
              })
            ) {
              refreshLockFromConflict()
              conflictHandled = true
              return {}
            }
            await raiseCrudError(
              call.response,
              t('wms.backend.asns.complete.errors.submit', 'Failed to complete ASN.'),
            )
          }
          return call.result ?? {}
        },
        context: mutationContext,
        mutationPayload: payload,
      })
      if (conflictHandled) return
      flash(t('wms.backend.asns.complete.flash.success', 'ASN completed'), 'success')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['wms-asn-detail', asnId] }),
        queryClient.invalidateQueries({ queryKey: ['wms-asns-list'] }),
      ])
    } catch (error) {
      flashMutationError(
        error,
        t('wms.backend.asns.complete.errors.submit', 'Failed to complete ASN.'),
        t,
      )
    }
  }, [
    access.organizationId,
    access.tenantId,
    applyAsnCompleteLockFromConflict,
    asn,
    asnId,
    canSubmitComplete,
    closeWhenShort,
    confirm,
    mutationContext,
    queryClient,
    runMutation,
    t,
  ])

  const columns = React.useMemo<ColumnDef<ReceivingLineRow>[]>(
    () => [
      {
        id: 'variant',
        header: t('wms.backend.asns.detail.columns.variant', 'Variant'),
        cell: ({ row }) => {
          const id = row.original.catalog_variant_id
          if (!id) return '—'
          return labelCache[id] || id.slice(0, 8)
        },
      },
      {
        id: 'expected',
        header: t('wms.backend.asns.detail.columns.expected', 'Expected'),
        cell: ({ row }) => toNumber(row.original.expected_qty),
      },
      {
        id: 'received',
        header: t('wms.backend.asns.detail.columns.received', 'Received'),
        cell: ({ row }) => {
          const expected = toNumber(row.original.expected_qty)
          const received = toNumber(row.original.received_qty)
          const discrepant = lineHasDiscrepancy(expected, received)
          return (
            <span className={discrepant ? 'font-medium text-status-warning-text' : undefined}>
              {received}
            </span>
          )
        },
      },
      {
        id: 'qc',
        header: t('wms.backend.asns.detail.columns.qc', 'QC'),
        cell: ({ row }) => {
          const status = row.original.qc_status?.trim()
          if (!status) return '—'
          return (
            <StatusBadge variant={qcStatusVariant(status)} dot>
              {t(`wms.backend.asns.qc.${status}`, status)}
            </StatusBadge>
          )
        },
      },
      {
        id: 'staging',
        header: t('wms.backend.asns.detail.columns.staging', 'Staging'),
        cell: ({ row }) => {
          const id = row.original.target_staging_location_id
          if (!id) return '—'
          return labelCache[id] || id.slice(0, 8)
        },
      },
    ],
    [labelCache, t],
  )

  const rowActions = React.useCallback(
    (row: ReceivingLineRow) => {
      if (!access.canReceive || !canReceiveMore) return null
      return (
        <RowActions
          items={[
            {
              id: 'receive',
              label: t('wms.backend.asns.detail.actions.receive', 'Receive line'),
              onSelect: () => openReceive(row),
            },
          ]}
        />
      )
    },
    [access.canReceive, canReceiveMore, openReceive, t],
  )

  if (!parsedId.success) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('wms.backend.asns.detail.notFound', 'ASN not found.')}
            backHref="/backend/wms/asns"
            backLabel={t('wms.backend.asns.detail.back', 'Back to ASNs')}
          />
        </PageBody>
      </Page>
    )
  }

  if (asnQuery.isLoading || linesQuery.isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('wms.backend.asns.detail.loading', 'Loading ASN…')} />
        </PageBody>
      </Page>
    )
  }

  if (asnQuery.isError || linesQuery.isError) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={t('wms.backend.asns.detail.errors.load', 'Failed to load ASN.')} />
        </PageBody>
      </Page>
    )
  }

  if (!asn) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('wms.backend.asns.detail.notFound', 'ASN not found.')}
            backHref="/backend/wms/asns"
            backLabel={t('wms.backend.asns.detail.back', 'Back to ASNs')}
          />
        </PageBody>
      </Page>
    )
  }

  const title =
    asn.reference_number?.trim() ||
    t('wms.backend.asns.detail.untitled', 'ASN {id}', { id: asn.id.slice(0, 8) })

  return (
    <Page>
      <PageBody className="space-y-6">
        <PageHeader
          title={title}
          description={t(
            'wms.backend.asns.detail.description',
            'Primary receiving console for ASN lines, QC, and discrepancies.',
          )}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/backend/wms/asns">
                  <ArrowLeft className="size-4" />
                  {t('wms.backend.asns.detail.back', 'Back to ASNs')}
                </Link>
              </Button>
              {access.canManagePutaway ? (
                <Button type="button" variant="outline" asChild>
                  <Link href="/backend/wms/putaway">
                    {t('wms.backend.asns.actions.putawayQueue', 'Putaway queue')}
                  </Link>
                </Button>
              ) : null}
              {canShowComplete ? (
                <Button
                  type="button"
                  onClick={() => void handleComplete()}
                  disabled={!canSubmitComplete}
                  data-testid="asn-complete"
                >
                  <CheckCircle2 className="size-4" />
                  {t('wms.backend.asns.detail.actions.complete', 'Complete ASN')}
                </Button>
              ) : null}
            </div>
          }
        />

        <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge variant={asnStatusVariant(asn.status)} dot>
                  {t(`wms.backend.asns.status.${asn.status ?? 'draft'}`, asn.status ?? 'draft')}
                </StatusBadge>
                <span className="text-sm text-muted-foreground">
                  {asn.warehouse_id
                    ? labelCache[asn.warehouse_id] || asn.warehouse_id.slice(0, 8)
                    : '—'}
                </span>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">
                    {t('wms.backend.asns.columns.expectedAt', 'Expected')}
                  </dt>
                  <dd>
                    {asn.expected_at && !Number.isNaN(new Date(asn.expected_at).getTime())
                      ? dateFormatter.format(new Date(asn.expected_at))
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t('wms.backend.asns.columns.reference', 'Reference')}
                  </dt>
                  <dd>{asn.reference_number?.trim() || '—'}</dd>
                </div>
              </dl>
              {asn.notes?.trim() ? (
                <p className="text-sm text-muted-foreground">{asn.notes}</p>
              ) : null}
            </div>
            {showCloseWhenShort ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={closeWhenShort}
                  onCheckedChange={(checked) => setCloseWhenShort(checked === true)}
                  data-testid="asn-close-when-short"
                />
                {t('wms.backend.asns.complete.closeWhenShort', 'Allow close when short')}
              </label>
            ) : null}
          </div>
        </section>

        {failedLines.length > 0 ? (
          <Alert status="error" style="light">
            <AlertTitle>{t('wms.backend.asns.detail.qcFailed.title', 'QC failed lines')}</AlertTitle>
            <AlertDescription>
              {t(
                'wms.backend.asns.detail.qcFailed.description',
                '{count} line(s) failed QC and did not increase available stock.',
                { count: failedLines.length },
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {discrepancyLines.length > 0 ? (
          <Alert status="warning" style="light">
            <AlertTitle>
              {t('wms.backend.asns.detail.discrepancy.title', 'Quantity discrepancies')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'wms.backend.asns.detail.discrepancy.description',
                '{count} line(s) have received quantity different from expected.',
                { count: discrepancyLines.length },
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-md border bg-muted/40 p-2 text-muted-foreground">
              <PackageCheck className="size-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">
                {t('wms.backend.asns.detail.linesTitle', 'Receiving lines')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  'wms.backend.asns.detail.linesDescription',
                  'Receive against expected quantities with QC pass or fail.',
                )}
              </p>
            </div>
          </div>
          <DataTable
            embedded
            title={t('wms.backend.asns.detail.linesTitle', 'Receiving lines')}
            columns={columns}
            data={lines}
            rowActions={rowActions}
            emptyState={
              <EmptyState
                title={t('wms.backend.asns.detail.emptyLines.title', 'No receiving lines')}
                description={t(
                  'wms.backend.asns.detail.emptyLines.description',
                  'This ASN has no expected lines yet.',
                )}
              />
            }
          />
        </section>
      </PageBody>

      {access.canReceive ? (
        <ReceiveAsnLineDialog
          open={receiveOpen}
          onOpenChange={setReceiveOpen}
          access={access}
          asnId={asn.id}
          warehouseId={asn.warehouse_id ?? ''}
          line={activeLine}
          onSuccess={(result) => {
            const refreshed = applyAsnReceiveLockTokenFromSuccess(
              asnReceiveLockRef,
              result?.asnUpdatedAt,
            )
            if (refreshed) {
              queryClient.setQueryData<AsnRow | null>(
                ['wms-asn-detail', asnId, 'header'],
                (previous) => (previous ? { ...previous, updated_at: refreshed } : previous),
              )
            }
            if (result && activeLine) {
              setActiveLine({
                ...activeLine,
                receivedQty: result.receivedQty,
                asnUpdatedAt: refreshed ?? result.asnUpdatedAt ?? activeLine.asnUpdatedAt,
              })
            }
            void linesQuery.refetch()
            void asnQuery.refetch()
          }}
        />
      ) : null}
      {ConfirmDialogElement}
    </Page>
  )
}
