"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'

const PREFERENCES_PATH = '/api/marketing_automation/portal/preferences'

type Answer = {
  consent?: 'subscribed' | 'unsubscribed' | null
  preference?: { maxPerWeek: number | null; pausedUntil: string | null; locale: string | null }
  limits?: { maxPerWeek: number; maxPauseDays: number }
}

/**
 * The recipient's own preference centre.
 *
 * Deliberately offers the middle ground: "fewer" and "not for a while" beside "stop". Somebody who only wanted
 * less mail has otherwise had one button available to them, and it says unsubscribe.
 */
export default function MarketingPreferencesPage() {
  const t = useT()

  const [answer, setAnswer] = React.useState<Answer | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<Answer>(PREFERENCES_PATH)
      if (result.ok && result.result) setAnswer(result.result)
      else setLoadFailed(true)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const save = async (patch: {
    subscribed?: boolean
    maxPerWeek?: number | null
    pauseDays?: number | null
    locale?: string | null
  }) => {
    setSaving(true)
    setSaved(false)
    try {
      const response = await apiCallOrThrow<Answer>(PREFERENCES_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (response.result) setAnswer({ ...answer, ...response.result })
      setSaved(true)
    } catch {
      setLoadFailed(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-4"><Spinner /></div>

  const unsubscribed = answer?.consent === 'unsubscribed'
  const maxPerWeek = answer?.preference?.maxPerWeek ?? null
  const pausedUntil = answer?.preference?.pausedUntil ?? null
  const maxAllowed = answer?.limits?.maxPerWeek ?? 14

  return (
    <div className="mx-auto max-w-xl space-y-6 p-4">
      <div>
        <h1 className="text-lg font-medium">{t('marketing_automation.portal.title', 'Email preferences')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('marketing_automation.portal.intro', 'Choose how often you hear from us. You can pause for a while instead of unsubscribing.')}
        </p>
      </div>

      {loadFailed ? <ErrorMessage label={t('marketing_automation.portal.failed', 'Something went wrong. Please try again.')} /> : null}

      <div className="space-y-2">
        <Label>{t('marketing_automation.portal.status', 'Marketing emails')}</Label>
        <div className="flex items-center gap-2">
          <StatusBadge variant={unsubscribed ? 'error' : 'success'}>
            {unsubscribed
              ? t('marketing_automation.portal.unsubscribed', 'Unsubscribed')
              : t('marketing_automation.portal.subscribed', 'Subscribed')}
          </StatusBadge>
          <Button variant="outline" disabled={saving} onClick={() => void save({ subscribed: unsubscribed })}>
            {unsubscribed
              ? t('marketing_automation.portal.resubscribe', 'Start receiving them again')
              : t('marketing_automation.portal.unsubscribe', 'Unsubscribe')}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="max-per-week">{t('marketing_automation.portal.frequency', 'How often at most')}</Label>
        <Select
          value={maxPerWeek === null ? 'any' : String(maxPerWeek)}
          onValueChange={(value) => void save({ maxPerWeek: value === 'any' ? null : Number.parseInt(value, 10) })}
        >
          <SelectTrigger id="max-per-week" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('marketing_automation.portal.frequencyAny', 'No limit from me')}</SelectItem>
            {[1, 2, 3, 5].filter((value) => value <= maxAllowed).map((value) => (
              <SelectItem key={value} value={String(value)}>
                {t('marketing_automation.portal.frequencyN', 'At most {count} a week').replace('{count}', String(value))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="preferred-locale">{t('marketing_automation.portal.language', 'Language')}</Label>
        {/* The language the PERSON chose. A guess from their address is how somebody receives marketing in a
            language they do not read, so the default is "not said" rather than a country's. */}
        <Select
          value={answer?.preference?.locale ?? 'unset'}
          onValueChange={(value) => void save({ locale: value === 'unset' ? null : value })}
        >
          <SelectTrigger id="preferred-locale" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unset">{t('marketing_automation.portal.languageUnset', 'No preference')}</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="pl">Polski</SelectItem>
            <SelectItem value="es">Español</SelectItem>
            <SelectItem value="de">Deutsch</SelectItem>
            <SelectItem value="ko">한국어</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{t('marketing_automation.portal.pause', 'Take a break')}</Label>
        {pausedUntil ? (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              {t('marketing_automation.portal.pausedUntil', 'Paused until {date}')
                .replace('{date}', formatDateTime(pausedUntil) ?? pausedUntil)}
            </div>
            <Button variant="outline" disabled={saving} onClick={() => void save({ pauseDays: null })}>
              {t('marketing_automation.portal.resume', 'Resume now')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[30, 90, 180].map((days) => (
              <Button key={days} variant="outline" disabled={saving} onClick={() => void save({ pauseDays: days })}>
                {t('marketing_automation.portal.pauseDays', 'Pause {days} days').replace('{days}', String(days))}
              </Button>
            ))}
          </div>
        )}
      </div>

      {saving ? <Spinner /> : null}
      {saved && !saving ? (
        <div className="text-sm text-muted-foreground">{t('marketing_automation.portal.saved', 'Saved. Thank you.')}</div>
      ) : null}
    </div>
  )
}
