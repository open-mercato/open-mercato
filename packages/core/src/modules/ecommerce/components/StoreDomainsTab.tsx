'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { DomainMappingSummary } from '../lib/domainMappingSummaries'
import { DomainStatusWarning } from './DomainStatusWarning'
import { StoreDomainBindingDialog } from './StoreDomainBindingDialog'
import type { StoreAdminRecord } from './storeAdmin'
import {
  DOMAIN_BINDINGS_API_PATH,
  DOMAIN_BINDINGS_API_URL,
  DOMAIN_BINDINGS_PAGE_SIZE,
  DOMAIN_MAPPINGS_API_URL,
  DOMAIN_SETTINGS_HREF,
  describeDomainFailureReason,
  describeDomainStatus,
  findPreviousPrimary,
  formatBindingAddress,
  type DomainBindingListResponse,
  type DomainBindingRecord,
  type DomainMappingListResponse,
} from './storeDomains'
import { useStoreAccess } from './useStoreAccess'

type StoreDomainsTabProps = {
  store: StoreAdminRecord
  reload: () => Promise<void>
}

type DialogState = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; binding: DomainBindingRecord }

function resolveHostname(binding: DomainBindingRecord): string | null {
  const mapping = binding._domainMapping
  return mapping?.state === 'found' ? mapping.hostname : null
}

