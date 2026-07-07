"use client"

import * as React from 'react'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type CatalogSettingsResponse = {
  unitPriceDisplayEnabled?: boolean
}

export function UnitPriceDisplaySettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [enabled, setEnabled] = React.useState<boolean | null>(null)
  const [saving, setSaving] = React.useState(false)

  const loadError = t('catalog.settings.unitPriceDisplay.errors.load', 'Failed to load catalog settings.')

  const load = React.useCallback(async () => {
    try {
      const payload = await readApiResultOrThrow<CatalogSettingsResponse>(
        '/api/catalog/settings',
        undefined,
        { errorMessage: loadError, fallback: { unitPriceDisplayEnabled: true } },
      )
      setEnabled(payload.unitPriceDisplayEnabled !== false)
    } catch (err) {
      console.error('catalog.settings.load failed', err)
      flash(loadError, 'error')
      setEnabled(true)
    }
  }, [loadError])

  React.useEffect(() => {
    load().catch(() => {})
  }, [load, scopeVersion])

  const handleChange = React.useCallback(async (next: boolean) => {
    const previous = enabled
    setEnabled(next)
    setSaving(true)
    try {
      // optimistic-lock-exempt: tenant-scoped module-config toggle (single
      // settings row via ModuleConfigService), not a versioned editable entity —
      // no updated_at to lock against and no lost-update concern for this admin preference.
      const call = await apiCall('/api/catalog/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unitPriceDisplayEnabled: next }),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, t('catalog.settings.unitPriceDisplay.errors.save', 'Failed to save catalog settings.'))
      }
      flash(t('catalog.settings.messages.saved', 'Settings saved.'), 'success')
    } catch (err) {
      console.error('catalog.settings.save failed', err)
      setEnabled(previous)
      const message = err instanceof Error
        ? err.message
        : t('catalog.settings.unitPriceDisplay.errors.save', 'Failed to save catalog settings.')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [enabled, t])

  return (
    <section className="border bg-card text-card-foreground shadow-sm">
      <div className="border-b px-6 py-4 space-y-1">
        <h2 className="text-lg font-semibold">
          {t('catalog.settings.unitPriceDisplay.title', 'Unit price presentation')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            'catalog.settings.unitPriceDisplay.description',
            'Controls whether the EU unit price presentation feature is available on the product form.',
          )}
        </p>
      </div>
      <div className="px-6 py-4">
        {enabled === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {t('catalog.settings.loading', 'Loading…')}
          </div>
        ) : (
          <SwitchField
            label={t('catalog.settings.unitPriceDisplay.toggleLabel', 'Enable EU unit price presentation')}
            description={t(
              'catalog.settings.unitPriceDisplay.toggleDescription',
              'When off, the EU unit price settings are hidden from every product form. Turn this off for manufacturers or other tenants that do not sell to consumers.',
            )}
            checked={enabled}
            disabled={saving}
            onCheckedChange={(next) => { void handleChange(next) }}
          />
        )}
      </div>
    </section>
  )
}
