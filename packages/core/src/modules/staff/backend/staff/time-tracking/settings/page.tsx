"use client"

/**
 * Module settings — screen 16 (T7.1).
 *
 * One page, four groups, and one thing that is not decoration: the worked examples
 * under the rounding control recompute live from `roundMinutes`, the same helper the
 * write path uses (mockup note 1). Rounding is the rule people misread, and its
 * effect is otherwise invisible until an invoice goes out.
 *
 * Two deliberate departures from the mockup:
 *
 *  * **"Apply retroactively" is an action, not a switch** (note 3 read strictly). A
 *    switch that restates `rounded_minutes` across a tenant's history as a side
 *    effect of saving a form is a silent rewrite of billed amounts. It is a button
 *    that names the number of affected entries, asks for confirmation, and queues a
 *    `ProgressJob` that can never touch a locked entry.
 *  * **The access grace window is on this page.** It is live behaviour — a member
 *    loses project access this many days after their assignment ends (D-12) — and it
 *    had no UI at all before this screen.
 *
 * Every rule here is tenant-global by decision §10; the card on the right says so,
 * because "why can't I set this per project" is otherwise a support ticket.
 */

import * as React from 'react'
import { AlertTriangle, History, Info, Save } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { formatDuration } from '../../../../lib/time-tracking/duration'
import type { RoundingUnitMinutes } from '../../../../lib/time-tracking/rounding'
import type { TimeTrackingSettings } from '../../../../lib/time-tracking/settings'
import {
  ROUNDING_UNIT_OPTIONS,
  buildRoundingExamples,
  draftRounding,
  formatSignedMinutes,
  isSettingsDraftDirty,
  settingsDraftErrors,
  toSettingsDraft,
  toSettingsPayload,
  type TimeTrackingSettingsDraft,
} from '../../../../lib/time-tracking-ui/timeTrackingSettingsForm'

const logger = createLogger('staff').child({ component: 'time-tracking/settings' })

const SETTINGS_API = '/api/staff/timesheets/settings'
const IMPACT_API = '/api/staff/timesheets/settings/rounding-impact'
const REAPPLY_API = '/api/staff/timesheets/settings/reapply-rounding'
const MANAGE_FEATURE = 'staff.timesheets.settings.manage'
const MUTATION_CONTEXT_ID = 'staff.time_tracking.settings'
const RESOURCE_KIND = 'staff.timesheets.settings'
const RESOURCE_ID = 'time_tracking'
const IMPACT_DEBOUNCE_MS = 350

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type RoundingImpactTotals = {
  entryCount: number
  rawMinutes: number
  roundedMinutes: number
  deltaMinutes: number
}

type RoundingImpactResponse = {
  windowDays: number
  projected: RoundingImpactTotals
  lockedEntryCount: number
}

