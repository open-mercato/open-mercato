"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { QuoteValiditySettings as Settings } from '../data/validators'
import { MAX_QUOTE_VALID_FOR_DAYS } from '../lib/quoteValidity'

export function QuoteValiditySettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [reloadKey, setReloadKey] = React.useState(0)
  const [loaded, setLoaded] = React.useState<{ scopeVersion: number; settings: Settings } | null>(null)
  const [loadError, setLoadError] = React.useState(false)
  const loadErrorMessage = t('sales.settings.errors.load_failed', 'Failed to load sales settings')

  React.useEffect(() => {
    let active = true
    setLoaded(null)
    setLoadError(false)
    void readApiResultOrThrow<Settings>('/api/sales/settings/quote-validity', undefined, { errorMessage: loadErrorMessage })
      .then((settings) => { if (active) setLoaded({ scopeVersion, settings }) })
      .catch((error: unknown) => {
        if (active) {
          getTelemetryRuntime()?.reportError(error, { module: 'sales', code: 'sales.quote_validity_settings_load_failed' })
          setLoadError(true)
        }
      })
    return () => { active = false }
  }, [scopeVersion, reloadKey, loadErrorMessage])

  const fields: CrudField[] = React.useMemo(() => [{
    id: 'defaultQuoteValidityDays', type: 'number', required: true,
    label: t('sales.config.quoteValidity.label', 'Default quote validity (days)'),
  }], [t])
  const settings = loaded?.scopeVersion === scopeVersion ? loaded.settings : null

  return (
    <section aria-labelledby="sales-quote-validity-title" className="space-y-4 rounded border border-border bg-card p-5">
      <h2 id="sales-quote-validity-title" className="text-lg font-semibold">{t('sales.config.quoteValidity.title', 'Quote validity')}</h2>
      <p className="text-sm text-muted-foreground">
        {t('sales.config.quoteValidity.description', 'Default validity when a quote has no future valid-until date. You can change it when sending a quote.')}
      </p>
      {loadError ? <ErrorMessage label={loadErrorMessage} action={<Button type="button" variant="outline" onClick={() => setReloadKey((value) => value + 1)}>{t('common.retry', 'Retry')}</Button>} /> : settings ? (
        <CrudForm<Settings>
          key={`${scopeVersion}:${settings.updatedAt ?? 'new'}`}
          formId="sales-quote-validity-settings"
          embedded
          fields={fields}
          initialValues={settings}
          submitLabel={t('sales.config.orderEditing.actions.save', 'Save settings')}
          disableInitialFocus
          onSubmit={async (values) => {
            const days = Number(values.defaultQuoteValidityDays)
            if (!Number.isInteger(days) || days < 1 || days > MAX_QUOTE_VALID_FOR_DAYS) {
              const message = t('sales.config.quoteValidity.errors.invalid', 'Enter a whole number of days from 1 to 365.')
              throw createCrudFormError(message, { defaultQuoteValidityDays: message })
            }
            await updateCrud('sales/settings/quote-validity', { defaultQuoteValidityDays: days })
            setReloadKey((value) => value + 1)
            flash(t('sales.config.quoteValidity.saved', 'Quote validity settings saved.'), 'success')
          }}
        />
      ) : <LoadingMessage label={t('sales.config.quoteValidity.loading', 'Loading quote validity settings…')} />}
    </section>
  )
}
