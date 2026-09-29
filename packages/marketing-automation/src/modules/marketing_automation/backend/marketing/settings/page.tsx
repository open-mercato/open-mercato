"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { readApiErrorField } from '../../../components/apiError'

const SETTINGS_PATH = '/api/marketing_automation/settings'

type Settings = {
  productUrlTemplate: string
  brandVoice: string
  referralUrlTemplate: string
  leadRoutingUserIds: string[]
  loyaltyTiers: Array<{ key: string; minPoints: number }>
  autoApplySplitWinner: boolean
  autoApplySplitWinnerMargin: number
  splitWinnerMetric: 'clicks' | 'revenue'
  valueHorizonYears: number
}

/**
 * The two settings the engine already honoured and nothing could change.
 *
 * Not a `CrudForm`: there is no record and no version — these are two per-tenant values, last write wins,
 * and a concurrent edit of a tier ladder is not a conflict worth a dialogue about.
 */
type ImportResult = {
  suppressed: number
  alreadySuppressed: number
  unmatched: number
  unmatchedSample: string[]
  skipped: number
  truncated: boolean
}

export default function MarketingSettingsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [settings, setSettings] = React.useState<Settings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  /** The staff directory, so the pool is picked from real people rather than typed as uuids. */
  const [staff, setStaff] = React.useState<Array<{ userId: string; displayName: string }>>([])
  const [importReason, setImportReason] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const [importResult, setImportResult] = React.useState<ImportResult | null>(null)

  /**
   * Reads the file in the browser and posts its text, rather than uploading it.
   *
   * The reason travels in the same payload that way, which matters because the reason is recorded on every row it
   * suppresses — a multipart upload with the reason in a separate field is two things that can disagree.
   */
  const importSuppressionList = async (file: File) => {
    const reason = importReason.trim()
    if (!reason) {
      flash(t('marketing_automation.settings.suppressionNeedsReason', 'Say where this list came from first — it is recorded on every customer it unsubscribes.'), 'error')
      return
    }
    setImporting(true)
    setImportResult(null)
    try {
      const csv = await file.text()
      const response = await apiCallOrThrow<ImportResult>('/api/marketing_automation/consent/import', {
        method: 'POST',
        body: JSON.stringify({ csv, reason }),
        headers: { 'content-type': 'application/json' },
      })
      setImportResult(response.result ?? null)
    } catch {
      flash(t('marketing_automation.settings.suppressionFailed', 'Could not import that file.'), 'error')
    } finally {
      setImporting(false)
    }
  }

  /**
   * What the server last said, so a repeat of the same answer leaves the form alone.
   *
   * The organisation scope settles a moment after the page opens and triggers a second load; that load used to
   * replace the form with a spinner and then with the server's values, throwing away whatever had been typed in
   * the first second. A load that brings DIFFERENT values — another organisation picked — still replaces them.
   */
  const lastLoaded = React.useRef<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const [result, people] = await Promise.all([
        apiCall<Settings>(SETTINGS_PATH),
        apiCall<{ items?: Array<{ userId?: string; displayName?: string }> }>('/api/staff/team-members/assignable?pageSize=100'),
      ])
      if (result.ok && result.result) {
        const loaded = JSON.stringify(result.result)
        if (loaded !== lastLoaded.current) {
          lastLoaded.current = loaded
          setSettings(result.result)
        }
      } else setLoadFailed(true)
      setStaff((people.ok && Array.isArray(people.result?.items) ? people.result.items : [])
        .flatMap((member) => (member.userId ? [{ userId: member.userId, displayName: member.displayName ?? member.userId }] : [])))
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      // optimistic-lock-exempt: per-tenant CONFIG, not a record — there is no row and no `updatedAt` to hold a
      // version against, which is the same reason this screen is not a `CrudForm`. Last write wins deliberately:
      // a concurrent edit of a tier ladder is not a conflict worth a dialogue about.
      const saved = await apiCallOrThrow<Settings>(SETTINGS_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (saved.result) {
        lastLoaded.current = JSON.stringify(saved.result)
        setSettings(saved.result)
      }
      flash(t('marketing_automation.settings.saved', 'Settings saved.'), 'success')
    } catch (error) {
      const message = readApiErrorField(error, 'error')
      flash(
        message
          ? message
          : t('marketing_automation.settings.saveFailed', 'Could not save the settings.'),
        'error',
      )
    } finally {
      setSaving(false)
    }
  }

  const updateTier = (index: number, patch: Partial<{ key: string; minPoints: number }>) => {
    if (!settings) return
    const tiers = settings.loyaltyTiers.map((tier, position) => (position === index ? { ...tier, ...patch } : tier))
    setSettings({ ...settings, loyaltyTiers: tiers })
  }

  // Only before there is a form to show: a reload must not swap a form somebody is typing into for a spinner.
  if (loading && !settings) return <Page><PageBody><LoadingMessage label={t('marketing_automation.settings.loading', 'Loading settings…')} /></PageBody></Page>
  if (loadFailed || !settings) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={t('marketing_automation.settings.loadFailed', 'Could not load the settings.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="max-w-2xl space-y-8">
          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.settings.productUrl', 'Product links in messages')} />
            <Label htmlFor="product-url-template">
              {t('marketing_automation.settings.productUrlTemplate', 'Product URL template')}
            </Label>
            <Input
              id="product-url-template"
              value={settings.productUrlTemplate}
              placeholder="https://shop.example/p/{sku}"
              onChange={(event) => setSettings({ ...settings, productUrlTemplate: event.target.value })}
            />
            <div className="text-xs text-muted-foreground">
              {t(
                'marketing_automation.settings.productUrlHint',
                'Must contain {sku}. Recommended products link through it; without it they render as plain names.',
              )}
            </div>
          </div>

          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.settings.routing', 'Lead routing')} />
            <div className="text-xs text-muted-foreground">
              {t('marketing_automation.settings.routingHint', 'The "Assign to a sales rep" step gives each new lead to whoever in this pool currently has the fewest.')}
            </div>
            {staff.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t('marketing_automation.settings.routingNoStaff', 'No assignable staff found in this organization.')}
              </div>
            ) : (
              <div className="space-y-1">
                {staff.map((member) => (
                  <CheckboxField
                    key={member.userId}
                    label={member.displayName}
                    checked={(settings.leadRoutingUserIds ?? []).includes(member.userId)}
                    onCheckedChange={(checked) => setSettings({
                      ...settings,
                      leadRoutingUserIds: checked
                        ? [...new Set([...(settings.leadRoutingUserIds ?? []), member.userId])]
                        : (settings.leadRoutingUserIds ?? []).filter((id) => id !== member.userId),
                    })}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.settings.referral', 'Referral links')} />
            <Label htmlFor="referral-url-template">
              {t('marketing_automation.settings.referralUrlTemplate', 'Referral URL template')}
            </Label>
            <Input
              id="referral-url-template"
              value={settings.referralUrlTemplate}
              placeholder="https://shop.example/r/{code}"
              onChange={(event) => setSettings({ ...settings, referralUrlTemplate: event.target.value })}
            />
            <div className="text-xs text-muted-foreground">
              {t('marketing_automation.settings.referralUrlHint', 'Must contain {code}. Messages can then print {{referral.url}} as well as {{referral.code}}.')}
            </div>
          </div>

          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.settings.experiments', 'A/B tests')} />
            <Label htmlFor="winner-metric">
              {t('marketing_automation.settings.winnerMetric', 'Decide a test on')}
            </Label>
            <Select
              value={settings.splitWinnerMetric}
              onValueChange={(value) => setSettings({
                ...settings,
                splitWinnerMetric: value === 'revenue' ? 'revenue' : 'clicks',
              })}
            >
              <SelectTrigger id="winner-metric" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clicks">
                  {t('marketing_automation.settings.winnerMetricClicks', 'Clicks per recipient')}
                </SelectItem>
                <SelectItem value="revenue">
                  {t('marketing_automation.settings.winnerMetricRevenue', 'Revenue per recipient')}
                </SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              {t(
                'marketing_automation.settings.winnerMetricHint',
                'Clicks are available on every campaign; revenue is the better question, because a variant that collects clicks and sells less would otherwise win. On revenue a verdict waits for orders to be attributable, and is withheld entirely when the lanes earn in different currencies. The same choice governs the suggestion on the results screen and any promotion made for you.',
              )}
            </div>
            <CheckboxField
              label={t('marketing_automation.settings.autoApply', 'Let a decisive test promote its own winner')}
              checked={settings.autoApplySplitWinner}
              onCheckedChange={(checked) => setSettings({ ...settings, autoApplySplitWinner: checked === true })}
            />
            <div className="text-xs text-muted-foreground">
              {t(
                'marketing_automation.settings.autoApplyHint',
                'Off by default, because promoting a winner rewrites the campaign. When on, the daily pass promotes a variant only once every lane has twice the usual sample and the winner beats the runner-up by the margin below. It goes through the ordinary save, so it is recorded as a version you can restore, and whoever can manage campaigns gets a notification.',
              )}
            </div>
            <Label htmlFor="winner-margin">
              {t('marketing_automation.settings.autoApplyMargin', 'How much better the winner must be')}
            </Label>
            <Input
              id="winner-margin"
              type="number"
              step="0.05"
              min="0.05"
              max="5"
              className="w-32"
              value={settings.autoApplySplitWinnerMargin}
              disabled={!settings.autoApplySplitWinner}
              onChange={(event) => setSettings({
                ...settings,
                autoApplySplitWinnerMargin: Number(event.target.value),
              })}
            />
            <div className="text-xs text-muted-foreground">
              {t(
                'marketing_automation.settings.autoApplyMarginHint',
                'A proportion, not percentage points: 0.25 means the winner needs a figure a quarter higher than the runner-up, measured on whichever of the two above decides. 3.0% against 2.9% is a coin toss; 3.0% against 2.0% is a result.',
              )}
            </div>
          </div>

          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.settings.value', 'Customer value')} />
            <Label htmlFor="value-horizon">
              {t('marketing_automation.settings.valueHorizon', 'Projection horizon, in years')}
            </Label>
            <Input
              id="value-horizon"
              type="number"
              step="0.5"
              min="0.5"
              max="5"
              className="w-32"
              value={settings.valueHorizonYears}
              onChange={(event) => setSettings({ ...settings, valueHorizonYears: Number(event.target.value) })}
            />
            <div className="text-xs text-muted-foreground">
              {t(
                'marketing_automation.settings.valueHorizonHint',
                'How far ahead the projected value on a customer profile looks, assuming they keep buying at their own pace. Shorter suits a shop selling something people replace rarely.',
              )}
            </div>
          </div>

          {/*
            * Importing somebody else's suppression list.
            *
            * On the settings screen rather than a page of its own because it is a once-per-migration action, and
            * it is an ACTION rather than a setting — so it saves itself on its own button instead of travelling
            * with the form below.
            */}
          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.settings.suppression', 'Suppression list')} />
            <div className="text-xs text-muted-foreground">
              {t(
                'marketing_automation.settings.suppressionHint',
                'A CSV of email addresses from the tool you are leaving. Every address that matches a customer here is recorded as unsubscribed, with your reason on it. It can only take people OFF the list: a CSV is not consent, so there is no way to import anybody as subscribed.',
              )}
            </div>
            <Label htmlFor="suppression-reason">
              {t('marketing_automation.settings.suppressionReason', 'Where this list came from')}
            </Label>
            <Input
              id="suppression-reason"
              value={importReason}
              placeholder={t('marketing_automation.settings.suppressionReasonPlaceholder', 'Unsubscribes exported from our previous tool')}
              onChange={(event) => setImportReason(event.target.value)}
            />
            <Input
              id="suppression-file"
              type="file"
              accept=".csv,text/csv,text/plain"
              disabled={importing}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                // The input is reset so choosing the same file twice runs twice — a retry after fixing the reason.
                event.target.value = ''
                if (file) void importSuppressionList(file)
              }}
            />
            {importing ? <Spinner /> : null}
            {importResult ? (
              <div className="text-xs text-muted-foreground">
                {t(
                  'marketing_automation.settings.suppressionResult',
                  'Suppressed {suppressed}. {already} were already unsubscribed. {unmatched} addresses matched no customer here, and {skipped} rows held no address.',
                )
                  .replace('{suppressed}', String(importResult.suppressed))
                  .replace('{already}', String(importResult.alreadySuppressed))
                  .replace('{unmatched}', String(importResult.unmatched))
                  .replace('{skipped}', String(importResult.skipped))}
                {importResult.truncated
                  ? ` ${t('marketing_automation.settings.suppressionTruncated', 'The file was longer than one import applies — upload the rest separately.')}`
                  : ''}
                {/* A sample, so a typo is distinguishable from somebody who was never a customer here. */}
                {importResult.unmatchedSample.length > 0 ? (
                  <div className="mt-1 font-mono">{importResult.unmatchedSample.join(', ')}</div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.settings.voice', 'Brand voice')} />
            <Label htmlFor="brand-voice">{t('marketing_automation.settings.voiceLabel', 'How this shop writes')}</Label>
            <Textarea
              id="brand-voice"
              rows={4}
              value={settings.brandVoice}
              placeholder={t('marketing_automation.settings.voicePlaceholder', 'Warm and direct. Never pushy, no exclamation marks. We say “delivery”, not “shipping”.')}
              onChange={(event) => setSettings({ ...settings, brandVoice: event.target.value })}
            />
            <div className="text-xs text-muted-foreground">
              {t('marketing_automation.settings.voiceHint', 'Handed to the model whenever somebody drafts a message with AI, so every draft sounds like the same brand.')}
            </div>
          </div>

          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.settings.tiers', 'Loyalty tiers')} />
            <div className="text-xs text-muted-foreground">
              {t('marketing_automation.settings.tiersHint', 'A tier is the highest ladder step the lead score has reached. Derived, never stored.')}
            </div>
            <div className="space-y-2">
              {settings.loyaltyTiers.map((tier, index) => (
                // Keyed by position only: the name is what is being typed, so a key built from it remounted the input
                // on every keystroke and the field lost focus after one character. The row holds no state of its own.
                <div key={`tier-${index}`} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`tier-key-${index}`}>{t('marketing_automation.settings.tierKey', 'Tier')}</Label>
                    <Input
                      id={`tier-key-${index}`}
                      value={tier.key}
                      onChange={(event) => updateTier(index, { key: event.target.value })}
                    />
                  </div>
                  <div className="w-32 space-y-1">
                    <Label htmlFor={`tier-points-${index}`}>{t('marketing_automation.settings.tierPoints', 'From points')}</Label>
                    <Input
                      id={`tier-points-${index}`}
                      type="number"
                      value={String(tier.minPoints)}
                      onChange={(event) => updateTier(index, { minPoints: Number(event.target.value) })}
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setSettings({
                      ...settings,
                      loyaltyTiers: settings.loyaltyTiers.filter((_, position) => position !== index),
                    })}
                  >
                    {t('marketing_automation.action.removeNode', 'Remove')}
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() => setSettings({
                ...settings,
                loyaltyTiers: [...settings.loyaltyTiers, { key: '', minPoints: 0 }],
              })}
            >
              {t('marketing_automation.settings.addTier', 'Add a tier')}
            </Button>
          </div>

          <div>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? <Spinner /> : t('marketing_automation.action.save', 'Save')}
            </Button>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
