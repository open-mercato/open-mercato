'use client'

import * as React from 'react'
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
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ChannelAssortmentCountCell } from './ChannelAssortmentCount'
import { useLookupLabelMap } from './ChannelLookupPicker'
import { priceKindLookupSource, salesChannelLookupSource } from './channelLookups'
import { StoreChannelBindingDialog } from './StoreChannelBindingDialog'
import type { StoreAdminRecord } from './storeAdmin'
import {
  CHANNEL_BINDINGS_API_PATH,
  CHANNEL_BINDINGS_API_URL,
  CHANNEL_BINDINGS_PAGE_SIZE,
  PRICE_SORT_FALLBACK_LABELS,
  PRICE_SORT_FALLBACK_VARIANTS,
  countScopeRules,
  isPriceSortFallback,
  type ChannelBindingListResponse,
  type ChannelBindingRecord,
} from './storeChannels'
import { useStoreAccess } from './useStoreAccess'

type StoreChannelsTabProps = {
  store: StoreAdminRecord
  reload: () => Promise<void>
}

type DialogState = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; binding: ChannelBindingRecord }

function uniqueIds(values: ReadonlyArray<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))).sort(
    (left, right) => left.localeCompare(right),
  )
}

export function StoreChannelsTab({ store, reload }: StoreChannelsTabProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'ecommerce-store-channels',
  })
  const { canManageChannels } = useStoreAccess()
  const [dialog, setDialog] = React.useState<DialogState>({ mode: 'closed' })

  const bindingsKey = React.useMemo(() => ['ecommerce', 'stores', 'channel-bindings', store.id], [store.id])

  const bindingsQuery = useQuery({
    queryKey: bindingsKey,
    queryFn: async (): Promise<ChannelBindingListResponse> => {
      const params = new URLSearchParams({
        storeId: store.id,
        page: '1',
        pageSize: String(CHANNEL_BINDINGS_PAGE_SIZE),
        sortField: 'createdAt',
        sortDir: 'asc',
      })
      const call = await apiCall<ChannelBindingListResponse>(`${CHANNEL_BINDINGS_API_URL}?${params.toString()}`, {
        cache: 'no-store',
      })
      if (!call.ok) {
        await raiseCrudError(call.response, t('ecommerce.backend.store.channels.errors.load', 'Failed to load the channel bindings.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const bindings = React.useMemo(() => bindingsQuery.data?.items ?? [], [bindingsQuery.data])
  const channelIds = React.useMemo(() => uniqueIds(bindings.map((binding) => binding.salesChannelId)), [bindings])
  const priceKindIds = React.useMemo(() => uniqueIds(bindings.map((binding) => binding.priceKindId)), [bindings])
  const channelLabels = useLookupLabelMap(salesChannelLookupSource, channelIds)
  const priceKindLabels = useLookupLabelMap(priceKindLookupSource, priceKindIds)

  const refresh = React.useCallback(async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: bindingsKey }), reload()])
  }, [bindingsKey, queryClient, reload])

  const describeBinding = React.useCallback(
    (binding: ChannelBindingRecord): string => channelLabels[binding.salesChannelId] ?? binding.salesChannelId,
    [channelLabels],
  )

  const runBindingMutation = React.useCallback(
    async (binding: ChannelBindingRecord, payload: Record<string, unknown>, run: () => Promise<unknown>, failure: string) => {
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

  const handleMakeDefault = React.useCallback(
    async (binding: ChannelBindingRecord) => {
      const failure = t('ecommerce.backend.store.channels.errors.makeDefault', 'Failed to make the binding the default.')
      const payload = { id: binding.id, isDefault: true }
      const ok = await runBindingMutation(
        binding,
        payload,
        () => updateCrud(CHANNEL_BINDINGS_API_PATH, payload, { errorMessage: failure }),
        failure,
      )
      if (!ok) return
      flash(
        t('ecommerce.backend.store.channels.flash.defaultSet', '{channel} is now the default channel of this store.', {
          channel: describeBinding(binding),
        }),
        'success',
      )
      await refresh()
    },
    [describeBinding, refresh, runBindingMutation, t],
  )

  const handleDelete = React.useCallback(
    async (binding: ChannelBindingRecord) => {
      const confirmed = await confirm({
        title: t('ecommerce.backend.store.channels.delete.confirmTitle', 'Remove binding "{channel}"?', {
          channel: describeBinding(binding),
        }),
        text: binding.isDefault
          ? t(
              'ecommerce.backend.store.channels.delete.confirmTextDefault',
              'This is the default binding. Until you make another binding the default, the storefront cannot serve and answers every request with an error. The sales channel itself is not deleted.',
            )
          : t(
              'ecommerce.backend.store.channels.delete.confirmText',
              'The store stops using this channel. The sales channel itself is not deleted and can be bound again.',
            ),
        confirmText: t('ecommerce.backend.store.channels.delete.confirmButton', 'Remove binding'),
        variant: 'destructive',
      })
      if (!confirmed) return
      const failure = t('ecommerce.backend.store.channels.errors.delete', 'Failed to remove the channel binding.')
      const ok = await runBindingMutation(
        binding,
        { id: binding.id },
        () => deleteCrud(CHANNEL_BINDINGS_API_PATH, binding.id, { errorMessage: failure }),
        failure,
      )
      if (!ok) return
      flash(t('ecommerce.backend.store.channels.flash.deleted', 'Channel binding removed'), 'success')
      await refresh()
    },
    [confirm, describeBinding, refresh, runBindingMutation, t],
  )

  const columns = React.useMemo<ColumnDef<ChannelBindingRecord>[]>(
    () => [
      {
        id: 'channel',
        header: t('ecommerce.backend.store.channels.columns.channel', 'Sales channel'),
        enableSorting: false,
        cell: ({ row }) => <span className="font-medium">{describeBinding(row.original)}</span>,
      },
      {
        id: 'default',
        header: t('ecommerce.backend.store.channels.columns.default', 'Default'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.isDefault ? (
            <StatusBadge variant="success" dot>
              {t('ecommerce.backend.store.channels.defaultBadge', 'Default')}
            </StatusBadge>
          ) : (
            '—'
          ),
      },
      {
        id: 'priceKind',
        header: t('ecommerce.backend.store.channels.columns.priceKind', 'Price kind'),
        enableSorting: false,
        cell: ({ row }) => {
          const priceKindId = row.original.priceKindId
          if (!priceKindId) {
            return (
              <span className="text-muted-foreground">
                {t('ecommerce.backend.store.channels.priceKindDefault', 'Default price kind')}
              </span>
            )
          }
          return priceKindLabels[priceKindId] ?? priceKindId
        },
      },
      {
        id: 'scope',
        header: t('ecommerce.backend.store.channels.columns.scope', 'Assortment'),
        enableSorting: false,
        cell: ({ row }) => {
          const rules = countScopeRules(row.original.assortmentScope)
          return rules > 0
            ? t('ecommerce.backend.store.channels.scopeRestricted', 'Restricted ({count} rules)', { count: String(rules) })
            : t('ecommerce.backend.store.channels.scopeAll', 'All products')
        },
      },
      {
        id: 'requireAuthentication',
        header: t('ecommerce.backend.store.channels.columns.requireAuthentication', 'Sign-in'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.requireAuthentication ? (
            <StatusBadge variant="warning" dot>
              {t('ecommerce.backend.store.channels.requireAuthenticationBadge', 'Sign-in required')}
            </StatusBadge>
          ) : (
            <span className="text-muted-foreground">{t('ecommerce.backend.store.channels.public', 'Public')}</span>
          ),
      },
      {
        id: 'priceSortFallback',
        header: t('ecommerce.backend.store.channels.columns.priceSortFallback', 'Large-catalogue price sort'),
        enableSorting: false,
        cell: ({ row }) => {
          const fallback = isPriceSortFallback(row.original.priceSortFallback) ? row.original.priceSortFallback : 'approximate'
          const label = PRICE_SORT_FALLBACK_LABELS[fallback]
          return <StatusBadge variant={PRICE_SORT_FALLBACK_VARIANTS[fallback]}>{t(label.key, label.fallback)}</StatusBadge>
        },
      },
      {
        id: 'count',
        header: t('ecommerce.backend.store.channels.columns.count', 'Products shown'),
        enableSorting: false,
        cell: ({ row }) => <ChannelAssortmentCountCell bindingId={row.original.id} />,
      },
    ],
    [describeBinding, priceKindLabels, t],
  )

  const buildRowActions = React.useCallback(
    (binding: ChannelBindingRecord): RowActionItem[] => {
      if (!canManageChannels) {
        return [
          {
            id: 'view',
            label: t('ecommerce.backend.store.channels.actions.view', 'View'),
            onSelect: () => setDialog({ mode: 'edit', binding }),
          },
        ]
      }
      const items: RowActionItem[] = [
        {
          id: 'edit',
          label: t('ecommerce.backend.store.channels.actions.edit', 'Edit'),
          onSelect: () => setDialog({ mode: 'edit', binding }),
        },
      ]
      if (!binding.isDefault) {
        items.push({
          id: 'make-default',
          label: t('ecommerce.backend.store.channels.actions.makeDefault', 'Make default'),
          onSelect: () => {
            void handleMakeDefault(binding)
          },
        })
      }
      items.push({
        id: 'delete',
        label: t('ecommerce.backend.store.channels.actions.delete', 'Remove'),
        destructive: true,
        onSelect: () => {
          void handleDelete(binding)
        },
      })
      return items
    },
    [canManageChannels, handleDelete, handleMakeDefault, t],
  )

  const addAction = canManageChannels ? (
    <Button type="button" onClick={() => setDialog({ mode: 'add' })}>
      {t('ecommerce.backend.store.channels.actions.add', 'Add channel binding')}
    </Button>
  ) : null

  const emptyState = (
    <ListEmptyState
      entityName={t('ecommerce.backend.store.channels.entityPlural', 'channel bindings')}
      title={t('ecommerce.backend.store.channels.empty.title', 'No sales channel bound yet')}
      description={t(
        'ecommerce.backend.store.channels.empty.description',
        'Bind a sales channel and make it the default. The storefront cannot serve without a default channel binding.',
      )}
      onCreate={canManageChannels ? () => setDialog({ mode: 'add' }) : undefined}
      createLabel={t('ecommerce.backend.store.channels.actions.add', 'Add channel binding')}
    />
  )

  const hasDefault = bindings.some((binding) => binding.isDefault)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('ecommerce.backend.store.channels.title', 'Channels')}</CardTitle>
        <CardDescription>
          {t(
            'ecommerce.backend.store.channels.description',
            'The sales channels this store sells through. Each binding decides what the channel shows and to whom: price kind, assortment scope, sign-in requirement and large-catalogue price sorting.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!bindingsQuery.isLoading && bindings.length > 0 && !hasDefault ? (
          <Alert status="warning">
            <AlertDescription>
              {t(
                'ecommerce.backend.store.channels.noDefault',
                'No binding is the default, so the storefront cannot serve. Make one binding the default.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        {canManageChannels ? null : (
          <Alert status="information">
            <AlertDescription>
              {t(
                'ecommerce.backend.store.channels.readOnly',
                'You can view these bindings but not change them. Changing them requires permission to manage store channels.',
              )}
            </AlertDescription>
          </Alert>
        )}
        <DataTable<ChannelBindingRecord>
          columns={columns}
          data={bindings}
          isLoading={bindingsQuery.isLoading}
          error={bindingsQuery.isError ? t('ecommerce.backend.store.channels.errors.load', 'Failed to load the channel bindings.') : null}
          actions={addAction}
          rowActions={(row) => <RowActions items={buildRowActions(row)} />}
          emptyState={emptyState}
          embedded
        />
        {dialog.mode !== 'closed' && (canManageChannels || dialog.mode === 'edit') ? (
          <StoreChannelBindingDialog
            open
            onOpenChange={(next) => {
              if (!next) setDialog({ mode: 'closed' })
            }}
            storeId={store.id}
            binding={dialog.mode === 'edit' ? dialog.binding : null}
            firstBinding={bindings.length === 0}
            readOnly={!canManageChannels}
            onSaved={refresh}
          />
        ) : null}
        {ConfirmDialogElement}
      </CardContent>
    </Card>
  )
}
