"use client"
import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '../../primitives/button'
import { apiCall } from '../utils/apiCall'
import { flash } from '../FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const upgradeActionsEnabled =
  process.env.NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED === 'true' ||
  process.env.UPGRADE_ACTIONS_ENABLED === 'true'

type UpgradeActionPayload = {
  id: string
  version: string
  message: string
  ctaLabel: string
  successMessage?: string
  loadingLabel?: string
}

type UpgradeActionResponse = {
  version: string
  actions?: UpgradeActionPayload[]
  error?: string
}

type RunActionResponse = {
  status?: 'completed' | 'already_completed'
  message?: string
  error?: string
}

export function UpgradeActionBanner() {
  const t = useT()
  const [action, setAction] = React.useState<UpgradeActionPayload | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!upgradeActionsEnabled) return
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return
    let cancelled = false
    const load = async () => {
      const call = await apiCall<UpgradeActionResponse>('/api/configs/upgrade-actions')
      if (!call.ok || !call.result || !Array.isArray(call.result.actions) || !call.result.actions.length) {
        if (!cancelled) setAction(null)
        return
      }
      if (!cancelled) {
        setAction(call.result.actions[0]!)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (!upgradeActionsEnabled || !action) return null

  async function handleRun() {
    if (!upgradeActionsEnabled || !action || loading) return
    setLoading(true)
    try {
      const response = await apiCall<RunActionResponse>('/api/configs/upgrade-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: action.id }),
      })
      if (!response.ok) {
        const baseError =
          (response.result && typeof response.result.error === 'string' && response.result.error) ||
          t('upgrades.runFailed', 'We could not run this upgrade action.')
        const detail = response.result && typeof (response.result as any).details === 'string' ? (response.result as any).details : null
        const errorMessage = detail ? `${baseError} (${detail})` : baseError
        flash(errorMessage, 'error')
        return
      }
      const message =
        response.result?.message ||
        action.successMessage ||
        t('upgrades.v034.success', 'Example catalog products and categories installed.')
      flash(message, 'success')
      setAction(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('upgrades.runFailed', 'We could not run this upgrade action.')
      flash(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadingLabel = action.loadingLabel || t('upgrades.v034.loading', 'Installing…')
  const title = action.ctaLabel || action.message
  const description = action.message && action.message !== title ? action.message : null

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-2 text-sm">
        <Sparkles className="mt-0.5 size-4 text-amber-700" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <div className="font-medium text-amber-950">
            {title}
          </div>
          {description ? (
            <div className="text-xs text-amber-900/80">
              {description}
            </div>
          ) : null}
          <div className="text-xs text-amber-900/80">{t('upgrades.versionLabel', { version: action.version })}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { void handleRun() }}
          disabled={loading}
          className="border-amber-300 text-amber-900 hover:bg-amber-100"
        >
          {loading ? loadingLabel : action.ctaLabel}
        </Button>
      </div>
    </div>
  )
}
