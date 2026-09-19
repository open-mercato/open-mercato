"use client"

import * as React from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { renderProviderFieldInput } from './ProviderFieldInput'
import type { ProviderSettingField } from '../lib/providers'

const logger = createLogger('sales')

const SAVE_CONTEXT_ID = 'sales-tax-provider-settings'
const DEFAULT_PROVIDER_KEY = 'table-rates'

/**
 * The built in provider is defined in core, so its label and description are
 * plain English on the provider object. They are translated here; an external
 * package is not in this map and keeps its own label, which it ships with its
 * own locale files.
 */
const BUILT_IN_PROVIDER_I18N: Record<string, { label: string; description: string }> = {
  [DEFAULT_PROVIDER_KEY]: {
    label: 'sales.providers.tax.tableRates.label',
    description: 'sales.providers.tax.tableRates.description',
  },
}

type TaxProviderOption = {
  key: string
  label: string
  description: string | null
  integrationId: string | null
  capabilities: Record<string, unknown> | null
  fields: ProviderSettingField[]
}

type ShipFromAddress = {
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
}

type TaxProviderSettingsResponse = {
  providerKey: string
  providerSettings: Record<string, unknown> | null
  shipFromAddress: ShipFromAddress | null
  timeoutMs: number
  providers: TaxProviderOption[]
}

const SHIP_FROM_FIELDS: Array<keyof ShipFromAddress> = [
  'addressLine1',
  'addressLine2',
  'city',
  'region',
  'postalCode',
  'country',
]

/**
 * Per organization tax provider selection, and the host of whichever tax
 * section the selection implies.
 *
 * The provider picker only earns its place when there is something to pick: an
 * instance with no external tax provider package installed registers the
 * default alone, and then this renders `taxRatesSlot` and nothing else, so the
 * page reads exactly as it did before the provider slot existed. Selecting the
 * default keeps the tax rates table; selecting an external provider replaces it
 * with that provider's own options, the ship from address and the timeout —
 * none of which the default has any use for.
 *
 * Only non secret options are edited here. A provider that needs credentials
 * declares an integration, and this section links to it rather than collecting
 * the secret itself — the integrations module is the only place that encrypts
 * at rest and masks in the admin UI.
 */
