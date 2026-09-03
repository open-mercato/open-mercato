"use client"

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog')

const MUTATION_CONTEXT_ID = 'catalog-omnibus-settings'
const UNSET_OPTION_VALUE = '__unset__'
const DEFAULT_LOOKBACK_DAYS = 30
const DEFAULT_PROGRESSIVE_MAX_GAP_DAYS = 7

type MinimizationAxis = 'gross' | 'net'
type NoChannelMode = 'best_effort' | 'require_channel'
type PerishableGoodsRule = 'standard' | 'exempt' | 'last_price'
type NewArrivalRule = 'standard' | 'shorter_window'

type OmnibusChannelConfig = {
  presentedPriceKindId?: string
  countryCode?: string
  lookbackDays?: number
  minimizationAxis?: MinimizationAxis
  progressiveReductionRule?: boolean
  progressiveMaxGapDays?: number
  perishableGoodsRule?: PerishableGoodsRule
  newArrivalRule?: NewArrivalRule
  newArrivalsLookbackDays?: number | null
}

type OmnibusBackfillCoverage = {
  completedAt: string
  lookbackDays: number
}

type OmnibusConfig = {
  enabled?: boolean
  enabledCountryCodes?: string[]
  noChannelMode?: NoChannelMode
  lookbackDays?: number
  minimizationAxis?: MinimizationAxis
  defaultPresentedPriceKindId?: string
  backfillCoverage?: Record<string, OmnibusBackfillCoverage>
  channels?: Record<string, OmnibusChannelConfig>
}

type CatalogSettingsResponse = {
  unitPriceDisplayEnabled?: boolean
  omnibus?: OmnibusConfig
}

type PriceKindOption = {
  id: string
  code: string
  title: string
}

type SalesChannelOption = {
  id: string
  name: string
}

type SettingsErrorBody = {
  field?: string
  error?: string
  channels?: string[]
  details?: {
    field?: string
    error?: string
    channels?: string[]
  }
}

function toPriceKindOptions(items: unknown): PriceKindOption[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : null
    if (!id) return []
    const title = typeof record.title === 'string' ? record.title : id
    const code = typeof record.code === 'string' ? record.code : ''
    return [{ id, title, code }]
  })
}

function toSalesChannelOptions(items: unknown): SalesChannelOption[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : null
    if (!id) return []
    const name = typeof record.name === 'string' ? record.name : id
    return [{ id, name }]
  })
}

function parsePositiveInteger(raw: string): number | undefined {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return undefined
  return parsed
}

function parseCountryCodes(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry.length > 0)
}

