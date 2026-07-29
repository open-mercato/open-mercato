"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function EntitySettingsManager(): React.ReactElement {
  const t = useT()
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [restricted, setRestricted] = React.useState(false)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)

  const loadSettings = React.useCallback(async () => {
    try {
      const data = await readApiResultOrThrow<{ newEntitiesRestrictedByDefault?: boolean; updatedAt?: string | null }>(
        '/api/entities/entity-settings',
        undefined,
        {
          errorMessage: t('entities.settings.errors.loadFailed', 'Failed to load settings'),
          fallback: { newEntitiesRestrictedByDefault: false, updatedAt: null },
        }
      )
      setRestricted(data?.newEntitiesRestrictedByDefault === true)
      setUpdatedAt(data?.updatedAt ?? null)
    } catch {
      // Handled by readApiResultOrThrow
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (updatedAt) {
        headers['If-Match'] = updatedAt
        headers['x-om-ext-optimistic-lock-expected-updated-at'] = updatedAt
      }
      const res = await apiCall<{ ok: boolean; newEntitiesRestrictedByDefault: boolean; updatedAt: string | null }>(
        '/api/entities/entity-settings',
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            newEntitiesRestrictedByDefault: restricted,
            expectedUpdatedAt: updatedAt ?? undefined,
          }),
        }
      )

      if (res.status === 409) {
        flash(t('entities.settings.errors.conflict', 'Settings were modified by another user. Please reload.'), 'error')
        setLoading(true)
        await loadSettings()
        return
      }

      if (res.ok && res.result) {
        setUpdatedAt(res.result.updatedAt)
        flash(t('entities.settings.flash.saved', 'Settings saved'), 'success')
      } else {
        flash(t('entities.settings.errors.saveFailed', 'Failed to save settings'), 'error')
      }
    } catch {
      flash(t('entities.settings.errors.saveFailed', 'Failed to save settings'), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" />
        <span>{t('entities.userEntities.form.loading', 'Loading…')}</span>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6 max-w-2xl">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">
          {t('entities.settings.title', 'Custom Entities')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('entities.settings.description', 'Manage global custom entity configurations.')}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="newEntitiesRestrictedByDefault"
            checked={restricted}
            onCheckedChange={(checked) => setRestricted(checked === true)}
            disabled={saving}
            className="mt-1"
          />
          <div className="space-y-1">
            <Label htmlFor="newEntitiesRestrictedByDefault" className="font-medium cursor-pointer">
              {t('entities.settings.newEntitiesRestrictedByDefault.label', 'Restrict record access by default')}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t('entities.settings.newEntitiesRestrictedByDefault.description', 'Require explicit per-entity permissions for records of newly created custom entities by default.')}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t pt-4">
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner className="mr-2 h-4 w-4" /> : null}
          {t('common.save', 'Save')}
        </Button>
      </div>
    </form>
  )
}
