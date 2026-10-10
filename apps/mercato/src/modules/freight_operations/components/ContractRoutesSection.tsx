"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { deleteCrud, fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { canEditContractRoutes } from '../lib/actionGates'
import { buildContractRouteListParams } from '../lib/listParams'
import { formatFreightAmount, formatFreightDate } from './freightOptions'
import { DRIVER_INCENTIVE_TYPE_FALLBACKS, RATE_BASIS_FALLBACKS } from '../lib/freightEnums'
import { ContractRouteDialog } from './ContractRouteDialog'
import { ImportContractRatesDialog } from './ImportContractRatesDialog'
import type { ContractStatus } from '../data/entities'

const RESOURCE = 'freight_operations/contract-routes'
const ENTITY_ID = 'freight_operations:freight_contract_route'
const SECTION_MUTATION_CONTEXT_ID = 'freight_operations.contract_routes.section'

export type ContractRouteRow = {
  id: string
  contract_id: string
  line_number?: number | null
  origin: string
  destination: string
  rate_basis?: string | null
  rate_amount: string
  minimum_charge?: string | null
  currency_code?: string | null
  vat_rate_override?: string | null
  is_active?: boolean | null
  includes_tolls?: boolean | null
  includes_waiting?: boolean | null
  free_waiting_minutes?: number | null
  waiting_rate_per_hour?: string | null
  vehicle_type_id?: string | null
  equipment_type?: string | null
  driver_incentive_type?: string | null
  driver_incentive_value?: string | null
  effective_from?: string | null
  effective_to?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

export function ContractRoutesSection({
  contractId,
  contractStatus,
  currencyCode,
}: {
  contractId: string
  contractStatus: ContractStatus
  currencyCode: string
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: SECTION_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ContractRouteRow | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)

  const query = useQuery({
    queryKey: ['freight-contract-routes', contractId],
    queryFn: () => fetchCrudList<ContractRouteRow>(RESOURCE, buildContractRouteListParams(contractId)),
  })

  const rows = query.data?.items ?? []
  const total = query.data?.total ?? rows.length
  const editable = canEditContractRoutes(contractStatus)

  const removeRoute = React.useCallback(async (row: ContractRouteRow) => {
    const confirmed = await confirm({
      title: t('freight_operations.contract_routes.actions.delete.confirm', 'Delete this rate line?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt ?? row.updated_at ?? null),
          () => deleteCrud(RESOURCE, row.id),
        ),
        mutationPayload: { operation: 'contract_routes.delete', id: row.id },
        context: { formId: SECTION_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: row.id, retryLastMutation },
      })
      flash(t('freight_operations.contract_routes.actions.delete.success', 'Rate line deleted.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('freight_operations.contract_routes.actions.delete.error', 'Unable to delete the rate line.'),
        'error',
      )
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('freight_operations.contract_routes.section.title', 'Rates and lanes')}
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            {t('freight_operations.contract_routes.section.count', '{count} lines', { count: total })}
          </span>
        </h2>
        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              {t('freight_operations.contract_routes.actions.import', 'Import rates')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditing(null)
                setDialogOpen(true)
              }}
            >
              {t('freight_operations.contract_routes.actions.create', 'Add rate line')}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('freight_operations.contract_routes.section.locked', 'Rates are read-only for this contract status.')}
          </span>
        )}
      </div>

      {query.isLoading ? (
        <LoadingMessage label={t('freight_operations.contract_routes.section.loading', 'Loading rate lines…')} />
      ) : query.isError ? (
        <p className="text-sm text-destructive">{t('freight_operations.contract_routes.section.error', 'Failed to load rate lines.')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('freight_operations.contract_routes.section.empty', 'No rate lines yet — a contract needs at least one active line before it can be activated.')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-muted-foreground">
                <th className="py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.line', '#')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.lane', 'Lane')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.basis', 'Basis')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.rate', 'Rate')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.equipment', 'Equipment')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.effective', 'Effective')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.status', 'Status')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.contract_routes.columns.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-2">{row.line_number ?? '—'}</td>
                  <td className="py-2">{`${row.origin} → ${row.destination}`}</td>
                  <td className="py-2">
                    {t(`freight_operations.contracts.rate_basis.${row.rate_basis ?? 'per_trip'}`, RATE_BASIS_FALLBACKS[row.rate_basis ?? 'per_trip'] ?? '—')}
                  </td>
                  <td className="py-2 font-medium">
                    {formatFreightAmount(row.rate_amount, row.currency_code ?? currencyCode)}
                    {row.minimum_charge ? (
                      <span className="ms-1 text-xs font-normal text-muted-foreground">
                        {t('freight_operations.contract_routes.columns.minimum', 'min {amount}', {
                          amount: formatFreightAmount(row.minimum_charge, row.currency_code ?? currencyCode),
                        })}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <span className="flex min-w-0 flex-col">
                      <span>{row.equipment_type || '—'}</span>
                      {row.driver_incentive_type && row.driver_incentive_type !== 'none' ? (
                        <span className="text-xs text-muted-foreground">
                          {t(`freight_operations.contract_routes.driver_incentive.${row.driver_incentive_type}`, DRIVER_INCENTIVE_TYPE_FALLBACKS[row.driver_incentive_type] ?? row.driver_incentive_type)}
                          {row.driver_incentive_value ? ` ${row.driver_incentive_value}` : ''}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-2">
                    {[formatFreightDate(row.effective_from), formatFreightDate(row.effective_to)].join(' → ')}
                  </td>
                  <td className="py-2">
                    <Badge variant="secondary">
                      {row.is_active === false
                        ? t('freight_operations.contract_routes.status.inactive', 'Inactive')
                        : t('freight_operations.contract_routes.status.active', 'Active')}
                    </Badge>
                  </td>
                  <td className="py-2">
                    {editable ? (
                      <RowActions
                        items={[
                          {
                            id: 'edit',
                            label: t('freight_operations.contract_routes.actions.edit', 'Edit'),
                            onSelect: () => {
                              setEditing(row)
                              setDialogOpen(true)
                            },
                          },
                          {
                            id: 'delete',
                            label: t('freight_operations.contract_routes.actions.delete', 'Delete'),
                            destructive: true,
                            onSelect: () => { void removeRoute(row) },
                          },
                        ]}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > rows.length ? (
            <p className="pt-2 text-xs text-muted-foreground">
              {t('freight_operations.contract_routes.section.truncated', 'Showing the first {shown} of {total} rate lines.', {
                shown: rows.length,
                total,
              })}
            </p>
          ) : null}
        </div>
      )}

      <ImportContractRatesDialog
        contractId={contractId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          setImportOpen(false)
          void query.refetch()
        }}
      />
      <ContractRouteDialog
        contractId={contractId}
        currencyCode={currencyCode}
        item={editing}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
        onSaved={() => {
          setDialogOpen(false)
          setEditing(null)
          flash(t('freight_operations.contract_routes.form.flash.saved', 'Rate line saved.'), 'success')
          void query.refetch()
        }}
      />
      {ConfirmDialogElement}
    </section>
  )
}
