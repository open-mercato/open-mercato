"use client"

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { TagInput } from '@open-mercato/ui/primitives/tag-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type {
  OmnibusConfig,
  OmnibusMinimizationAxis,
  OmnibusNoChannelMode,
} from '../lib/omnibusTypes'
import { PriceChannelSelect, PricePriceKindSelect } from './prices/PriceScopeSelectors'

const logger = createLogger('catalog').child({ component: 'OmnibusSettings' })

const OMNIBUS_CONFIG_PATH = '/api/catalog/config/omnibus'
const MUTATION_CONTEXT_ID = 'catalog-omnibus-settings'
const DEFAULT_LOOKBACK_DAYS = 30
const MIN_LOOKBACK_DAYS = 1
const MAX_LOOKBACK_DAYS = 365
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/

type StoredOmnibusConfig = Partial<OmnibusConfig>

type ChannelAxisValue = OmnibusMinimizationAxis | 'inherit'

type OmnibusChannelRow = {
  key: string
  channelId: string
  presentedPriceKindId: string
  countryCode: string
  lookbackDays: string
  minimizationAxis: ChannelAxisValue
}

type OmnibusFormState = {
  enabled: boolean
  lookbackDays: string
  enabledCountryCodes: string[]
  noChannelMode: OmnibusNoChannelMode
  minimizationAxis: OmnibusMinimizationAxis
  defaultPresentedPriceKindId: string
  channels: OmnibusChannelRow[]
}

type OmnibusChannelPatch = {
  presentedPriceKindId: string
  countryCode?: string
  lookbackDays?: number
  minimizationAxis?: OmnibusMinimizationAxis
}

type OmnibusConfigPatchBody = {
  enabled: boolean
  lookbackDays: number
  enabledCountryCodes: string[]
  noChannelMode: OmnibusNoChannelMode
  minimizationAxis: OmnibusMinimizationAxis
  defaultPresentedPriceKindId: string | null
  channels: Record<string, OmnibusChannelPatch>
}

type FieldErrors = Record<string, string>

type OmnibusMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type OmnibusErrorBody = {
  error?: unknown
  field?: unknown
  channels?: unknown
  details?: { fieldErrors?: Record<string, unknown> } | null
}

class OmnibusSaveError extends Error {
  readonly status: number
  readonly body: OmnibusErrorBody | null

  constructor(status: number, body: OmnibusErrorBody | null) {
    super(`[internal] catalog omnibus config save failed with status ${status}`)
    this.status = status
    this.body = body
  }
}

let rowSequence = 0

function nextRowKey(): string {
  rowSequence += 1
  return `omnibus-channel-${rowSequence}`
}

function toFormState(config: StoredOmnibusConfig | null): OmnibusFormState {
  const channels = Object.entries(config?.channels ?? {}).map(([channelId, channel]): OmnibusChannelRow => ({
    key: nextRowKey(),
    channelId,
    presentedPriceKindId: channel.presentedPriceKindId ?? '',
    countryCode: channel.countryCode ?? '',
    lookbackDays: typeof channel.lookbackDays === 'number' ? String(channel.lookbackDays) : '',
    minimizationAxis: channel.minimizationAxis ?? 'inherit',
  }))
  return {
    enabled: config?.enabled === true,
    lookbackDays: String(config?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS),
    enabledCountryCodes: Array.isArray(config?.enabledCountryCodes) ? [...config.enabledCountryCodes] : [],
    noChannelMode: config?.noChannelMode ?? 'best_effort',
    minimizationAxis: config?.minimizationAxis ?? 'gross',
    defaultPresentedPriceKindId: config?.defaultPresentedPriceKindId ?? '',
    channels,
  }
}

function parseLookbackDays(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < MIN_LOOKBACK_DAYS || value > MAX_LOOKBACK_DAYS) return null
  return value
}

