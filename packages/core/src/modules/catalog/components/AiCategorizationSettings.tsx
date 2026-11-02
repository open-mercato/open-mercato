"use client"

import * as React from 'react'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog')

type AiCategorizationSettingsValue = {
  enabled: boolean
  applyMode: 'suggest' | 'auto_apply'
  autoApplyThreshold: number
  autoSuggestOnCreate: boolean
}

type AiCategorizationSettingsResponse = {
  settings?: AiCategorizationSettingsValue
  available?: boolean
  reason?: string
  effective?: boolean
}

const THRESHOLD_MIN = 0.5
const THRESHOLD_MAX = 0.99

function parseThreshold(raw: string): number | null {
  const parsed = Number(raw.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < THRESHOLD_MIN || parsed > THRESHOLD_MAX) return null
  return Math.round(parsed * 100) / 100
}

const DEFAULT_SETTINGS: AiCategorizationSettingsValue = {
  enabled: false,
  applyMode: 'suggest',
  autoApplyThreshold: 0.85,
  autoSuggestOnCreate: false,
}

function reasonHint(t: TranslateFn, reason: string | null | undefined): string {
  switch (reason) {
    case 'not_installed':
      return t(
        'catalog.settings.aiCategorization.reasons.notInstalled',
        'The AI assistant module is not installed.',
      )
    case 'not_configured':
      return t(
        'catalog.settings.aiCategorization.reasons.notConfigured',
        'No decision model provider is configured. Set OM_DECISION_PROVIDER and OM_DECISION_MODEL (optionally OM_DECISION_CATALOG_MODEL for catalog only).',
      )
    case 'unknown_provider':
      return t(
        'catalog.settings.aiCategorization.reasons.unknownProvider',
        'OM_DECISION_PROVIDER names a provider that is not registered.',
      )
    case 'fixture_disabled':
      return t(
        'catalog.settings.aiCategorization.reasons.fixtureDisabled',
        'The fixture decision provider is not enabled for this environment.',
      )
    case 'credentials_missing':
      return t(
        'catalog.settings.aiCategorization.reasons.credentialsMissing',
        'The configured decision provider is missing credentials.',
      )
    case 'model_missing':
      return t(
        'catalog.settings.aiCategorization.reasons.modelMissing',
        'No model is configured. Set OM_DECISION_MODEL or OM_DECISION_CATALOG_MODEL.',
      )
    default:
      return t(
        'catalog.settings.aiCategorization.reasons.generic',
        'AI category suggestions are currently unavailable.',
      )
  }
}

