"use client"

import { match, P } from 'ts-pattern'
import { Card, CardContent } from '@open-mercato/ui/primitives/card'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Truck } from 'lucide-react'
import type { Provider } from '../types'

export type ProviderStepProps = {
  isLoading: boolean
  error: string | null
  providers: Provider[]
  onSelect: (providerKey: string) => void
}

export const ProviderStep = (props: ProviderStepProps) => {
  const { providers, onSelect } = props
  const t = useT()

  return match(props)
    .with({ isLoading: true }, () => (
      <div className="flex justify-center py-8"><Spinner /></div>
    ))
    .with({ error: P.string }, ({ error }) => (
      <ErrorMessage label={error} />
    ))
    .with({ providers: [] }, () => (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t('shipping_carriers.create.noProviders', 'No shipping providers are configured. Enable a carrier integration first.')}
        </CardContent>
      </Card>
    ))
    .otherwise(() => (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => (
          <button
            key={provider.providerKey}
            type="button"
            className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSelect(provider.providerKey)}
          >
            <Truck className="h-6 w-6 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium capitalize">{provider.providerKey.replace(/_/g, ' ')}</p>
              <p className="text-xs text-muted-foreground">{provider.providerKey}</p>
            </div>
          </button>
        ))}
      </div>
    ))
}
