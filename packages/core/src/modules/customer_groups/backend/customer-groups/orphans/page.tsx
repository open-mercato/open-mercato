"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'

type OrphanRow = {
  groupId: string
  tenantId: string | null
  catalogPriceCount: number
  salesTaxRateCount: number
  sampleCatalogPriceIds: string[]
  sampleSalesTaxRateIds: string[]
}

type ReconcileResponse = { orphans?: OrphanRow[] }
type AdoptResponse = { ok: boolean; adoptedCount: number }

const linkClassName = 'text-sm text-primary underline underline-offset-4 hover:text-primary/80'

export default function CustomerGroupOrphansPage() {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [orphans, setOrphans] = React.useState<OrphanRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const mutationContextId = 'customer-groups-orphans:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const fallback: ReconcileResponse = { orphans: [] }
        const call = await apiCall<ReconcileResponse>('/api/customer_groups/customer-groups/reconcile', undefined, { fallback })
        if (!call.ok) {
          throw new Error(t('customer_groups.groups.orphans.errors.load', 'Failed to load orphaned references'))
        }
        if (!cancelled) setOrphans(Array.isArray(call.result?.orphans) ? call.result.orphans : [])
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : t('customer_groups.groups.orphans.errors.load', 'Failed to load orphaned references'),
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [reloadToken, t])

  const handleAdoptAll = React.useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t(
        'customer_groups.groups.orphans.confirmAdopt',
        'Create {count} placeholder group(s) for the orphaned references below?',
        { count: orphans.length },
      ),
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall<AdoptResponse>('/api/customer_groups/customer-groups/reconcile/adopt', { method: 'POST' })
          if (!call.ok) {
            throw Object.assign(new Error('[internal] customer_groups.reconcile.adopt failed'), {
              status: call.status,
            })
          }
          return call
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'customer_groups.group',
          resourceId: 'orphans',
          retryLastMutation,
        },
        mutationPayload: {},
      })
      flash(t('customer_groups.groups.orphans.flash.adopted', 'Placeholder groups created'), 'success')
      setReloadToken((token) => token + 1)
    } catch {
      flash(t('customer_groups.groups.orphans.flash.adoptError', 'Could not create placeholder groups'), 'error')
    }
  }, [confirmDialog, mutationContextId, orphans.length, retryLastMutation, runMutation, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('customer_groups.groups.orphans.loading', 'Loading orphaned references...')} />
        </PageBody>
      </Page>
    )
  }

  if (error) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-medium">
              {t('customer_groups.groups.orphans.pageTitle', 'Orphaned Customer Group References')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t(
                'customer_groups.groups.orphans.description',
                'Catalog prices and sales tax rates that reference a customer group id with no matching row.',
              )}
            </p>
          </div>
          {orphans.length > 0 ? (
            <Button type="button" onClick={handleAdoptAll}>
              {t('customer_groups.groups.orphans.actions.adoptAll', 'Adopt all')}
            </Button>
          ) : null}
        </div>

        {orphans.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            {t('customer_groups.groups.orphans.empty', 'No orphaned references')}
          </p>
        ) : (
          <div className="space-y-4">
            {orphans.map((orphan) => (
              <div key={orphan.groupId} className="rounded-md border border-border p-4">
                <p className="font-mono text-sm font-medium">{orphan.groupId}</p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'customer_groups.groups.orphans.counts',
                    '{catalogCount} catalog price row(s), {taxCount} sales tax rate row(s)',
                    { catalogCount: orphan.catalogPriceCount, taxCount: orphan.salesTaxRateCount },
                  )}
                </p>
                {orphan.sampleCatalogPriceIds.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('customer_groups.groups.orphans.sampleCatalogPrices', 'Sample catalog prices')}
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {orphan.sampleCatalogPriceIds.map((id) => (
                        <li key={id}>
                          <Link className={linkClassName} href={`/backend/catalog/prices/${id}/edit`}>
                            {id}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {orphan.sampleSalesTaxRateIds.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('customer_groups.groups.orphans.sampleSalesTaxRates', 'Sample sales tax rates')}
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {orphan.sampleSalesTaxRateIds.map((id) => (
                        <li key={id}>
                          {/* Tax rates are managed via a dialog on the sales config page — there is
                              no id-addressable edit route to deep-link to (see the module AGENTS.md
                              gap noted for Step 1.11). */}
                          <Link className={linkClassName} href="/backend/config/sales">
                            {id}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