export function StoreDomainsTab({ store, reload }: StoreDomainsTabProps) {
  const t = useT()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'ecommerce-store-domains',
  })
  const { canManageDomains } = useStoreAccess()
  const [dialog, setDialog] = React.useState<DialogState>({ mode: 'closed' })

  const bindingsKey = React.useMemo(() => ['ecommerce', 'stores', 'domain-bindings', store.id], [store.id])
  const mappingsKey = React.useMemo(() => ['ecommerce', 'domain-mappings'], [])

  const bindingsQuery = useQuery({
    queryKey: bindingsKey,
    queryFn: async (): Promise<DomainBindingListResponse> => {
      const params = new URLSearchParams({
        storeId: store.id,
        page: '1',
        pageSize: String(DOMAIN_BINDINGS_PAGE_SIZE),
        sortField: 'createdAt',
        sortDir: 'asc',
      })
      const call = await apiCall<DomainBindingListResponse>(`${DOMAIN_BINDINGS_API_URL}?${params.toString()}`, {
        cache: 'no-store',
      })
      if (!call.ok) {
        await raiseCrudError(call.response, t('ecommerce.backend.store.domains.errors.load', 'Failed to load the domain bindings.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const mappingsQuery = useQuery({
    queryKey: mappingsKey,
    queryFn: async (): Promise<DomainMappingListResponse> => {
      const call = await apiCall<DomainMappingListResponse>(DOMAIN_MAPPINGS_API_URL, { cache: 'no-store' })
      if (!call.ok) {
        await raiseCrudError(call.response, t('ecommerce.backend.store.domains.errors.loadMappings', 'Failed to load the available domains.'))
      }
      return call.result ?? { items: [], total: 0 }
    },
  })

  const bindings = React.useMemo(() => bindingsQuery.data?.items ?? [], [bindingsQuery.data])
  const mappings = React.useMemo<DomainMappingSummary[]>(() => mappingsQuery.data?.items ?? [], [mappingsQuery.data])

  const refresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: bindingsKey }),
      queryClient.invalidateQueries({ queryKey: mappingsKey }),
      reload(),
    ])
  }, [bindingsKey, mappingsKey, queryClient, reload])

  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  )

  const describeBinding = React.useCallback(
    (binding: DomainBindingRecord): string => {
      const hostname = resolveHostname(binding) ?? t('ecommerce.backend.store.domains.removedHostname', 'Removed domain')
      return formatBindingAddress(hostname, binding.pathPrefix)
    },
    [t],
  )

  const runBindingMutation = React.useCallback(
    async (binding: DomainBindingRecord, payload: Record<string, unknown>, run: () => Promise<unknown>, failure: string) => {
      try {
        await runMutation({
          operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(binding.updatedAt), run),
          context: { retryLastMutation },
          mutationPayload: payload,
        })
        return true
      } catch (error) {
        if (extractOptimisticLockConflict(error)) return false
        flash(error instanceof Error && error.message ? error.message : failure, 'error')
        return false
      }
    },
    [retryLastMutation, runMutation],
  )

  const handleMakePrimary = React.useCallback(
    async (binding: DomainBindingRecord) => {
      const failure = t('ecommerce.backend.store.domains.errors.makePrimary', 'Failed to make the binding primary.')
      const previous = findPreviousPrimary(bindings, binding.id)
      const payload = { id: binding.id, isPrimary: true }
      const ok = await runBindingMutation(
        binding,
        payload,
        () => updateCrud(DOMAIN_BINDINGS_API_PATH, payload, { errorMessage: failure }),
        failure,
      )
      if (!ok) return
      flash(
        previous
          ? t(
              'ecommerce.backend.store.domains.flash.primaryChanged',
              '{address} is now the primary domain. {previous} is no longer primary.',
              { address: describeBinding(binding), previous: describeBinding(previous) },
            )
          : t('ecommerce.backend.store.domains.flash.primarySet', '{address} is now the primary domain.', {
              address: describeBinding(binding),
            }),
        'success',
      )
      await refresh()
    },
    [bindings, describeBinding, refresh, runBindingMutation, t],
  )

  const handleDelete = React.useCallback(
    async (binding: DomainBindingRecord) => {
      const confirmed = await confirm({
        title: t('ecommerce.backend.store.domains.delete.confirmTitle', 'Remove binding "{address}"?', {
          address: describeBinding(binding),
        }),
        text: binding.isPrimary
          ? t(
              'ecommerce.backend.store.domains.delete.confirmTextPrimary',
              'This is the primary binding. The store stops answering at this address and will have no primary domain until you pick another. The domain itself is not deleted.',
            )
          : t(
              'ecommerce.backend.store.domains.delete.confirmText',
              'The store stops answering at this address. The domain itself is not deleted and can be bound again.',
            ),
        confirmText: t('ecommerce.backend.store.domains.delete.confirmButton', 'Remove binding'),
        variant: 'destructive',
      })
      if (!confirmed) return
      const failure = t('ecommerce.backend.store.domains.errors.delete', 'Failed to remove the domain binding.')
      const ok = await runBindingMutation(
        binding,
        { id: binding.id },
        () => deleteCrud(DOMAIN_BINDINGS_API_PATH, binding.id, { errorMessage: failure }),
        failure,
      )
      if (!ok) return
      flash(t('ecommerce.backend.store.domains.flash.deleted', 'Domain binding removed'), 'success')
      await refresh()
    },
    [confirm, describeBinding, refresh, runBindingMutation, t],
  )

  const columns = React.useMemo<ColumnDef<DomainBindingRecord>[]>(
    () => [
      {
        id: 'domain',
        header: t('ecommerce.backend.store.domains.columns.domain', 'Domain'),
        enableSorting: false,
        cell: ({ row }) => {
          const binding = row.original
          const mapping = binding._domainMapping
          if (mapping?.state === 'found') {
            return (
              <div className="space-y-1">
                <div className="font-medium">{formatBindingAddress(mapping.hostname, binding.pathPrefix)}</div>
                <DomainStatusWarning status={mapping.status} hostname={mapping.hostname} />
              </div>
            )
          }
          if (mapping?.state === 'removed') {
            return (
              <div className="space-y-1">
                <div className="font-medium">
                  {t('ecommerce.backend.store.domains.removed.title', 'Domain removed')}
                  {binding.pathPrefix ? <span className="text-muted-foreground"> {binding.pathPrefix}</span> : null}
                </div>
                <p className="text-xs text-status-error-text">
                  {t(
                    'ecommerce.backend.store.domains.removed.description',
                    'The domain this binding points at was deleted in domain management, so the store no longer answers here. Edit the binding to pick another domain, or remove it.',
                  )}{' '}
                  <Link className="underline" href={DOMAIN_SETTINGS_HREF}>
                    {t('ecommerce.backend.store.domains.manageLink', 'Open domain management')}
                  </Link>
                </p>
              </div>
            )
          }
          return (
            <span className="text-muted-foreground">
              {t('ecommerce.backend.store.domains.unavailable', 'Domain details are unavailable right now.')}
            </span>
          )
        },
      },
      {
        id: 'status',
        header: t('ecommerce.backend.store.domains.columns.status', 'Status'),
        enableSorting: false,
        cell: ({ row }) => {
          const mapping = row.original._domainMapping
          if (mapping?.state === 'found') {
            const described = describeDomainStatus(mapping.status)
            return (
              <StatusBadge variant={described.variant} dot>
                {described.key ? t(described.key, described.fallback) : described.fallback}
              </StatusBadge>
            )
          }
          if (mapping?.state === 'removed') {
            return (
              <StatusBadge variant="error" dot>
                {t('ecommerce.backend.store.domains.status.removed', 'Removed')}
              </StatusBadge>
            )
          }
          return (
            <StatusBadge variant="neutral" dot>
              {t('ecommerce.backend.store.domains.status.unknown', 'Unknown')}
            </StatusBadge>
          )
        },
      },
      {
        id: 'lastDnsCheck',
        header: t('ecommerce.backend.store.domains.columns.lastDnsCheck', 'Last DNS check'),
        enableSorting: false,
        cell: ({ row }) => {
          const mapping = row.original._domainMapping
          const value = mapping?.state === 'found' ? mapping.lastDnsCheckAt : null
          return value ? dateFormatter.format(new Date(value)) : t('ecommerce.backend.store.domains.neverChecked', 'Not checked yet')
        },
      },
      {
        id: 'failureReason',
        header: t('ecommerce.backend.store.domains.columns.failureReason', 'Failure reason'),
        enableSorting: false,
        cell: ({ row }) => {
          const mapping = row.original._domainMapping
          if (mapping?.state !== 'found') return '—'
          const reason = mapping.tlsFailureReason ?? mapping.dnsFailureReason
          if (!reason) return '—'
          const described = describeDomainFailureReason(reason)
          return described ? t(described.key, described.fallback, described.params) : reason
        },
      },
      {
        id: 'primary',
        header: t('ecommerce.backend.store.domains.columns.primary', 'Primary'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.isPrimary ? (
            <StatusBadge variant="success" dot>
              {t('ecommerce.backend.store.domains.primaryBadge', 'Primary')}
            </StatusBadge>
          ) : (
            '—'
          ),
      },
    ],
    [dateFormatter, t],
  )

  const buildRowActions = React.useCallback(
    (binding: DomainBindingRecord): RowActionItem[] => {
      const items: RowActionItem[] = [
        {
          id: 'edit',
          label: t('ecommerce.backend.store.domains.actions.edit', 'Edit'),
          onSelect: () => setDialog({ mode: 'edit', binding }),
        },
      ]
      if (!binding.isPrimary) {
        items.push({
          id: 'make-primary',
          label: t('ecommerce.backend.store.domains.actions.makePrimary', 'Make primary'),
          onSelect: () => {
            void handleMakePrimary(binding)
          },
        })
      }
      items.push({
        id: 'delete',
        label: t('ecommerce.backend.store.domains.actions.delete', 'Remove'),
        destructive: true,
        onSelect: () => {
          void handleDelete(binding)
        },
      })
      return items
    },
    [handleDelete, handleMakePrimary, t],
  )

  const addAction = canManageDomains ? (
    <Button type="button" onClick={() => setDialog({ mode: 'add' })}>
      {t('ecommerce.backend.store.domains.actions.add', 'Add domain binding')}
    </Button>
  ) : null

  const emptyState = (
    <ListEmptyState
      entityName={t('ecommerce.backend.store.domains.entityPlural', 'domain bindings')}
      title={t('ecommerce.backend.store.domains.empty.title', 'No domains bound yet')}
      description={t(
        'ecommerce.backend.store.domains.empty.description',
        'Bind an active domain, optionally with a path prefix, to make this store reachable.',
      )}
      onCreate={canManageDomains ? () => setDialog({ mode: 'add' }) : undefined}
      createLabel={t('ecommerce.backend.store.domains.actions.add', 'Add domain binding')}
    />
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('ecommerce.backend.store.domains.title', 'Domains')}</CardTitle>
        <CardDescription>
          {t(
            'ecommerce.backend.store.domains.description',
            'The domains this store is served on. Domain status is managed in domain management and shown here read-only. Only an active domain serves.',
          )}{' '}
          <Link className="underline" href={DOMAIN_SETTINGS_HREF}>
            {t('ecommerce.backend.store.domains.manageLink', 'Open domain management')}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert status="information">
          <AlertDescription>
            {t(
              'ecommerce.backend.store.domains.limitHint',
              'An organization holds at most two domains: one active plus one pending replacement. To serve another store on the same domain, give it a path prefix such as /de instead of adding a domain.',
            )}
          </AlertDescription>
        </Alert>
        {canManageDomains ? null : (
          <Alert status="information">
            <AlertDescription>
              {t(
                'ecommerce.backend.store.domains.readOnly',
                'You can view these bindings but not change them. Changing them requires permission to manage store domains.',
              )}
            </AlertDescription>
          </Alert>
        )}
        <div className="overflow-x-auto">
          <DataTable<DomainBindingRecord>
            columns={columns}
            data={bindings}
            isLoading={bindingsQuery.isLoading}
            error={bindingsQuery.isError ? t('ecommerce.backend.store.domains.errors.load', 'Failed to load the domain bindings.') : null}
            actions={addAction}
            rowActions={canManageDomains ? (row) => <RowActions items={buildRowActions(row)} /> : undefined}
            emptyState={emptyState}
            embedded
          />
        </div>
        {canManageDomains && dialog.mode !== 'closed' ? (
          <StoreDomainBindingDialog
            open
            onOpenChange={(next) => {
              if (!next) setDialog({ mode: 'closed' })
            }}
            storeId={store.id}
            binding={dialog.mode === 'edit' ? dialog.binding : null}
            bindings={bindings}
            mappings={mappings}
            onSaved={refresh}
          />
        ) : null}
        {ConfirmDialogElement}
      </CardContent>
    </Card>
  )
}
