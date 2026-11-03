"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'

export function EntitySettingsManager(): React.ReactElement {
  const t = useT()
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [restricted, setRestricted] = React.useState(false)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)

  const { runMutation } = useGuardedMutation({
    contextId: 'custom-entities-settings',
  })

  const loadSettings = React.useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const data = await readApiResultOrThrow<{ newEntitiesRestrictedByDefault?: boolean; updatedAt?: string | null }>(
        '/api/entities/entity-settings',
        undefined,
        {
          errorMessage: t('entities.settings.errors.loadFailed', 'Failed to load settings'),
        }
      )
      setRestricted(data.newEntitiesRestrictedByDefault === true)
      setUpdatedAt(data.updatedAt ?? null)
    } catch {
      setLoadError(true)
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
      const headers = buildOptimisticLockHeader(updatedAt)
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(headers, async () => {
            const res = await apiCallOrThrow<{ ok: boolean; newEntitiesRestrictedByDefault: boolean; updatedAt: string | null }>(
              '/api/entities/entity-settings',
              {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  newEntitiesRestrictedByDefault: restricted,
                  expectedUpdatedAt: updatedAt ?? undefined,
                }),
              },
              {
                errorMessage: t('entities.settings.errors.saveFailed', 'Failed to save settings'),
              }
            )

            if (res.ok && res.result) {
              setUpdatedAt(res.result.updatedAt)
              flash(t('entities.settings.flash.saved', 'Settings saved'), 'success')
            }
            return res
          }),
        context: {},
        mutationPayload: {
          newEntitiesRestrictedByDefault: restricted,
        },
      })
    } catch (err) {
      const conflict = extractOptimisticLockConflict(err)
      if (conflict) {
        setLoading(true)
        await loadSettings()
      } else {
        flash(t('entities.settings.errors.saveFailed', 'Failed to save settings'), 'error')
      }
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

  if (loadError) {
    return (
      <ErrorMessage
        label={t('entities.settings.errors.loadFailed', 'Failed to load settings')}
        action={(
          <Button type="button" variant="outline" size="sm" onClick={() => void loadSettings()}>
            {t('common.retry', 'Retry')}
          </Button>
        )}
      />
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
