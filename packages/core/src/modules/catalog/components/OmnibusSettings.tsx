"use client"

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'

type ChannelConfig = {
  presentedPriceKindId?: string
  countryCode?: string
  lookbackDays?: number
  minimizationAxis?: 'gross' | 'net'
  progressiveReductionRule?: boolean
  perishableGoodsRule?: 'standard' | 'exempt' | 'last_price'
  newArrivalRule?: 'standard' | 'shorter_window'
  newArrivalsLookbackDays?: number | null
}

type OmnibusConfig = {
  enabled?: boolean
  enabledCountryCodes?: string[]
  noChannelMode?: 'best_effort' | 'require_channel'
  lookbackDays?: number
  minimizationAxis?: 'gross' | 'net'
  defaultPresentedPriceKindId?: string
  backfillCoverage?: Record<string, { completedAt: string; lookbackDays: number }>
  channels?: Record<string, ChannelConfig>
}

type PriceKind = {
  id: string
  code: string
  title: string
}

export function OmnibusSettings() {
  const t = useT()
  const [config, setConfig] = React.useState<OmnibusConfig | null>(null)
  const [priceKinds, setPriceKinds] = React.useState<PriceKind[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState<OmnibusConfig>({})

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      readApiResultOrThrow<OmnibusConfig>('/api/catalog/config/omnibus'),
      readApiResultOrThrow<{ items?: PriceKind[] }>('/api/catalog/price-kinds'),
    ]).then(([cfg, pk]) => {
      if (cancelled) return
      const cfgData = cfg ?? {}
      setConfig(cfgData)
      setForm(cfgData)
      setPriceKinds(pk?.items ?? [])
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await apiCallOrThrow('/api/catalog/config/omnibus', {
        method: 'PATCH',
        body: JSON.stringify(form),
        headers: { 'Content-Type': 'application/json' },
      })
      const data = res.result as OmnibusConfig ?? {}
      setConfig(data)
      setForm(data)
      flash(t('catalog.omnibus.settings.saved', 'Omnibus settings saved'), 'success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('catalog.omnibus.settings.saveError', 'Failed to save settings')
      flash(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingMessage label={t('catalog.omnibus.settings.loading', 'Loading Omnibus settings...')} />

  const backfillWarningChannels = Object.entries(form.channels ?? {}).filter(([id, ch]) => {
    const channelLookbackDays = ch.lookbackDays ?? form.lookbackDays ?? 30
    const coverage = form.backfillCoverage?.[id]
    return coverage && coverage.lookbackDays < channelLookbackDays
  })

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-4">{t('catalog.omnibus.settings.title', 'Omnibus Price Tracking')}</h2>

        <div className="flex items-center gap-3 mb-4">
          <Switch
            id="omnibus-enabled"
            checked={form.enabled ?? false}
            onCheckedChange={(v: boolean) => setForm((f) => ({ ...f, enabled: v }))}
          />
          <Label htmlFor="omnibus-enabled">{t('catalog.omnibus.settings.enabled', 'Enable Omnibus compliance')}</Label>
        </div>

        {form.enabled && (
          <div className="space-y-4 pl-2 border-l-2 border-muted">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="lookback-days">{t('catalog.omnibus.settings.lookbackDays', 'Lookback window (days)')}</Label>
                <Input
                  id="lookback-days"
                  type="number"
                  min={1}
                  max={365}
                  value={form.lookbackDays ?? 30}
                  onChange={(e) => setForm((f) => ({ ...f, lookbackDays: parseInt(e.target.value, 10) || 30 }))}
                />
              </div>

              <div>
                <Label htmlFor="no-channel-mode">{t('catalog.omnibus.settings.noChannelMode', 'Channels without context')}</Label>
                <select
                  id="no-channel-mode"
                  className="w-full rounded border px-2 py-1.5 text-sm"
                  value={form.noChannelMode ?? 'best_effort'}
                  onChange={(e) => setForm((f) => ({ ...f, noChannelMode: e.target.value as 'best_effort' | 'require_channel' }))}
                >
                  <option value="best_effort">{t('catalog.omnibus.settings.noChannelMode.bestEffort', 'Best effort (blend all channels)')}</option>
                  <option value="require_channel">{t('catalog.omnibus.settings.noChannelMode.requireChannel', 'Require channel (fail closed)')}</option>
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="default-price-kind">{t('catalog.omnibus.settings.presentedPriceKind', 'Default presented price kind')}</Label>
              <select
                id="default-price-kind"
                className="w-full rounded border px-2 py-1.5 text-sm"
                value={form.defaultPresentedPriceKindId ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, defaultPresentedPriceKindId: e.target.value || undefined }))}
              >
                <option value="">{t('catalog.omnibus.settings.selectPriceKind', 'Select price kind...')}</option>
                {priceKinds.map((pk) => (
                  <option key={pk.id} value={pk.id}>{pk.title} ({pk.code})</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="enabled-country-codes">{t('catalog.omnibus.settings.enabledCountryCodes', 'Active in EU markets')}</Label>
              <Input
                id="enabled-country-codes"
                value={(form.enabledCountryCodes ?? []).join(', ')}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  enabledCountryCodes: e.target.value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
                }))}
                placeholder="DE, FR, PL, IT, ES..."
              />
            </div>

            {Object.keys(form.channels ?? {}).length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">{t('catalog.omnibus.settings.channelOverrides', 'Per-channel overrides')}</h3>
                <div className="space-y-4">
                  {Object.entries(form.channels ?? {}).map(([channelId, ch]) => (
                    <div key={channelId} className="rounded-lg border p-3 space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">{t('catalog.omnibus.settings.channelOverrides', 'Channel')}: {channelId}</p>

                      <div className="flex items-center gap-2">
                        <Switch
                          id={`progressive-${channelId}`}
                          checked={ch.progressiveReductionRule ?? false}
                          onCheckedChange={(v: boolean) => setForm((f) => ({
                            ...f,
                            channels: { ...f.channels, [channelId]: { ...ch, progressiveReductionRule: v } },
                          }))}
                        />
                        <Label htmlFor={`progressive-${channelId}`} className="text-xs">
                          {t('catalog.omnibus.settings.progressiveReductionRule', 'Progressive reduction rule (Art. 6a(5))')}
                        </Label>
                      </div>

                      <div>
                        <Label htmlFor={`perishable-${channelId}`} className="text-xs">
                          {t('catalog.omnibus.settings.perishableGoodsRule', 'Perishable goods rule')}
                        </Label>
                        <select
                          id={`perishable-${channelId}`}
                          className="w-full rounded border px-2 py-1.5 text-sm mt-1"
                          value={ch.perishableGoodsRule ?? 'standard'}
                          onChange={(e) => setForm((f) => ({
                            ...f,
                            channels: { ...f.channels, [channelId]: { ...ch, perishableGoodsRule: e.target.value as 'standard' | 'exempt' | 'last_price' } },
                          }))}
                        >
                          <option value="standard">Standard</option>
                          <option value="exempt">Exempt</option>
                          <option value="last_price">Use last price</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor={`new-arrival-${channelId}`} className="text-xs">
                            {t('catalog.omnibus.settings.newArrivalRule', 'New arrivals rule')}
                          </Label>
                          <select
                            id={`new-arrival-${channelId}`}
                            className="w-full rounded border px-2 py-1.5 text-sm mt-1"
                            value={ch.newArrivalRule ?? 'standard'}
                            onChange={(e) => setForm((f) => ({
                              ...f,
                              channels: { ...f.channels, [channelId]: { ...ch, newArrivalRule: e.target.value as 'standard' | 'shorter_window' } },
                            }))}
                          >
                            <option value="standard">Standard</option>
                            <option value="shorter_window">Shorter window</option>
                          </select>
                        </div>
                        {ch.newArrivalRule === 'shorter_window' && (
                          <div>
                            <Label htmlFor={`new-arrival-days-${channelId}`} className="text-xs">
                              {t('catalog.omnibus.settings.newArrivalsLookbackDays', 'New arrival window (days)')}
                            </Label>
                            <Input
                              id={`new-arrival-days-${channelId}`}
                              type="number"
                              min={1}
                              max={365}
                              className="mt-1"
                              value={ch.newArrivalsLookbackDays ?? ''}
                              onChange={(e) => setForm((f) => ({
                                ...f,
                                channels: { ...f.channels, [channelId]: { ...ch, newArrivalsLookbackDays: parseInt(e.target.value, 10) || null } },
                              }))}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {backfillWarningChannels.length > 0 && (
              <Alert>
                <AlertDescription>
                  {t('catalog.omnibus.settings.backfillCoverageWarning', 'Lookback days increased since last backfill — consider rerunning backfill for affected channels.')}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>

      <Button type="submit" disabled={saving}>
        {saving ? t('catalog.omnibus.settings.saving', 'Saving...') : t('catalog.omnibus.settings.save', 'Save')}
      </Button>
    </form>
  )
}