export function AiCategorizationSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [settings, setSettings] = React.useState<AiCategorizationSettingsValue | null>(null)
  const [available, setAvailable] = React.useState(false)
  const [reason, setReason] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [thresholdDraft, setThresholdDraft] = React.useState('')
  const [thresholdInvalid, setThresholdInvalid] = React.useState(false)

  const loadError = t('catalog.settings.aiCategorization.errors.load', 'Failed to load AI categorization settings.')

  const load = React.useCallback(async () => {
    try {
      const payload = await readApiResultOrThrow<AiCategorizationSettingsResponse>(
        '/api/catalog/ai-categorization/settings',
        undefined,
        { errorMessage: loadError, fallback: { settings: DEFAULT_SETTINGS, available: false } },
      )
      const loaded = payload.settings ?? DEFAULT_SETTINGS
      setSettings(loaded)
      setThresholdDraft(String(loaded.autoApplyThreshold))
      setAvailable(payload.available === true)
      setReason(payload.reason ?? null)
    } catch (err) {
      logger.error('catalog.ai_categorization.settings.load failed', { err })
      flash(loadError, 'error')
      setSettings(DEFAULT_SETTINGS)
      setAvailable(false)
    }
  }, [loadError])

  React.useEffect(() => {
    load().catch(() => {})
  }, [load, scopeVersion])

  const saveSettings = React.useCallback(async (nextSettings: AiCategorizationSettingsValue) => {
    if (!settings) return
    const previous = settings
    setSettings(nextSettings)
    setSaving(true)
    try {
      // optimistic-lock-exempt: tenant-scoped module-config toggle (single
      // settings row via moduleConfigService), not a versioned editable entity —
      // no updated_at to lock against and no lost-update concern for this admin preference.
      const call = await apiCall('/api/catalog/ai-categorization/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: nextSettings }),
      })
      if (!call.ok) {
        if (call.response.status === 422) {
          setSettings(previous)
          setThresholdDraft(String(previous.autoApplyThreshold))
          flash(
            t(
              'catalog.settings.aiCategorization.errors.unavailable',
              'Cannot enable AI category suggestions: no decision model is configured.',
            ),
            'error',
          )
          return
        }
        await raiseCrudError(
          call.response,
          t('catalog.settings.aiCategorization.errors.save', 'Failed to save AI categorization settings.'),
        )
      }
      flash(t('catalog.settings.messages.saved', 'Settings saved.'), 'success')
    } catch (err) {
      logger.error('catalog.ai_categorization.settings.save failed', { err })
      setSettings(previous)
      setThresholdDraft(String(previous.autoApplyThreshold))
      const message = err instanceof Error
        ? err.message
        : t('catalog.settings.aiCategorization.errors.save', 'Failed to save AI categorization settings.')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [settings, t])

  const handleToggle = React.useCallback(
    (next: boolean) => {
      if (!settings) return
      void saveSettings({ ...settings, enabled: next })
    },
    [saveSettings, settings],
  )

  const handleApplyModeChange = React.useCallback(
    (next: string) => {
      if (!settings || (next !== 'suggest' && next !== 'auto_apply') || next === settings.applyMode) return
      void saveSettings({ ...settings, applyMode: next })
    },
    [saveSettings, settings],
  )

  const handleThresholdCommit = React.useCallback(() => {
    if (!settings) return
    const parsed = parseThreshold(thresholdDraft)
    if (parsed === null) {
      setThresholdInvalid(true)
      return
    }
    setThresholdInvalid(false)
    setThresholdDraft(String(parsed))
    if (parsed !== settings.autoApplyThreshold) {
      void saveSettings({ ...settings, autoApplyThreshold: parsed })
    }
  }, [saveSettings, settings, thresholdDraft])

  return (
    <section className="border bg-card text-card-foreground shadow-sm">
      <div className="border-b px-6 py-4 space-y-1">
        <h2 className="text-lg font-semibold">
          {t('catalog.settings.aiCategorization.title', 'AI category suggestions')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            'catalog.settings.aiCategorization.description',
            'Suggests a category for a product from its organization’s category tree using the configured decision model.',
          )}
        </p>
      </div>
      <div className="px-6 py-4 space-y-4">
        {settings === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {t('catalog.settings.loading', 'Loading…')}
          </div>
        ) : (
          <>
            {!available ? (
              <Alert>
                <AlertTitle>
                  {t('catalog.settings.aiCategorization.unavailableTitle', 'Decision model unavailable')}
                </AlertTitle>
                <AlertDescription>{reasonHint(t, reason)}</AlertDescription>
              </Alert>
            ) : null}
            <SwitchField
              label={t('catalog.settings.aiCategorization.toggleLabel', 'Enable AI category suggestions')}
              description={t(
                'catalog.settings.aiCategorization.toggleDescription',
                'Lets operators request an AI-suggested category for a product. Off by default; no product data leaves the system until this is turned on.',
              )}
              checked={settings.enabled}
              disabled={saving || !available}
              onCheckedChange={handleToggle}
            />
            {settings.enabled ? (
              <div className="space-y-3">
                <RadioGroup
                  value={settings.applyMode}
                  onValueChange={handleApplyModeChange}
                  disabled={saving}
                  aria-label={t('catalog.settings.aiCategorization.applyMode.label', 'Apply mode')}
                >
                  <RadioField
                    value="suggest"
                    label={t('catalog.settings.aiCategorization.applyMode.suggest.label', 'Suggest and review')}
                    description={t(
                      'catalog.settings.aiCategorization.applyMode.suggest.description',
                      'Every suggestion waits for a person to accept or reject it. Recommended.',
                    )}
                  />
                  <RadioField
                    value="auto_apply"
                    label={t('catalog.settings.aiCategorization.applyMode.autoApply.label', 'Auto-apply confident suggestions')}
                    description={t(
                      'catalog.settings.aiCategorization.applyMode.autoApply.description',
                      'Writes the category without review, only for runs a person started (single product or bulk), only when confidence reaches the threshold, and only for products that have no category yet. Products that already have a category, and runs triggered automatically on product creation, always stay pending for review. Auto-applied categories can be undone from the action log and filtered on the review page.',
                    )}
                  />
                </RadioGroup>
                {settings.applyMode === 'auto_apply' ? (
                  <div className="space-y-1 max-w-xs">
                    <Label htmlFor="ai-categorization-threshold">
                      {t('catalog.settings.aiCategorization.threshold.label', 'Auto-apply confidence threshold')}
                    </Label>
                    <Input
                      id="ai-categorization-threshold"
                      type="number"
                      inputMode="decimal"
                      min={THRESHOLD_MIN}
                      max={THRESHOLD_MAX}
                      step={0.01}
                      value={thresholdDraft}
                      disabled={saving}
                      aria-invalid={thresholdInvalid}
                      onChange={(event) => {
                        setThresholdDraft(event.target.value)
                        setThresholdInvalid(false)
                      }}
                      onBlur={handleThresholdCommit}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleThresholdCommit()
                      }}
                    />
                    <p className={thresholdInvalid ? 'text-xs text-status-error-text' : 'text-xs text-muted-foreground'}>
                      {thresholdInvalid
                        ? t('catalog.settings.aiCategorization.threshold.invalid', 'Enter a value between 0.50 and 0.99.')
                        : t(
                            'catalog.settings.aiCategorization.threshold.hint',
                            'Between 0.50 and 0.99. Confidence is the joint probability along the whole category path, so it falls with depth; deep categories rarely reach a high threshold. The default is provisional until review data is available.',
                          )}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">
                {t('catalog.settings.aiCategorization.disclosureTitle', 'What is sent to the decision model provider')}
              </p>
              <p>
                {t(
                  'catalog.settings.aiCategorization.disclosureBody',
                  'Title, subtitle, description, SKU, product type, tag labels, option names/values, and custom field values are sent to classify a product. Custom fields marked encrypted, and any column covered by this tenant’s encryption map, are never sent. Category names are limited to this product’s own organization.',
                )}
              </p>
              <p>
                {t(
                  'catalog.settings.aiCategorization.disclosureAkeneo',
                  'An Akeneo (or other external master) re-sync replaces a product’s full category list, including AI-accepted categories.',
                )}
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