function channelErrorKey(rowKey: string, field: string): string {
  return `channels.${rowKey}.${field}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStoredConfig(value: unknown): StoredOmnibusConfig | null {
  return isRecord(value) ? (value as StoredOmnibusConfig) : null
}

function listStaleBackfillScopes(stored: StoredOmnibusConfig | null, form: OmnibusFormState): string[] {
  const coverage = stored?.backfillCoverage ?? {}
  const globalLookback = parseLookbackDays(form.lookbackDays)
  if (globalLookback === null) return []
  const channelLookbacks = new Map(
    form.channels
      .filter((row) => row.channelId)
      .map((row) => [row.channelId, parseLookbackDays(row.lookbackDays) ?? globalLookback]),
  )
  return Object.entries(coverage)
    .filter(([scopeId, entry]) => {
      const effective = scopeId ? channelLookbacks.get(scopeId) ?? globalLookback : globalLookback
      return entry.lookbackDays < effective
    })
    .map(([scopeId]) => scopeId)
    .sort()
}

export function OmnibusSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const grantedFeatures = chromePayload?.grantedFeatures
  const canManage = hasFeature(grantedFeatures, 'catalog.settings.manage')
  const canView = canManage || hasFeature(grantedFeatures, 'catalog.settings.view')

  const [stored, setStored] = React.useState<StoredOmnibusConfig | null>(null)
  const [form, setForm] = React.useState<OmnibusFormState>(() => toFormState(null))
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [backfillChannels, setBackfillChannels] = React.useState<string[] | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const { runMutation, retryLastMutation } = useGuardedMutation<OmnibusMutationContext>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const readOnly = !canManage || saving

  const errorMessages = React.useMemo<Record<string, string>>(() => ({
    omnibus_country_code_alpha2_required: t('catalog.omnibus.errors.countryCodeFormat', 'Use a two-letter ISO country code.'),
    omnibus_country_code_eu_not_allowed: t('catalog.omnibus.errors.countryCodeEu', 'List individual member states instead of "EU".'),
    omnibus_country_code_unknown: t('catalog.omnibus.errors.countryCodeUnknown', 'Unknown country code.'),
    omnibus_presented_price_kind_required: t('catalog.omnibus.errors.presentedPriceKindRequired', 'Select a default presented price kind, or configure a channel with its own price kind.'),
    omnibus_field_not_supported: t('catalog.omnibus.errors.fieldNotSupported', 'This setting is not supported.'),
    omnibus_derogation_not_supported: t('catalog.omnibus.errors.fieldNotSupported', 'This setting is not supported.'),
    omnibus_backfill_coverage_read_only: t('catalog.omnibus.errors.fieldNotSupported', 'This setting is not supported.'),
  }), [t])
  const invalidValueMessage = t('catalog.omnibus.errors.invalidValue', 'Invalid value.')
  const lookbackRangeMessage = t('catalog.omnibus.errors.lookbackRange', 'Enter a whole number of days between 1 and 365.')
  const requiredMessage = t('catalog.omnibus.errors.required', 'This field is required.')
  const duplicateChannelMessage = t('catalog.omnibus.errors.duplicateChannel', 'This channel is already configured.')
  const saveErrorMessage = t('catalog.omnibus.errors.save', 'Failed to save Omnibus settings.')
  const loadErrorMessage = t('catalog.omnibus.errors.load', 'Failed to load Omnibus settings.')

  React.useEffect(() => {
    if (!chromeReady || !canView) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    apiCall<unknown>(OMNIBUS_CONFIG_PATH)
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setLoadError(loadErrorMessage)
          return
        }
        const config = asStoredConfig(call.result)
        setStored(config)
        setForm(toFormState(config))
        setFieldErrors({})
        setFormError(null)
        setBackfillChannels(null)
      })
      .catch((err) => {
        logger.error('catalog.omnibus.settings.load failed', { err })
        if (!cancelled) setLoadError(loadErrorMessage)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canView, chromeReady, loadErrorMessage, reloadToken, scopeVersion])

  const translateServerError = React.useCallback(
    (messages: unknown): string => {
      const first = Array.isArray(messages) ? messages.find((entry) => typeof entry === 'string') : null
      if (typeof first !== 'string') return invalidValueMessage
      return errorMessages[first] ?? invalidValueMessage
    },
    [errorMessages, invalidValueMessage],
  )

  const mapServerFieldErrors = React.useCallback(
    (raw: Record<string, unknown>): { fields: FieldErrors; unmatched: string | null } => {
      const fields: FieldErrors = {}
      let unmatched: string | null = null
      for (const [path, messages] of Object.entries(raw)) {
        const message = translateServerError(messages)
        const segments = path.split('.')
        const head = segments[0]
        if (head === 'channels' && segments.length >= 2) {
          const row = form.channels.find((entry) => entry.channelId === segments[1])
          const field = segments[2] ?? 'channelId'
          if (row) {
            fields[channelErrorKey(row.key, field)] = message
            continue
          }
        } else if (head && head !== '_root' && head in form) {
          fields[head] = fields[head] ?? message
          continue
        }
        unmatched = unmatched ?? message
      }
      return { fields, unmatched }
    },
    [form, translateServerError],
  )

  const buildPatch = React.useCallback((): { patch: OmnibusConfigPatchBody | null; errors: FieldErrors } => {
    const errors: FieldErrors = {}
    const lookbackDays = parseLookbackDays(form.lookbackDays)
    if (lookbackDays === null) errors.lookbackDays = lookbackRangeMessage
    const channels: Record<string, OmnibusChannelPatch> = {}
    for (const row of form.channels) {
      const channelId = row.channelId.trim()
      if (!channelId) {
        errors[channelErrorKey(row.key, 'channelId')] = requiredMessage
      } else if (channels[channelId]) {
        errors[channelErrorKey(row.key, 'channelId')] = duplicateChannelMessage
      }
      if (!row.presentedPriceKindId) errors[channelErrorKey(row.key, 'presentedPriceKindId')] = requiredMessage
      const countryCode = row.countryCode.trim().toUpperCase()
      if (countryCode && !COUNTRY_CODE_PATTERN.test(countryCode)) {
        errors[channelErrorKey(row.key, 'countryCode')] = errorMessages.omnibus_country_code_alpha2_required
      }
      const channelLookback = row.lookbackDays.trim() ? parseLookbackDays(row.lookbackDays) : undefined
      if (channelLookback === null) errors[channelErrorKey(row.key, 'lookbackDays')] = lookbackRangeMessage
      if (!channelId || channels[channelId]) continue
      channels[channelId] = {
        presentedPriceKindId: row.presentedPriceKindId,
        ...(countryCode ? { countryCode } : {}),
        ...(typeof channelLookback === 'number' ? { lookbackDays: channelLookback } : {}),
        ...(row.minimizationAxis !== 'inherit' ? { minimizationAxis: row.minimizationAxis } : {}),
      }
    }
    if (Object.keys(errors).length > 0 || lookbackDays === null) return { patch: null, errors }
    return {
      patch: {
        enabled: form.enabled,
        lookbackDays,
        enabledCountryCodes: form.enabledCountryCodes,
        noChannelMode: form.noChannelMode,
        minimizationAxis: form.minimizationAxis,
        defaultPresentedPriceKindId: form.defaultPresentedPriceKindId || null,
        channels,
      },
      errors,
    }
  }, [duplicateChannelMessage, errorMessages, form, lookbackRangeMessage, requiredMessage])

  const handleSubmit = React.useCallback(async () => {
    if (!canManage || saving) return
    const { patch, errors } = buildPatch()
    setFormError(null)
    setBackfillChannels(null)
    setFieldErrors(errors)
    if (!patch) return
    setSaving(true)
    try {
      const saved = await runMutation({
        operation: async () => {
          // optimistic-lock-exempt: single tenant-scoped Omnibus config blob merged server-side; no per-record version to compare
          const call = await apiCall<unknown>(OMNIBUS_CONFIG_PATH, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
          if (!call.ok) {
            throw new OmnibusSaveError(call.status, isRecord(call.result) ? (call.result as OmnibusErrorBody) : null)
          }
          return asStoredConfig(call.result)
        },
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: 'catalog.settings',
          resourceId: 'omnibus',
          retryLastMutation,
        },
        mutationPayload: patch,
      })
      setStored(saved)
      setForm(toFormState(saved))
      setFieldErrors({})
      flash(t('catalog.omnibus.messages.saved', 'Omnibus settings saved.'), 'success')
    } catch (err) {
      if (err instanceof OmnibusSaveError) {
        const body = err.body
        if (err.status === 422 && body?.error === 'backfill_required_before_enable') {
          const channels = Array.isArray(body.channels)
            ? body.channels.filter((entry): entry is string => typeof entry === 'string')
            : []
          setBackfillChannels(channels)
          return
        }
        const detailFieldErrors = body?.details?.fieldErrors
        const rawFieldErrors = isRecord(detailFieldErrors) ? detailFieldErrors : null
        if (err.status === 400 && rawFieldErrors) {
          const mapped = mapServerFieldErrors(rawFieldErrors)
          setFieldErrors(mapped.fields)
          setFormError(mapped.unmatched ?? t('catalog.omnibus.errors.invalid', 'Fix the highlighted fields and try again.'))
          return
        }
        setFormError(saveErrorMessage)
        return
      }
      logger.error('catalog.omnibus.settings.save failed', { err })
      setFormError(err instanceof Error && !err.message.startsWith('[internal]') ? err.message : saveErrorMessage)
    } finally {
      setSaving(false)
    }
  }, [buildPatch, canManage, mapServerFieldErrors, retryLastMutation, runMutation, saveErrorMessage, saving, t])

  const handleCancel = React.useCallback(() => {
    setForm(toFormState(stored))
    setFieldErrors({})
    setFormError(null)
    setBackfillChannels(null)
  }, [stored])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLFormElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmit()
        return
      }
      if (event.key === 'Escape' && !event.defaultPrevented && canManage) {
        event.preventDefault()
        handleCancel()
      }
    },
    [canManage, handleCancel, handleSubmit],
  )

  const updateForm = React.useCallback((patch: Partial<OmnibusFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const updateChannel = React.useCallback((rowKey: string, patch: Partial<OmnibusChannelRow>) => {
    setForm((prev) => ({
      ...prev,
      channels: prev.channels.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)),
    }))
  }, [])

  const addChannel = React.useCallback(() => {
    setForm((prev) => ({
      ...prev,
      channels: [
        ...prev.channels,
        { key: nextRowKey(), channelId: '', presentedPriceKindId: '', countryCode: '', lookbackDays: '', minimizationAxis: 'inherit' },
      ],
    }))
  }, [])

  const removeChannel = React.useCallback((rowKey: string) => {
    setForm((prev) => ({ ...prev, channels: prev.channels.filter((row) => row.key !== rowKey) }))
  }, [])

  const staleBackfillScopes = React.useMemo(() => listStaleBackfillScopes(stored, form), [form, stored])

  const formatScope = React.useCallback(
    (scopeId: string) => (scopeId ? scopeId : t('catalog.omnibus.settings.backfill.globalScope', 'All channels (unscoped)')),
    [t],
  )

  if (!chromeReady) {
    return <LoadingMessage label={t('catalog.omnibus.settings.loading', 'Loading Omnibus settings…')} />
  }
  if (!canView) return null

  const noChannelModeLabels: Record<OmnibusNoChannelMode, string> = {
    best_effort: t('catalog.omnibus.settings.noChannelMode.bestEffort', 'Best effort (use global settings)'),
    require_channel: t('catalog.omnibus.settings.noChannelMode.requireChannel', 'Require a channel'),
  }
  const axisLabels: Record<OmnibusMinimizationAxis, string> = {
    gross: t('catalog.omnibus.settings.axis.gross', 'Gross (B2C)'),
    net: t('catalog.omnibus.settings.axis.net', 'Net (B2B)'),
  }

  return (
    <section className="border bg-card text-card-foreground shadow-sm" data-testid="catalog-omnibus-settings">
      <div className="border-b px-6 py-4 space-y-1">
        <h2 className="text-lg font-semibold">{t('catalog.omnibus.settings.title', 'Omnibus price tracking')}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            'catalog.omnibus.settings.description',
            'Show the lowest price from the lookback period next to announced price reductions (EU Directive 2019/2161).',
          )}
        </p>
      </div>
      <div className="px-6 py-4">
        {loading ? (
          <LoadingMessage label={t('catalog.omnibus.settings.loading', 'Loading Omnibus settings…')} />
        ) : loadError ? (
          <ErrorMessage
            label={loadError}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadToken((token) => token + 1)}>
                {t('catalog.omnibus.settings.actions.retry', 'Retry')}
              </Button>
            )}
          />
        ) : (
          <form
            className="space-y-6"
            noValidate
            onKeyDown={handleKeyDown}
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            {!canManage ? (
              <Alert status="information">
                <AlertDescription>
                  {t('catalog.omnibus.settings.readOnly', 'You can view these settings but not change them.')}
                </AlertDescription>
              </Alert>
            ) : null}
            {backfillChannels ? (
              <Alert status="error" data-testid="catalog-omnibus-backfill-required">
                <AlertTitle>{t('catalog.omnibus.settings.backfill.requiredTitle', 'Backfill required before enabling')}</AlertTitle>
                <AlertDescription>
                  <p>
                    {t(
                      'catalog.omnibus.settings.backfill.requiredDescription',
                      'Price history must be backfilled for every in-scope EU channel before Omnibus can be enabled. Run "mercato catalog omnibus:backfill --tenant <tenantId>" (add "--channel-id <channelId>" per channel), then save again.',
                    )}
                  </p>
                  {backfillChannels.length > 0 ? (
                    <p className="mt-1">
                      {t('catalog.omnibus.settings.backfill.channels', 'Channels without backfill: {{channels}}', {
                        channels: backfillChannels.join(', '),
                      })}
                    </p>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            {staleBackfillScopes.length > 0 ? (
              <Alert status="warning" data-testid="catalog-omnibus-backfill-stale">
                <AlertTitle>{t('catalog.omnibus.settings.backfill.staleTitle', 'Lookback increased since the last backfill')}</AlertTitle>
                <AlertDescription>
                  {t(
                    'catalog.omnibus.settings.backfill.staleDescription',
                    'Re-run the backfill so the longer window has baseline history: {{scopes}}',
                    { scopes: staleBackfillScopes.map(formatScope).join(', ') },
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {formError ? <ErrorMessage label={formError} /> : null}

            <SwitchField
              label={t('catalog.omnibus.settings.enabled', 'Enable Omnibus reference prices')}
              description={t(
                'catalog.omnibus.settings.enabledDescription',
                'When enabled, products in EU channels expose the lowest price from the lookback window.',
              )}
              checked={form.enabled}
              disabled={readOnly}
              onCheckedChange={(next) => updateForm({ enabled: next })}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                label={t('catalog.omnibus.settings.lookbackDays', 'Lookback window (days)')}
                description={t('catalog.omnibus.settings.lookbackDaysDescription', 'Between 1 and 365 days. The directive requires at least 30.')}
                error={fieldErrors.lookbackDays}
                required
                disabled={readOnly}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={MIN_LOOKBACK_DAYS}
                  max={MAX_LOOKBACK_DAYS}
                  value={form.lookbackDays}
                  onChange={(event) => updateForm({ lookbackDays: event.target.value })}
                  data-testid="catalog-omnibus-lookback"
                />
              </FormField>
              <FormField
                label={t('catalog.omnibus.settings.enabledCountryCodes', 'EU member states')}
                description={t(
                  'catalog.omnibus.settings.enabledCountryCodesDescription',
                  'Two-letter ISO codes of the member states where Omnibus applies. Leave empty to disable it for every channel.',
                )}
                error={fieldErrors.enabledCountryCodes}
                disabled={readOnly}
              >
                <TagInput
                  value={form.enabledCountryCodes}
                  onChange={(next) => updateForm({ enabledCountryCodes: Array.from(new Set(next.map((code) => code.trim().toUpperCase()))) })}
                  validate={(tag) => {
                    const code = tag.trim().toUpperCase()
                    if (code === 'EU') return errorMessages.omnibus_country_code_eu_not_allowed
                    return COUNTRY_CODE_PATTERN.test(code) || errorMessages.omnibus_country_code_alpha2_required
                  }}
                  placeholder={t('catalog.omnibus.settings.enabledCountryCodesPlaceholder', 'e.g. PL, DE')}
                  aria-label={t('catalog.omnibus.settings.enabledCountryCodes', 'EU member states')}
                  removeTagLabel={(tag) => t('catalog.omnibus.settings.removeCountry', 'Remove {{code}}', { code: tag })}
                  disabled={readOnly}
                />
              </FormField>
              <FormField
                label={t('catalog.omnibus.settings.noChannelModeLabel', 'Requests without a channel')}
                error={fieldErrors.noChannelMode}
                disabled={readOnly}
              >
                <Select
                  value={form.noChannelMode}
                  onValueChange={(next) => updateForm({ noChannelMode: next as OmnibusNoChannelMode })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue>{noChannelModeLabels[form.noChannelMode]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(noChannelModeLabels) as OmnibusNoChannelMode[]).map((mode) => (
                      <SelectItem key={mode} value={mode}>{noChannelModeLabels[mode]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                label={t('catalog.omnibus.settings.minimizationAxis', 'Compare prices by')}
                error={fieldErrors.minimizationAxis}
                disabled={readOnly}
              >
                <Select
                  value={form.minimizationAxis}
                  onValueChange={(next) => updateForm({ minimizationAxis: next as OmnibusMinimizationAxis })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue>{axisLabels[form.minimizationAxis]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(axisLabels) as OmnibusMinimizationAxis[]).map((axis) => (
                      <SelectItem key={axis} value={axis}>{axisLabels[axis]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <div className="space-y-1 md:col-span-2">
                <p className="text-sm font-medium">{t('catalog.omnibus.settings.defaultPresentedPriceKind', 'Default presented price kind')}</p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'catalog.omnibus.settings.defaultPresentedPriceKindDescription',
                    'The price kind shown to shoppers, used when a channel has no override. Required when Omnibus is enabled without channel overrides.',
                  )}
                </p>
                <PricePriceKindSelect
                  value={form.defaultPresentedPriceKindId}
                  onChange={(next) => updateForm({ defaultPresentedPriceKindId: next })}
                  disabled={readOnly}
                  clearable
                />
                {fieldErrors.defaultPresentedPriceKindId ? (
                  <p className="text-xs text-status-error-text" role="alert">{fieldErrors.defaultPresentedPriceKindId}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">{t('catalog.omnibus.settings.channels.title', 'Channel overrides')}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'catalog.omnibus.settings.channels.description',
                      'Map sales channels to a member state and override the presented price kind, lookback or comparison axis per channel.',
                    )}
                  </p>
                </div>
                {canManage ? (
                  <Button type="button" variant="outline" size="sm" onClick={addChannel} disabled={saving}>
                    <Plus className="size-4" aria-hidden />
                    {t('catalog.omnibus.settings.channels.add', 'Add channel')}
                  </Button>
                ) : null}
              </div>
              {form.channels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('catalog.omnibus.settings.channels.empty', 'No channel overrides. Global settings apply to every channel.')}
                </p>
              ) : (
                form.channels.map((row) => {
                  const rowError = (field: string) => fieldErrors[channelErrorKey(row.key, field)]
                  return (
                    <div key={row.key} className="space-y-3 rounded-md border p-4" data-testid="catalog-omnibus-channel-row">
                      <div className="flex items-start justify-between gap-2">
                        <div className="grid flex-1 gap-4 md:grid-cols-2">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{t('catalog.omnibus.settings.channels.channel', 'Channel')}</p>
                            <PriceChannelSelect
                              value={row.channelId}
                              onChange={(next) => updateChannel(row.key, { channelId: next })}
                              disabled={readOnly}
                            />
                            {rowError('channelId') ? (
                              <p className="text-xs text-status-error-text" role="alert">{rowError('channelId')}</p>
                            ) : null}
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{t('catalog.omnibus.settings.channels.presentedPriceKind', 'Presented price kind')}</p>
                            <PricePriceKindSelect
                              value={row.presentedPriceKindId}
                              onChange={(next) => updateChannel(row.key, { presentedPriceKindId: next })}
                              disabled={readOnly}
                            />
                            {rowError('presentedPriceKindId') ? (
                              <p className="text-xs text-status-error-text" role="alert">{rowError('presentedPriceKindId')}</p>
                            ) : null}
                          </div>
                          <FormField
                            label={t('catalog.omnibus.settings.channels.countryCode', 'Member state')}
                            description={t('catalog.omnibus.settings.channels.countryCodeDescription', 'Leave empty for non-EU channels.')}
                            error={rowError('countryCode')}
                            disabled={readOnly}
                          >
                            <Input
                              value={row.countryCode}
                              maxLength={2}
                              onChange={(event) => updateChannel(row.key, { countryCode: event.target.value.toUpperCase() })}
                              placeholder={t('catalog.omnibus.settings.channels.countryCodePlaceholder', 'e.g. PL')}
                            />
                          </FormField>
                          <FormField
                            label={t('catalog.omnibus.settings.channels.lookbackDays', 'Lookback override (days)')}
                            description={t('catalog.omnibus.settings.channels.lookbackDaysDescription', 'Leave empty to use the global window.')}
                            error={rowError('lookbackDays')}
                            disabled={readOnly}
                          >
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={MIN_LOOKBACK_DAYS}
                              max={MAX_LOOKBACK_DAYS}
                              value={row.lookbackDays}
                              onChange={(event) => updateChannel(row.key, { lookbackDays: event.target.value })}
                            />
                          </FormField>
                          <FormField
                            label={t('catalog.omnibus.settings.channels.minimizationAxis', 'Compare prices by')}
                            error={rowError('minimizationAxis')}
                            disabled={readOnly}
                          >
                            <Select
                              value={row.minimizationAxis}
                              onValueChange={(next) => updateChannel(row.key, { minimizationAxis: next as ChannelAxisValue })}
                              disabled={readOnly}
                            >
                              <SelectTrigger>
                                <SelectValue>
                                  {row.minimizationAxis === 'inherit'
                                    ? t('catalog.omnibus.settings.channels.axisInherit', 'Use global setting')
                                    : axisLabels[row.minimizationAxis]}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="inherit">
                                  {t('catalog.omnibus.settings.channels.axisInherit', 'Use global setting')}
                                </SelectItem>
                                {(Object.keys(axisLabels) as OmnibusMinimizationAxis[]).map((axis) => (
                                  <SelectItem key={axis} value={axis}>{axisLabels[axis]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormField>
                        </div>
                        {canManage ? (
                          <IconButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t('catalog.omnibus.settings.channels.remove', 'Remove channel override')}
                            onClick={() => removeChannel(row.key)}
                            disabled={saving}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </IconButton>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {canManage ? (
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCancel} disabled={saving}>
                  {t('catalog.omnibus.settings.actions.cancel', 'Cancel')}
                </Button>
                <Button type="submit" disabled={saving} data-testid="catalog-omnibus-save">
                  {saving
                    ? t('catalog.omnibus.settings.actions.saving', 'Saving…')
                    : t('catalog.omnibus.settings.actions.save', 'Save')}
                </Button>
              </div>
            ) : null}
          </form>
        )}
      </div>
    </section>
  )
}
