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
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

const SETTINGS_PATH = '/api/marketing_automation/settings'

type Settings = {
  productUrlTemplate: string
  brandVoice: string
  referralUrlTemplate: string
  leadRoutingUserIds: string[]
  loyaltyTiers: Array<{ key: string; minPoints: number }>
  autoApplySplitWinner: boolean
  autoApplySplitWinnerMargin: number
  valueHorizonYears: number
}

/**
 * The two settings the engine already honoured and nothing could change.
 *
 * Not a `CrudForm`: there is no record and no version — these are two per-tenant values, last write wins,
 * and a concurrent edit of a tier ladder is not a conflict worth a dialogue about.
 */
export default function MarketingSettingsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [settings, setSettings] = React.useState<Settings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  /** The staff directory, so the pool is picked from real people rather than typed as uuids. */
  const [staff, setStaff] = React.useState<Array<{ userId: string; displayName: string }>>([])

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const [result, people] = await Promise.all([
        apiCall<Settings>(SETTINGS_PATH),
        apiCall<{ items?: Array<{ userId?: string; displayName?: string }> }>('/api/staff/team-members/assignable?pageSize=100'),
      ])
      if (result.ok && result.result) setSettings(result.result)
      else setLoadFailed(true)
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
      const saved = await apiCallOrThrow<Settings>(SETTINGS_PATH, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (saved.result) setSettings(saved.result)
      flash(t('marketing_automation.settings.saved', 'Settings saved.'), 'success')
    } catch (error) {
      const body = (error as { body?: { error?: unknown } } | null)?.body
      flash(
        typeof body?.error === 'string'
          ? body.error
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

  if (loading) return <Page><PageBody><LoadingMessage label={t('marketing_automation.settings.loading', 'Loading settings…')} /></PageBody></Page>
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
                'A proportion, not percentage points: 0.25 means the winner needs a click rate a quarter higher than the runner-up. 3.0% against 2.9% is a coin toss; 3.0% against 2.0% is a result.',
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
                <div key={`${tier.key}-${index}`} className="flex items-end gap-2">
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