export default function TimeTrackingSettingsPage() {
  const t = useT()
  const { payload } = useBackendChrome()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const canManage = hasFeature(payload?.grantedFeatures, MANAGE_FEATURE)

  const [baseline, setBaseline] = React.useState<TimeTrackingSettingsDraft | null>(null)
  const [draft, setDraft] = React.useState<TimeTrackingSettingsDraft | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isReapplying, setIsReapplying] = React.useState(false)

  const [impact, setImpact] = React.useState<RoundingImpactResponse | null>(null)
  const [impactState, setImpactState] = React.useState<'idle' | 'loading' | 'error'>('idle')

  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('staff.time_tracking.settings.saveError', 'Failed to save the settings.'),
  })

  const loadSettings = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const call = await apiCall<TimeTrackingSettings>(SETTINGS_API)
      if (!call.ok || !call.result) {
        setLoadError(t('staff.time_tracking.settings.loadError', 'Failed to load the settings.'))
        return
      }
      const next = toSettingsDraft(call.result)
      setBaseline(next)
      setDraft(next)
    } catch (err) {
      logger.error('time tracking settings load failed', { err })
      setLoadError(t('staff.time_tracking.settings.loadError', 'Failed to load the settings.'))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings, scopeVersion])

  const rounding = draft ? draftRounding(draft) : null
  const roundingUnit = rounding?.unitMinutes ?? null
  const roundingDirection = rounding?.direction ?? null

  // The impact preview follows the CANDIDATE rule, not the stored one, so the
  // warning card answers "what would this do" before Save is pressed.
  React.useEffect(() => {
    if (roundingUnit === null || roundingDirection === null) return
    let cancelled = false
    setImpactState('loading')
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const call = await apiCall<RoundingImpactResponse>(
            `${IMPACT_API}?unitMinutes=${roundingUnit}&direction=${roundingDirection}`,
          )
          if (cancelled) return
          if (!call.ok || !call.result) {
            setImpactState('error')
            return
          }
          setImpact(call.result)
          setImpactState('idle')
        } catch (err) {
          if (cancelled) return
          logger.error('rounding impact preview failed', { err })
          setImpactState('error')
        }
      })()
    }, IMPACT_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [roundingUnit, roundingDirection, scopeVersion])

  const patchDraft = React.useCallback((patch: Partial<TimeTrackingSettingsDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }, [])

  const fieldErrors = draft ? settingsDraftErrors(draft) : []
  const isDirty = draft && baseline ? isSettingsDraftDirty(draft, baseline) : false
  const canSave = canManage && isDirty && fieldErrors.length === 0 && !isSaving

  const handleSave = React.useCallback(async () => {
    if (!draft) return
    const body = toSettingsPayload(draft)
    if (!body) return
    setIsSaving(true)
    try {
      const call = await runMutation({
        operation: () =>
          apiCall<TimeTrackingSettings>(SETTINGS_API, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: RESOURCE_KIND,
          resourceId: RESOURCE_ID,
          retryLastMutation,
        },
        mutationPayload: body as unknown as Record<string, unknown>,
      })
      if (!call.ok || !call.result) {
        flash(t('staff.time_tracking.settings.saveError', 'Failed to save the settings.'), 'error')
        return
      }
      const saved = toSettingsDraft(call.result)
      setBaseline(saved)
      setDraft(saved)
      flash(t('staff.time_tracking.settings.saved', 'Settings saved.'), 'success')
    } catch (err) {
      logger.error('time tracking settings save failed', { err })
      flash(t('staff.time_tracking.settings.saveError', 'Failed to save the settings.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [draft, retryLastMutation, runMutation, t])

  const handleReapply = React.useCallback(async () => {
    const candidateCount = impact?.projected.entryCount ?? 0
    const confirmed = await confirm({
      title: t('staff.time_tracking.settings.retro.confirmTitle', 'Reapply rounding to existing entries?'),
      text: t(
        'staff.time_tracking.settings.retro.confirmText',
        'Rounded time will be recomputed on existing entries using the saved rule. Entries locked in closed reports are never changed.',
      ),
      confirmText: t('staff.time_tracking.settings.retro.cta', 'Reapply to existing entries'),
    })
    if (!confirmed) return
    setIsReapplying(true)
    try {
      const call = await runMutation({
        operation: () =>
          apiCall<{ progressJobId: string | null; candidateCount: number }>(REAPPLY_API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          }),
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: RESOURCE_KIND,
          resourceId: RESOURCE_ID,
          retryLastMutation,
        },
        mutationPayload: { action: 'reapply-rounding', candidateCount },
      })
      if (!call.ok) {
        flash(t('staff.time_tracking.settings.retro.error', 'Failed to start the recalculation.'), 'error')
        return
      }
      if (!call.result?.progressJobId) {
        flash(t('staff.time_tracking.settings.retro.nothing', 'There is nothing to recalculate.'), 'info')
        return
      }
      flash(
        t(
          'staff.time_tracking.settings.retro.queued',
          'Recalculating rounded time on {count} entries. Progress is shown in the top bar.',
          { count: call.result.candidateCount },
        ),
        'success',
      )
    } catch (err) {
      logger.error('reapply rounding request failed', { err })
      flash(t('staff.time_tracking.settings.retro.error', 'Failed to start the recalculation.'), 'error')
    } finally {
      setIsReapplying(false)
    }
  }, [confirm, impact, retryLastMutation, runMutation, t])

  const examples = rounding ? buildRoundingExamples(rounding) : []

  const ruleLabel = React.useMemo(() => {
    if (!rounding) return ''
    if (rounding.unitMinutes === 0) {
      return t('staff.time_tracking.settings.impact.rule.none', 'no rounding')
    }
    return rounding.direction === 'up'
      ? t('staff.time_tracking.settings.impact.rule.up', '{unit} min up', { unit: rounding.unitMinutes })
      : t('staff.time_tracking.settings.impact.rule.nearest', '{unit} min to nearest', {
          unit: rounding.unitMinutes,
        })
  }, [rounding, t])

  if (isLoading) {
    return (
      <Page>
        <PageHeader title={t('staff.time_tracking.settings.title', 'Module settings')} />
        <PageBody>
          <LoadingMessage label={t('staff.time_tracking.settings.loading', 'Loading settings…')} />
        </PageBody>
      </Page>
    )
  }

  if (loadError || !draft) {
    return (
      <Page>
        <PageHeader title={t('staff.time_tracking.settings.title', 'Module settings')} />
        <PageBody>
          <ErrorMessage
            label={loadError ?? t('staff.time_tracking.settings.loadError', 'Failed to load the settings.')}
            action={
              <Button type="button" variant="outline" onClick={() => void loadSettings()}>
                {t('staff.time_tracking.settings.retry', 'Try again')}
              </Button>
            }
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('staff.time_tracking.settings.title', 'Module settings')}
        description={t(
          'staff.time_tracking.settings.subtitle',
          'Rules shared by all customers and projects',
        )}
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('staff.time_tracking.settings.rounding.title', 'Time rounding')}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'staff.time_tracking.settings.rounding.description',
                    'Applies to all projects. The rounded value is the one cost is calculated from.',
                  )}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label>{t('staff.time_tracking.settings.rounding.unit', 'Unit')}</Label>
                    <SegmentedControl
                      value={String(draft.roundingUnitMinutes)}
                      onValueChange={(value) => {
                        const parsed = Number(value)
                        if (!ROUNDING_UNIT_OPTIONS.includes(parsed as RoundingUnitMinutes)) return
                        patchDraft({ roundingUnitMinutes: parsed as RoundingUnitMinutes })
                      }}
                      disabled={!canManage}
                      aria-label={t('staff.time_tracking.settings.rounding.unit', 'Unit')}
                    >
                      {ROUNDING_UNIT_OPTIONS.map((unit) => (
                        <SegmentedControlItem key={unit} value={String(unit)}>
                          {unit === 0
                            ? t('staff.time_tracking.settings.rounding.unit.none', 'None')
                            : t('staff.time_tracking.settings.rounding.unit.minutes', '{count} min', {
                                count: unit,
                              })}
                        </SegmentedControlItem>
                      ))}
                    </SegmentedControl>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>{t('staff.time_tracking.settings.rounding.direction', 'Direction')}</Label>
                    <SegmentedControl
                      value={draft.roundingDirection}
                      onValueChange={(value) => {
                        if (value !== 'up' && value !== 'nearest') return
                        patchDraft({ roundingDirection: value })
                      }}
                      disabled={!canManage || draft.roundingUnitMinutes === 0}
                      aria-label={t('staff.time_tracking.settings.rounding.direction', 'Direction')}
                    >
                      <SegmentedControlItem value="up">
                        {t('staff.time_tracking.settings.rounding.direction.up', 'Up')}
                      </SegmentedControlItem>
                      <SegmentedControlItem value="nearest">
                        {t('staff.time_tracking.settings.rounding.direction.nearest', 'To nearest')}
                      </SegmentedControlItem>
                    </SegmentedControl>
                  </div>
                </div>

                <Alert status="information" icon={<Info aria-hidden="true" />}>
                  <AlertTitle>
                    {t('staff.time_tracking.settings.rounding.examples.title', 'Examples at the current setting')}
                  </AlertTitle>
                  <AlertDescription>
                    <span className="font-mono text-sm" data-testid="rounding-examples">
                      {examples
                        .map((example) => `${example.rawLabel} → ${example.roundedLabel}`)
                        .join(' · ')}
                    </span>
                  </AlertDescription>
                </Alert>

                <div className="flex flex-col gap-2 rounded-md border border-border p-4">
                  <span className="text-sm font-medium">
                    {t(
                      'staff.time_tracking.settings.retro.title',
                      'Apply retroactively to existing entries',
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(
                      'staff.time_tracking.settings.retro.hint',
                      'Saving changes new entries only. Recalculating existing ones is a separate, explicit action — and it never changes entries locked in closed reports.',
                    )}
                  </span>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleReapply()}
                      disabled={!canManage || isReapplying || isDirty}
                      data-testid="reapply-rounding"
                    >
                      {isReapplying ? <Spinner className="size-4" /> : <History className="size-4" aria-hidden="true" />}
                      {t('staff.time_tracking.settings.retro.cta', 'Reapply to existing entries')}
                    </Button>
                  </div>
                  {isDirty ? (
                    <span className="text-xs text-muted-foreground">
                      {t(
                        'staff.time_tracking.settings.retro.saveFirst',
                        'Save the rule first — the recalculation uses the saved rule, not the one on screen.',
                      )}
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('staff.time_tracking.settings.defaults.title', 'Entry defaults')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <SwitchField
                  label={t('staff.time_tracking.settings.defaults.billable', 'New entries are billable')}
                  description={t(
                    'staff.time_tracking.settings.defaults.billableHint',
                    'A project can override this.',
                  )}
                  checked={draft.defaultsBillable}
                  onCheckedChange={(value) => patchDraft({ defaultsBillable: value === true })}
                  disabled={!canManage}
                />
                <SwitchField
                  label={t(
                    'staff.time_tracking.settings.defaults.chainStart',
                    'Start = end of the previous entry',
                  )}
                  description={t(
                    'staff.time_tracking.settings.defaults.chainStartHint',
                    'A suggestion when adding another entry on the same day.',
                  )}
                  checked={draft.defaultsChainStartFromPreviousEnd}
                  onCheckedChange={(value) =>
                    patchDraft({ defaultsChainStartFromPreviousEnd: value === true })
                  }
                  disabled={!canManage}
                />
                <div className="flex flex-col gap-2">
                  <Label htmlFor="time-tracking-daily-hours">
                    {t('staff.time_tracking.settings.targets.dailyHours', 'Daily hours target')}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="time-tracking-daily-hours"
                      className="max-w-28"
                      inputMode="decimal"
                      value={draft.dailyHoursText}
                      onChange={(event) => patchDraft({ dailyHoursText: event.target.value })}
                      disabled={!canManage}
                      aria-invalid={fieldErrors.includes('dailyHours')}
                    />
                    <span className="text-sm text-muted-foreground">
                      {t('staff.time_tracking.settings.targets.hoursUnit', 'h')}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t(
                      'staff.time_tracking.settings.targets.dailyHoursHint',
                      'Scales the load bars in the timesheet. Leave empty to turn targets off.',
                    )}
                  </span>
                  {fieldErrors.includes('dailyHours') ? (
                    <span className="text-xs text-status-error-base">
                      {t(
                        'staff.time_tracking.settings.targets.dailyHoursError',
                        'Enter a number of hours between 0 and 24, or leave the field empty.',
                      )}
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('staff.time_tracking.settings.warnings.title', 'Warnings')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <SwitchField
                  label={t('staff.time_tracking.settings.warnings.overlap', 'Warn about overlapping entries')}
                  description={t('staff.time_tracking.settings.warnings.overlapHint', 'A warning, not a block.')}
                  checked={draft.warningsOverlap}
                  onCheckedChange={(value) => patchDraft({ warningsOverlap: value === true })}
                  disabled={!canManage}
                />
                <SwitchField
                  label={t('staff.time_tracking.settings.warnings.runningTimer', 'Remind about a running timer')}
                  description={t(
                    'staff.time_tracking.settings.warnings.runningTimerHint',
                    'An unobtrusive reminder when leaving the module and after 8 h of continuous running.',
                  )}
                  checked={draft.warningsRunningTimer}
                  onCheckedChange={(value) => patchDraft({ warningsRunningTimer: value === true })}
                  disabled={!canManage}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('staff.time_tracking.settings.access.title', 'Project access')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Label htmlFor="time-tracking-grace-days">
                  {t(
                    'staff.time_tracking.settings.access.graceDays',
                    'Access grace period after an assignment ends',
                  )}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="time-tracking-grace-days"
                    className="max-w-28"
                    inputMode="numeric"
                    value={draft.assignmentGraceDaysText}
                    onChange={(event) => patchDraft({ assignmentGraceDaysText: event.target.value })}
                    disabled={!canManage}
                    aria-invalid={fieldErrors.includes('assignmentGraceDays')}
                  />
                  <span className="text-sm text-muted-foreground">
                    {t('staff.time_tracking.settings.access.daysUnit', 'days')}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t(
                    'staff.time_tracking.settings.access.graceDaysHint',
                    'A member keeps access to a project for this many days after their assignment end date, so the last week of work can still be logged and corrected. 0 ends access on the end date itself.',
                  )}
                </span>
                {fieldErrors.includes('assignmentGraceDays') ? (
                  <span className="text-xs text-status-error-base">
                    {t(
                      'staff.time_tracking.settings.access.graceDaysError',
                      'Enter a whole number of days between 0 and 365.',
                    )}
                  </span>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Alert status="warning" icon={<AlertTriangle aria-hidden="true" />}>
              <AlertTitle>
                {t('staff.time_tracking.settings.impact.title', 'Changing rounding affects amounts')}
              </AlertTitle>
              <AlertDescription>
                {impactState === 'loading' && !impact ? (
                  <span className="text-sm">
                    {t('staff.time_tracking.settings.impact.loading', 'Calculating the impact…')}
                  </span>
                ) : impactState === 'error' ? (
                  <span className="text-sm">
                    {t('staff.time_tracking.settings.impact.error', 'The impact preview is unavailable.')}
                  </span>
                ) : impact && impact.projected.entryCount > 0 ? (
                  <div className="flex flex-col gap-1" data-testid="rounding-impact">
                    <span className="text-sm">
                      {t(
                        'staff.time_tracking.settings.impact.body',
                        'With the current {count} entries from the last {days} days, {rule} gives {rounded} ({delta} against raw time). Closed reports stay unchanged.',
                        {
                          count: impact.projected.entryCount,
                          days: impact.windowDays,
                          rule: ruleLabel,
                          rounded: formatDuration(impact.projected.roundedMinutes, 'clock'),
                          delta: formatSignedMinutes(impact.projected.deltaMinutes),
                        },
                      )}
                    </span>
                    {impact.lockedEntryCount > 0 ? (
                      <span className="text-xs">
                        {t(
                          'staff.time_tracking.settings.impact.locked',
                          '{count} entries in the window are locked in closed reports and are excluded.',
                          { count: impact.lockedEntryCount },
                        )}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-sm">
                    {t(
                      'staff.time_tracking.settings.impact.empty',
                      'There are no unlocked entries in the last {days} days to project against.',
                      { days: impact?.windowDays ?? 90 },
                    )}
                  </span>
                )}
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>{t('staff.time_tracking.settings.scope.title', 'Settings scope')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <span className="text-sm">
                  {t(
                    'staff.time_tracking.settings.scope.body',
                    'These rules are global — they cannot be set per customer or per project.',
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(
                    'staff.time_tracking.settings.scope.hint',
                    'The rate and currency stay at project level, and a rate override stays at entry level.',
                  )}
                </span>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setDraft(baseline)}
            disabled={!isDirty || isSaving}
          >
            {t('staff.time_tracking.settings.actions.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!canSave} data-testid="save-settings">
            {isSaving ? <Spinner className="size-4" /> : <Save className="size-4" aria-hidden="true" />}
            {t('staff.time_tracking.settings.actions.save', 'Save')}
          </Button>
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