export function TaxProviderSettings({ taxRatesSlot }: { taxRatesSlot?: React.ReactNode } = {}) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [providers, setProviders] = React.useState<TaxProviderOption[]>([])
  const [providerKey, setProviderKey] = React.useState<string>(DEFAULT_PROVIDER_KEY)
  const [providerSettings, setProviderSettings] = React.useState<Record<string, unknown>>({})
  const [shipFromAddress, setShipFromAddress] = React.useState<ShipFromAddress>({})
  const [timeoutMs, setTimeoutMs] = React.useState<number | ''>('')

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: SAVE_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const translations = React.useMemo(
    () => ({
      title: t('sales.config.taxProvider.title', 'Tax provider'),
      description: t(
        'sales.config.taxProvider.description',
        'Choose which engine calculates tax on this organization’s documents.'
      ),
      providerLabel: t('sales.config.taxProvider.providerLabel', 'Provider'),
      providerSettings: t('sales.config.taxProvider.providerSettings', 'Provider options'),
      shipFrom: t('sales.config.taxProvider.shipFrom', 'Ship from address'),
      timeoutMs: t('sales.config.taxProvider.timeoutMs', 'Timeout (ms)'),
      integrationNotice: t(
        'sales.config.taxProvider.integrationNotice',
        'This provider stores its credentials in the integrations module.'
      ),
      integrationLink: t('sales.config.taxProvider.integrationLink', 'Open the integration'),
      actions: {
        save: t('sales.config.taxProvider.actions.save', 'Save settings'),
        refresh: t('sales.config.taxProvider.actions.refresh', 'Refresh'),
      },
      saved: t('sales.config.taxProvider.saved', 'Tax provider settings saved.'),
      loadError: t('sales.config.taxProvider.errors.load', 'Failed to load tax provider settings.'),
      saveError: t('sales.config.taxProvider.errors.save', 'Failed to save tax provider settings.'),
      shipFromFields: {
        addressLine1: t('sales.config.taxProvider.shipFromFields.addressLine1', 'Address line 1'),
        addressLine2: t('sales.config.taxProvider.shipFromFields.addressLine2', 'Address line 2'),
        city: t('sales.config.taxProvider.shipFromFields.city', 'City'),
        region: t('sales.config.taxProvider.shipFromFields.region', 'Region'),
        postalCode: t('sales.config.taxProvider.shipFromFields.postalCode', 'Postal code'),
        country: t('sales.config.taxProvider.shipFromFields.country', 'Country'),
      } as Record<string, string>,
    }),
    [t]
  )

  const applyResponse = React.useCallback((result: TaxProviderSettingsResponse | null | undefined) => {
    if (!result) return
    setProviders(Array.isArray(result.providers) ? result.providers : [])
    setProviderKey(result.providerKey || DEFAULT_PROVIDER_KEY)
    setProviderSettings(
      result.providerSettings && typeof result.providerSettings === 'object' ? result.providerSettings : {}
    )
    setShipFromAddress(
      result.shipFromAddress && typeof result.shipFromAddress === 'object' ? result.shipFromAddress : {}
    )
    setTimeoutMs(typeof result.timeoutMs === 'number' ? result.timeoutMs : '')
  }, [])

  const loadSettings = React.useCallback(async () => {
    setLoading(true)
    try {
      const call = await apiCall<TaxProviderSettingsResponse>('/api/sales/settings/tax-provider')
      if (!call.ok) {
        flash(translations.loadError, 'error')
        return
      }
      applyResponse(call.result)
    } catch (err) {
      logger.error('sales.tax-provider-settings.load failed', { err })
      flash(translations.loadError, 'error')
    } finally {
      setLoading(false)
    }
  }, [applyResponse, translations.loadError])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings, scopeVersion])

  const providerLabel = React.useCallback(
    (provider: TaxProviderOption) => {
      const keys = BUILT_IN_PROVIDER_I18N[provider.key]
      return keys ? t(keys.label, provider.label) : provider.label
    },
    [t]
  )

  const providerDescription = React.useCallback(
    (provider: TaxProviderOption) => {
      const keys = BUILT_IN_PROVIDER_I18N[provider.key]
      if (keys) return t(keys.description, provider.description ?? '')
      return provider.description ?? null
    },
    [t]
  )

  const selectedProvider = React.useMemo(
    () => providers.find((provider) => provider.key === providerKey) ?? null,
    [providerKey, providers]
  )

  // `GET /api/sales/tax-providers` returning the default alone is the wire
  // signal for "no external tax provider package is installed here".
  const hasExternalProvider = React.useMemo(
    () => providers.some((provider) => provider.key !== DEFAULT_PROVIDER_KEY),
    [providers]
  )
  const usesDefaultProvider = providerKey === DEFAULT_PROVIDER_KEY

  // Switching provider clears the previous provider's options: they are keyed by
  // the old provider's schema and would fail its validation.
  const handleProviderChange = React.useCallback((nextKey: string) => {
    setProviderKey(nextKey)
    setProviderSettings({})
  }, [])

  const handleSubmit = React.useCallback(async () => {
    setSaving(true)
    try {
      const hasShipFrom = SHIP_FROM_FIELDS.some((field) => {
        const value = shipFromAddress[field]
        return typeof value === 'string' && value.trim().length > 0
      })
      const payload = {
        providerKey,
        providerSettings,
        shipFromAddress: hasShipFrom ? shipFromAddress : null,
        timeoutMs: timeoutMs === '' ? null : Number(timeoutMs),
      }
      const call = await runMutation({
        // optimistic-lock-exempt: single-row per-organization settings blob — no
        // per-record version and no concurrent record edit surface.
        operation: async () => {
          const response = await apiCall<TaxProviderSettingsResponse>('/api/sales/settings/tax-provider', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!response.ok) {
            throw new Error(translations.saveError)
          }
          return response
        },
        context: {
          formId: SAVE_CONTEXT_ID,
          resourceKind: 'sales.settings',
          retryLastMutation,
        },
        mutationPayload: payload,
      })
      applyResponse(call.result)
      flash(translations.saved, 'success')
    } catch (err) {
      logger.error('sales.tax-provider-settings.save failed', { err })
      const message = err instanceof Error && err.message ? err.message : translations.saveError
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [
    applyResponse,
    providerKey,
    providerSettings,
    retryLastMutation,
    runMutation,
    shipFromAddress,
    timeoutMs,
    translations.saveError,
    translations.saved,
  ])

  const busy = loading || saving

  // Nothing to choose between: the picker would be a select with one option, so
  // the page shows the tax rates table alone, as it did before this slot.
  if (!hasExternalProvider) return <>{taxRatesSlot ?? null}</>

  return (
    <>
      <section className="space-y-4" data-testid="sales-tax-provider-settings">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{translations.title}</h3>
          <p className="text-xs text-muted-foreground">{translations.description}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sales-tax-provider-key">{translations.providerLabel}</Label>
          <Select value={providerKey} onValueChange={handleProviderChange} disabled={busy}>
            <SelectTrigger id="sales-tax-provider-key">
              <SelectValue placeholder={translations.providerLabel} />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider.key} value={provider.key}>
                  {providerLabel(provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedProvider && providerDescription(selectedProvider) ? (
            <p className="text-xs text-muted-foreground">{providerDescription(selectedProvider)}</p>
          ) : null}
        </div>

        {usesDefaultProvider ? null : (
          <>
            {selectedProvider?.integrationId ? (
              <Alert status="information">
                <AlertDescription>
                  <div className="space-y-1">
                    <p>{translations.integrationNotice}</p>
                    <a
                      className="text-primary underline-offset-2 hover:underline"
                      href={`/backend/integrations/${selectedProvider.integrationId}`}
                    >
                      {translations.integrationLink}
                    </a>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            {selectedProvider?.fields?.length ? (
              <div className="space-y-3 rounded-none border bg-card/30 p-4">
                <p className="text-sm font-medium">{translations.providerSettings}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {selectedProvider.fields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <Label htmlFor={field.key}>{field.label}</Label>
                      {renderProviderFieldInput({
                        field,
                        value: providerSettings[field.key],
                        onChange: (next) =>
                          setProviderSettings((prev) => ({ ...prev, [field.key]: next })),
                      })}
                      {field.description ? (
                        <p className="text-xs text-muted-foreground">{field.description}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-3 rounded-none border bg-card/30 p-4">
              <p className="text-sm font-medium">{translations.shipFrom}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {SHIP_FROM_FIELDS.map((field) => (
                  <div key={field} className="space-y-1">
                    <Label htmlFor={`ship-from-${field}`}>{translations.shipFromFields[field]}</Label>
                    <Input
                      id={`ship-from-${field}`}
                      value={typeof shipFromAddress[field] === 'string' ? (shipFromAddress[field] as string) : ''}
                      onChange={(evt) =>
                        setShipFromAddress((prev) => ({ ...prev, [field]: evt.target.value }))
                      }
                      disabled={busy}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="sales-tax-provider-timeout">{translations.timeoutMs}</Label>
              <Input
                id="sales-tax-provider-timeout"
                type="number"
                min={1000}
                max={30000}
                value={timeoutMs === '' ? '' : String(timeoutMs)}
                onChange={(evt) => setTimeoutMs(evt.target.value === '' ? '' : Number(evt.target.value))}
                disabled={busy}
              />
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <Button type="button" onClick={() => void handleSubmit()} disabled={busy}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {translations.actions.save}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadSettings()}
            disabled={busy}
            aria-label={translations.actions.refresh}
          >
            <RefreshCw className={loading ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} aria-hidden="true" />
            {translations.actions.refresh}
          </Button>
        </div>
      </section>
      {usesDefaultProvider ? taxRatesSlot ?? null : null}
    </>
  )
}
