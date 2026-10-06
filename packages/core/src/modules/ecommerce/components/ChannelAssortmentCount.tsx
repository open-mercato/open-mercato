'use client'

import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useChannelAssortmentCount, type AssortmentCountState } from './useChannelAssortmentCount'
import type { AssortmentCountResult } from './storeChannels'

type Translate = ReturnType<typeof useT>

function useCountFormatter(): (value: number) => string {
  const locale = useLocale()
  const formatter = React.useMemo(() => new Intl.NumberFormat(locale), [locale])
  return React.useCallback((value: number) => formatter.format(value), [formatter])
}

function describeAuthenticationGate(result: AssortmentCountResult, t: Translate, format: (value: number) => string): string {
  if (result.reducedByAuthentication) {
    return t(
      'ecommerce.backend.store.channels.count.reducedByAuthentication',
      '0 products for anonymous visitors because sign-in is required; {count} without that requirement.',
      { count: format(result.countWithoutAuthentication) },
    )
  }
  return t(
    'ecommerce.backend.store.channels.count.authenticationEmpty',
    '0 products visible to anonymous visitors: sign-in is required, and the scope matches no products even without that requirement.',
  )
}

type ChannelAssortmentCountPanelProps = {
  state: AssortmentCountState
  unrestricted: boolean
}

export function ChannelAssortmentCountPanel({ state, unrestricted }: ChannelAssortmentCountPanelProps) {
  const t = useT()
  const format = useCountFormatter()

  if (state.status === 'idle') {
    return (
      <Alert status="information">
        <AlertDescription>
          {t(
            'ecommerce.backend.store.channels.count.saveFirst',
            'Save the binding to see how many products it shows. After that, the count updates as you change the scope.',
          )}
        </AlertDescription>
      </Alert>
    )
  }

  if (state.status === 'error') {
    return (
      <Alert status="warning">
        <AlertDescription>
          {t('ecommerce.backend.store.channels.count.error', 'The product count is unavailable right now.')}
        </AlertDescription>
      </Alert>
    )
  }

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm text-muted-foreground" aria-live="polite">
        <Spinner size="sm" />
        {t('ecommerce.backend.store.channels.count.loading', 'Counting products…')}
      </div>
    )
  }

  const { result } = state
  const headline = result.requireAuthentication
    ? describeAuthenticationGate(result, t, format)
    : unrestricted
      ? t('ecommerce.backend.store.channels.count.unrestricted', "All products in this channel's catalog: {count}.", {
          count: format(result.count),
        })
      : t('ecommerce.backend.store.channels.count.restricted', 'Products matching this scope: {count}.', {
          count: format(result.count),
        })

  return (
    <div className="space-y-2" aria-live="polite" data-testid="channel-assortment-count">
      {result.requireAuthentication ? (
        <Alert status="warning">
          <AlertTitle>{t('ecommerce.backend.store.channels.count.title', 'Live product count')}</AlertTitle>
          <AlertDescription>{headline}</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-1 rounded-md border border-border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            {t('ecommerce.backend.store.channels.count.title', 'Live product count')}
            {state.refreshing ? <Spinner size="sm" /> : null}
          </div>
          <p className="text-sm">{headline}</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {t(
          'ecommerce.backend.store.channels.count.basis',
          "Counted for an anonymous visitor, including the default customer group's own restrictions. Unsaved changes are counted too.",
        )}
      </p>
      {result.unindexedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(
            'ecommerce.backend.store.channels.count.unindexed',
            '{count} active products are not indexed for visibility yet. Under a restricted scope they stay hidden and are not counted until indexing catches up.',
            { count: format(result.unindexedCount) },
          )}
        </p>
      ) : null}
    </div>
  )
}

export function ChannelAssortmentCountCell({ bindingId }: { bindingId: string }) {
  const t = useT()
  const format = useCountFormatter()
  const state = useChannelAssortmentCount(bindingId, null, 0)
  if (state.status === 'loading' || state.status === 'idle') return <Spinner size="sm" />
  if (state.status === 'error') return <span className="text-muted-foreground">—</span>
  const { result } = state
  if (result.requireAuthentication) {
    return (
      <span>
        {result.reducedByAuthentication
          ? t('ecommerce.backend.store.channels.count.cellReduced', '0 ({count} without the sign-in requirement)', {
              count: format(result.countWithoutAuthentication),
            })
          : format(0)}
      </span>
    )
  }
  return <span>{format(result.count)}</span>
}
