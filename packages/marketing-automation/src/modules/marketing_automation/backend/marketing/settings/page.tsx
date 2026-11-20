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
import { useMarketingMutation } from '../../../components/useMarketingMutation'
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

export default function MarketingSettingsPage() {
  const t = useT()
  const runMutation = useMarketingMutation('settings')
  const scopeVersion = useOrganizationScopeVersion()

  const [settings, setSettings] = React.useState<Settings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  /** The staff directory, so the pool is picked from real people rather than typed as uuids. */
  const [staff, setStaff] = React.useState<Array<{ userId: string; displayName: string }>>([])

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
      const saved = await runMutation(
        () => apiCallOrThrow<Settings>(SETTINGS_PATH, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(settings),
        }),
      )
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
        <div className="max-w-6xl space-y-8">
          {/*
            Two columns from `xl` up, one below it.
            Nine independent settings in a single 672px column left most of a wide screen empty and put the
            last of them a long scroll below the first. Flowing columns rather than a grid, because a grid
            aligns rows: one tall section (A/B tests, which is mostly explanation) left a screen-high hole
            beside every short one. `break-inside-avoid` keeps each setting whole — a label in one column and
            its field in the other would be worse than the scroll this replaces. The fields do not widen: each
            column is a readable measure, not a monitor.
          */}
          <div className="space-y-8 xl:columns-2 xl:gap-8 xl:space-y-0 [&>div]:break-inside-avoid xl:[&>div]:mb-8">
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
            * Importing somebody else's suppression list now lives on its own page
            * (`/backend/marketing/suppression-import`), gated on `consent.manage` alone — this screen is
            * gated on `campaigns.manage`, and its own GET requires `campaigns.view`, neither of which a
            * consent-only admin holds. Folding the control in here hid it from exactly the role it exists
            * for; a plain link costs nothing and reaches everybody who can act on it.
            */}
          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.settings.suppression', 'Suppression list')} />
            <div className="text-xs text-muted-foreground">
              {t(
                'marketing_automation.settings.suppressionMovedHint',
                'Importing a suppression list now has its own page, reachable by anyone with consent-management rights, with or without campaign-management rights.',
              )}
            </div>
            <a className="text-xs underline text-foreground" href="/backend/marketing/suppression-import">
              {t('marketing_automation.settings.suppressionMovedLink', 'Import a suppression list')}
            </a>
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

          </div>

          {/* Outside the grid: it saves the whole page, so it belongs under both columns rather than in one. */}
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