export function OmnibusSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [visible, setVisible] = React.useState(false)
  const [form, setForm] = React.useState<OmnibusConfig>({})
  const [countryCodesText, setCountryCodesText] = React.useState('')
  const [priceKinds, setPriceKinds] = React.useState<PriceKindOption[]>([])
  const [salesChannels, setSalesChannels] = React.useState<SalesChannelOption[]>([])
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const settingsCall = await apiCall<CatalogSettingsResponse>('/api/catalog/settings')
      if (!settingsCall.ok || !settingsCall.result) {
        setVisible(false)
        setLoadFailed(true)
        return
      }
      const payload = settingsCall.result
      // The route omits `omnibus` (instead of returning 403) for callers without
      // `catalog.settings.view`, so an absent key means "not authorized to configure it".
      if (!Object.prototype.hasOwnProperty.call(payload, 'omnibus')) {
        setVisible(false)
        return
      }
      const config = payload.omnibus ?? {}
      setForm(config)
      setCountryCodesText((config.enabledCountryCodes ?? []).join(', '))
      setVisible(true)

      const [priceKindsCall, channelsCall] = await Promise.all([
        apiCall<{ items?: unknown }>('/api/catalog/price-kinds?page=1&pageSize=100'),
        apiCall<{ items?: unknown }>('/api/sales/channels?page=1&pageSize=100'),
      ])
      setPriceKinds(priceKindsCall.ok ? toPriceKindOptions(priceKindsCall.result?.items) : [])
      setSalesChannels(channelsCall.ok ? toSalesChannelOptions(channelsCall.result?.items) : [])
    } catch (err) {
      logger.error('catalog.omnibus.settings.load failed', { err })
      setVisible(false)
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load().catch(() => {})
  }, [load, scopeVersion])

  const patchChannel = React.useCallback((channelId: string, patch: Partial<OmnibusChannelConfig>) => {
    setForm((current) => {
      const channels = current.channels ?? {}
      return {
        ...current,
        channels: { ...channels, [channelId]: { ...(channels[channelId] ?? {}), ...patch } },
      }
    })
  }, [])

  const removeChannel = React.useCallback((channelId: string) => {
    setForm((current) => {
      const channels = { ...(current.channels ?? {}) }
      delete channels[channelId]
      return { ...current, channels }
    })
  }, [])

  const channelNameOf = React.useCallback(
    (channelId: string) => salesChannels.find((channel) => channel.id === channelId)?.name ?? channelId,
    [salesChannels],
  )

  const describeSaveError = React.useCallback(
    (status: number, body: SettingsErrorBody | null): string => {
      const detail = body?.details ?? body ?? null
      const channelNames = (detail?.channels ?? []).map(channelNameOf).join(', ')
      if (status === 422 && detail?.error === 'backfill_required_before_enable') {
        return t(
          'catalog.omnibus.settings.errors.backfillRequired',
          'Omnibus cannot be enabled yet: no price history has been backfilled for {channels}. Run the omnibus backfill for those channels first, then enable it.',
          { channels: channelNames },
        )
      }
      if (detail?.error === 'presented_price_kind_required') {
        return t(
          'catalog.omnibus.settings.errors.presentedPriceKindRequired',
          'Select a presented price kind for {channels}, or set a default presented price kind.',
          { channels: channelNames },
        )
      }
      return t('catalog.omnibus.settings.saveError', 'Failed to save settings')
    },
    [channelNameOf, t],
  )

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const enabledCountryCodes = parseCountryCodes(countryCodesText)
      const payload: OmnibusConfig = { ...form, enabledCountryCodes }
      // `backfillCoverage` is owned by the backfill job — never echo it back from the form.
      delete payload.backfillCoverage
      setSaving(true)
      try {
        const saved = await runMutation<OmnibusConfig>({
          operation: async () => {
            // optimistic-lock-exempt: the omnibus configuration is a single tenant-scoped
            // module-config blob written through ModuleConfigService, not a versioned
            // editable record — there is no `updated_at` row version to lock against.
            // Only the `omnibus` key is sent so the sibling unit-price panel is untouched.
            const call = await apiCall<CatalogSettingsResponse & SettingsErrorBody>(
              '/api/catalog/settings',
              {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ omnibus: payload }),
              },
            )
            if (!call.ok) {
              throw new Error(describeSaveError(call.status, call.result))
            }
            return call.result?.omnibus ?? payload
          },
          context: {
            formId: MUTATION_CONTEXT_ID,
            resourceKind: 'catalog.settings',
            resourceId: 'omnibus',
            retryLastMutation,
          },
          mutationPayload: { omnibus: payload },
        })
        setForm(saved)
        setCountryCodesText((saved.enabledCountryCodes ?? []).join(', '))
        flash(t('catalog.omnibus.settings.saved', 'Omnibus settings saved'), 'success')
      } catch (err) {
        logger.error('catalog.omnibus.settings.save failed', { err })
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('catalog.omnibus.settings.saveError', 'Failed to save settings')
        flash(message, 'error')
      } finally {
        setSaving(false)
      }
    },
    [countryCodesText, describeSaveError, form, retryLastMutation, runMutation, t],
  )

  if (loading) {
    return (
      <section className="border bg-card text-card-foreground shadow-sm">
        <div className="flex items-center gap-2 px-6 py-4 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('catalog.omnibus.settings.loading', 'Loading Omnibus settings…')}
        </div>
      </section>
    )
  }

  if (loadFailed) {
    return <ErrorMessage label={t('catalog.omnibus.settings.loadError', 'Failed to load Omnibus settings')} />
  }

  if (!visible) return null

  const enabled = form.enabled ?? false
  const globalLookbackDays = form.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const configuredChannels = Object.entries(form.channels ?? {})
  const configuredChannelIds = new Set(configuredChannels.map(([channelId]) => channelId))
  const assignableChannels = salesChannels.filter((channel) => !configuredChannelIds.has(channel.id))
  const staleBackfillChannels = configuredChannels
    .filter(([channelId, channel]) => {
      const coverage = form.backfillCoverage?.[channelId]
      if (!coverage) return false
      return coverage.lookbackDays < (channel.lookbackDays ?? globalLookbackDays)
    })
    .map(([channelId]) => channelNameOf(channelId))

  return (
    <section className="border bg-card text-card-foreground shadow-sm">
      <div className="space-y-1 border-b px-6 py-4">
        <h2 className="text-lg font-semibold">{t('catalog.omnibus.settings.title', 'Omnibus price tracking')}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            'catalog.omnibus.settings.description',
            'Configures the EU 2019/2161 (Omnibus) prior-price reference shown next to announced price reductions.',
          )}
        </p>
      </div>
      <form className="space-y-6 px-6 py-4" onSubmit={handleSubmit}>
        <SwitchField
          label={t('catalog.omnibus.settings.enabled', 'Enable Omnibus compliance')}
          description={t(
            'catalog.omnibus.settings.enabledDescription',
            'Requires a completed price-history backfill for every EU channel in scope.',
          )}
          checked={enabled}
          disabled={saving}
          onCheckedChange={(next) => setForm((current) => ({ ...current, enabled: next }))}
        />

        {enabled ? (
          <div className="space-y-6 border-l-2 border-border pl-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="omnibus-lookback-days">
                  {t('catalog.omnibus.settings.lookbackDays', 'Lookback window (days)')}
                </Label>
                <Input
                  id="omnibus-lookback-days"
                  type="number"
                  min={1}
                  max={365}
                  value={String(globalLookbackDays)}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lookbackDays: parsePositiveInteger(event.target.value) ?? DEFAULT_LOOKBACK_DAYS,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="omnibus-minimization-axis">
                  {t('catalog.omnibus.settings.minimizationAxis', 'Minimization axis')}
                </Label>
                <Select
                  value={form.minimizationAxis ?? 'gross'}
                  disabled={saving}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, minimizationAxis: value as MinimizationAxis }))
                  }
                >
                  <SelectTrigger id="omnibus-minimization-axis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gross">
                      {t('catalog.omnibus.settings.minimizationAxis.gross', 'Gross (B2C)')}
                    </SelectItem>
                    <SelectItem value="net">
                      {t('catalog.omnibus.settings.minimizationAxis.net', 'Net (B2B)')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="omnibus-no-channel-mode">
                  {t('catalog.omnibus.settings.noChannelMode', 'Requests without channel context')}
                </Label>
                <Select
                  value={form.noChannelMode ?? 'best_effort'}
                  disabled={saving}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, noChannelMode: value as NoChannelMode }))
                  }
                >
                  <SelectTrigger id="omnibus-no-channel-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="best_effort">
                      {t('catalog.omnibus.settings.noChannelMode.bestEffort', 'Best effort (blend all channels)')}
                    </SelectItem>
                    <SelectItem value="require_channel">
                      {t('catalog.omnibus.settings.noChannelMode.requireChannel', 'Require channel (fail closed)')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {form.noChannelMode === 'require_channel' ? (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'catalog.omnibus.settings.noChannelMode.requireChannelHint',
                      "When 'Require channel' is active, each channel must have a country code configured in the per-channel overrides below.",
                    )}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="omnibus-default-price-kind">
                  {t('catalog.omnibus.settings.presentedPriceKind', 'Default presented price kind')}
                </Label>
                <Select
                  value={form.defaultPresentedPriceKindId ?? UNSET_OPTION_VALUE}
                  disabled={saving}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      defaultPresentedPriceKindId: value === UNSET_OPTION_VALUE ? undefined : value,
                    }))
                  }
                >
                  <SelectTrigger id="omnibus-default-price-kind">
                    <SelectValue
                      placeholder={t('catalog.omnibus.settings.selectPriceKind', 'Select price kind…')}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET_OPTION_VALUE}>
                      {t('catalog.omnibus.settings.selectPriceKind', 'Select price kind…')}
                    </SelectItem>
                    {priceKinds.map((priceKind) => (
                      <SelectItem key={priceKind.id} value={priceKind.id}>
                        {priceKind.code ? `${priceKind.title} (${priceKind.code})` : priceKind.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="omnibus-country-codes">
                {t('catalog.omnibus.settings.enabledCountryCodes', 'Active in EU markets')}
              </Label>
              <Input
                id="omnibus-country-codes"
                value={countryCodesText}
                disabled={saving}
                placeholder="PL, DE, FR"
                onChange={(event) => setCountryCodesText(event.target.value)}
                onBlur={(event) => setCountryCodesText(parseCountryCodes(event.target.value).join(', '))}
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  'catalog.omnibus.settings.enabledCountryCodesHint',
                  'Enter ISO 3166-1 alpha-2 country codes separated by commas (e.g. PL, DE, FR). "EU" is not accepted — list each member state. An empty list disables Omnibus for every channel.',
                )}
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">
                {t('catalog.omnibus.settings.channelOverrides', 'Per-channel overrides')}
              </h3>
              {configuredChannels.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('catalog.omnibus.settings.channelOverridesEmpty', 'No channel overrides configured yet.')}
                </p>
              ) : null}
              {configuredChannels.map(([channelId, channel]) => (
                <div key={channelId} className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{channelNameOf(channelId)}</p>
                    <IconButton
                      type="button"
                      variant="ghost"
                      disabled={saving}
                      aria-label={t('catalog.omnibus.settings.removeChannel', 'Remove channel override')}
                      onClick={() => removeChannel(channelId)}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`omnibus-channel-price-kind-${channelId}`}>
                        {t('catalog.omnibus.settings.channelPresentedPriceKind', 'Presented price kind')}
                      </Label>
                      <Select
                        value={channel.presentedPriceKindId ?? UNSET_OPTION_VALUE}
                        disabled={saving}
                        onValueChange={(value) =>
                          patchChannel(channelId, {
                            presentedPriceKindId: value === UNSET_OPTION_VALUE ? undefined : value,
                          })
                        }
                      >
                        <SelectTrigger id={`omnibus-channel-price-kind-${channelId}`}>
                          <SelectValue
                            placeholder={t('catalog.omnibus.settings.useDefault', 'Use default')}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNSET_OPTION_VALUE}>
                            {t('catalog.omnibus.settings.useDefault', 'Use default')}
                          </SelectItem>
                          {priceKinds.map((priceKind) => (
                            <SelectItem key={priceKind.id} value={priceKind.id}>
                              {priceKind.code ? `${priceKind.title} (${priceKind.code})` : priceKind.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`omnibus-channel-country-${channelId}`}>
                        {t('catalog.omnibus.settings.countryCode', 'Country code (e.g. PL, DE)')}
                      </Label>
                      <Input
                        id={`omnibus-channel-country-${channelId}`}
                        value={channel.countryCode ?? ''}
                        maxLength={2}
                        disabled={saving}
                        placeholder="PL"
                        onChange={(event) =>
                          patchChannel(channelId, {
                            countryCode: event.target.value.trim().toUpperCase() || undefined,
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('catalog.omnibus.settings.countryCodeHint', "Must be listed in 'Active in EU markets' above.")}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`omnibus-channel-lookback-${channelId}`}>
                        {t('catalog.omnibus.settings.channelLookbackDays', 'Lookback window (days)')}
                      </Label>
                      <Input
                        id={`omnibus-channel-lookback-${channelId}`}
                        type="number"
                        min={1}
                        max={365}
                        value={channel.lookbackDays != null ? String(channel.lookbackDays) : ''}
                        placeholder={String(globalLookbackDays)}
                        disabled={saving}
                        onChange={(event) =>
                          patchChannel(channelId, { lookbackDays: parsePositiveInteger(event.target.value) })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`omnibus-channel-axis-${channelId}`}>
                        {t('catalog.omnibus.settings.minimizationAxis', 'Minimization axis')}
                      </Label>
                      <Select
                        value={channel.minimizationAxis ?? UNSET_OPTION_VALUE}
                        disabled={saving}
                        onValueChange={(value) =>
                          patchChannel(channelId, {
                            minimizationAxis: value === UNSET_OPTION_VALUE ? undefined : (value as MinimizationAxis),
                          })
                        }
                      >
                        <SelectTrigger id={`omnibus-channel-axis-${channelId}`}>
                          <SelectValue placeholder={t('catalog.omnibus.settings.useDefault', 'Use default')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNSET_OPTION_VALUE}>
                            {t('catalog.omnibus.settings.useDefault', 'Use default')}
                          </SelectItem>
                          <SelectItem value="gross">
                            {t('catalog.omnibus.settings.minimizationAxis.gross', 'Gross (B2C)')}
                          </SelectItem>
                          <SelectItem value="net">
                            {t('catalog.omnibus.settings.minimizationAxis.net', 'Net (B2B)')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <SwitchField
                    label={t('catalog.omnibus.settings.progressiveReductionRule', 'Progressive reduction rule (Art. 6a(5))')}
                    description={t(
                      'catalog.omnibus.settings.progressiveReductionRuleHint',
                      'Freezes the reference price at the start of a continuous, step-by-step reduction campaign.',
                    )}
                    checked={channel.progressiveReductionRule ?? false}
                    disabled={saving}
                    onCheckedChange={(next) => patchChannel(channelId, { progressiveReductionRule: next })}
                  />

                  {channel.progressiveReductionRule ? (
                    <div className="space-y-2">
                      <Label htmlFor={`omnibus-channel-progressive-gap-${channelId}`}>
                        {t('catalog.omnibus.settings.progressiveMaxGapDays', 'Maximum gap between reductions (days)')}
                      </Label>
                      <Input
                        id={`omnibus-channel-progressive-gap-${channelId}`}
                        type="number"
                        min={1}
                        max={365}
                        value={channel.progressiveMaxGapDays != null ? String(channel.progressiveMaxGapDays) : ''}
                        placeholder={String(DEFAULT_PROGRESSIVE_MAX_GAP_DAYS)}
                        disabled={saving}
                        onChange={(event) =>
                          patchChannel(channelId, {
                            progressiveMaxGapDays: parsePositiveInteger(event.target.value),
                          })
                        }
                      />
                    </div>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`omnibus-channel-perishable-${channelId}`}>
                        {t('catalog.omnibus.settings.perishableGoodsRule', 'Perishable goods rule')}
                      </Label>
                      <Select
                        value={channel.perishableGoodsRule ?? 'standard'}
                        disabled={saving}
                        onValueChange={(value) =>
                          patchChannel(channelId, { perishableGoodsRule: value as PerishableGoodsRule })
                        }
                      >
                        <SelectTrigger id={`omnibus-channel-perishable-${channelId}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">
                            {t('catalog.omnibus.settings.perishableGoodsRule.standard', 'Standard')}
                          </SelectItem>
                          <SelectItem value="exempt">
                            {t('catalog.omnibus.settings.perishableGoodsRule.exempt', 'Exempt')}
                          </SelectItem>
                          <SelectItem value="last_price">
                            {t('catalog.omnibus.settings.perishableGoodsRule.lastPrice', 'Use last price')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`omnibus-channel-new-arrival-${channelId}`}>
                        {t('catalog.omnibus.settings.newArrivalRule', 'New arrivals rule')}
                      </Label>
                      <Select
                        value={channel.newArrivalRule ?? 'standard'}
                        disabled={saving}
                        onValueChange={(value) =>
                          patchChannel(channelId, { newArrivalRule: value as NewArrivalRule })
                        }
                      >
                        <SelectTrigger id={`omnibus-channel-new-arrival-${channelId}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">
                            {t('catalog.omnibus.settings.newArrivalRule.standard', 'Standard')}
                          </SelectItem>
                          <SelectItem value="shorter_window">
                            {t('catalog.omnibus.settings.newArrivalRule.shorterWindow', 'Shorter window')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {channel.newArrivalRule === 'shorter_window' ? (
                    <div className="space-y-2">
                      <Label htmlFor={`omnibus-channel-new-arrival-days-${channelId}`}>
                        {t('catalog.omnibus.settings.newArrivalsLookbackDays', 'New arrival window (days)')}
                      </Label>
                      <Input
                        id={`omnibus-channel-new-arrival-days-${channelId}`}
                        type="number"
                        min={1}
                        max={365}
                        value={channel.newArrivalsLookbackDays != null ? String(channel.newArrivalsLookbackDays) : ''}
                        placeholder={t('catalog.omnibus.settings.traderDiscretion', "Trader's discretion")}
                        disabled={saving}
                        onChange={(event) =>
                          patchChannel(channelId, {
                            newArrivalsLookbackDays: parsePositiveInteger(event.target.value) ?? null,
                          })
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ))}

              {assignableChannels.length > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="omnibus-add-channel">
                    {t('catalog.omnibus.settings.addChannel', 'Add channel')}
                  </Label>
                  <Select
                    value={UNSET_OPTION_VALUE}
                    disabled={saving}
                    onValueChange={(value) => {
                      if (value === UNSET_OPTION_VALUE) return
                      patchChannel(value, {})
                    }}
                  >
                    <SelectTrigger id="omnibus-add-channel">
                      <SelectValue
                        placeholder={t('catalog.omnibus.settings.selectChannel', 'Select channel to configure…')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET_OPTION_VALUE}>
                        {t('catalog.omnibus.settings.selectChannel', 'Select channel to configure…')}
                      </SelectItem>
                      {assignableChannels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            {staleBackfillChannels.length > 0 ? (
              <Alert status="warning" style="lighter">
                <AlertDescription>
                  {t(
                    'catalog.omnibus.settings.backfillCoverageWarning',
                    'The lookback window is longer than the history backfilled for {channels}. The reference price will report insufficient history until the backfill is re-run for those channels.',
                    { channels: staleBackfillChannels.join(', ') },
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving
              ? t('catalog.omnibus.settings.saving', 'Saving…')
              : t('catalog.omnibus.settings.save', 'Save')}
          </Button>
        </div>
      </form>
    </section>
  )
}
