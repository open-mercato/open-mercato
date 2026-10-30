"use client"

import * as React from 'react'
import { CalendarClock, Hand, Plus, Radio, Trash2, TriangleAlert } from 'lucide-react'
// Deep import, NOT the package root: `@open-mercato/scheduler`'s index also
// exports `SchedulerService`, which reaches `shared/lib/i18n/server` and its
// `require('server-only')`. Pulling that into a "use client" module breaks the
// build with 'server-only' cannot be imported from a Client Component module.
// `lib/cronParser` depends on `cron-parser` alone and is safe in the browser.
import { validateCronExpression } from '@open-mercato/scheduler/modules/scheduler/lib/cronParser'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  PROCESS_TRIGGERS_MAX,
  isValidIanaTimeZone,
  processEventTriggerConfigSchema,
  type ProcessManualTrigger,
  type ProcessTrigger,
} from '../../../data/validators'
import { parseGrantedFeaturesText, listTimeZones } from './formHelpers'

const TIMEZONE_DATALIST_ID = 'om-process-trigger-timezones'

type Translate = ReturnType<typeof useT>

export type TriggerEditorProps = {
  value: ProcessTrigger[]
  onChange: (next: ProcessTrigger[]) => void
  /** Reported to the parent so it can block a save on a cron that would never fire. */
  onValidityChange?: (valid: boolean) => void
  disabled?: boolean
  locale: string
  t: Translate
}

function replaceAt(list: ProcessTrigger[], index: number, next: ProcessTrigger): ProcessTrigger[] {
  return list.map((item, position) => (position === index ? next : item))
}

function formatNextRuns(cron: string, timezoneRaw: string, locale: string): { ok: boolean; text: string } {
  const timezone = timezoneRaw && isValidIanaTimeZone(timezoneRaw) ? timezoneRaw : 'UTC'
  const result = validateCronExpression(cron, { timezone, count: 3 })
  if (!result.ok || !result.nextRuns?.length) return { ok: false, text: result.error ?? '' }
  return {
    ok: true,
    text: result.nextRuns
      .map((run) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(run))
      .join(' · '),
  }
}

/** A schedule trigger is invalid when its cron would never fire — caught at save, not at fire time. */
export function invalidScheduleIndexes(triggers: ProcessTrigger[]): number[] {
  const invalid: number[] = []
  triggers.forEach((trigger, index) => {
    if (trigger.kind !== 'schedule') return
    const timezone = isValidIanaTimeZone(trigger.timezone) ? trigger.timezone : 'UTC'
    if (!validateCronExpression(trigger.cron, { timezone, count: 1 }).ok) invalid.push(index)
  })
  return invalid
}

function TriggerCard({
  icon: Icon,
  title,
  onRemove,
  removeLabel,
  disabled,
  children,
}: {
  icon: typeof CalendarClock
  title: string
  onRemove?: () => void
  removeLabel?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </span>
        {onRemove ? (
          <IconButton
            type="button"
            variant="ghost"
            size="xs"
            aria-label={removeLabel}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 className="size-4" />
          </IconButton>
        ) : null}
      </div>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  )
}

/**
 * The declared-trigger editor — the `"use client"` island the triggered process
 * model calls for (cron validation and add/remove are interaction, not
 * convenience). Edits the ONE `triggers` list that replaced cron columns, the
 * event-trigger table and the undocumented run route.
 *
 * The event `config` is edited as JSON on purpose: it carries typed ARRAYS
 * (`filterConditions`, `contextMapping`) whose full expressiveness a two-field
 * form would quietly truncate.
 */
export function TriggerEditor({ value, onChange, onValidityChange, disabled, locale, t }: TriggerEditorProps) {
  const timeZones = React.useMemo(() => listTimeZones(), [])
  const [configDrafts, setConfigDrafts] = React.useState<Record<number, string>>({})
  const [configErrors, setConfigErrors] = React.useState<Record<number, boolean>>({})

  const invalidSchedules = React.useMemo(() => new Set(invalidScheduleIndexes(value)), [value])
  const hasConfigError = Object.values(configErrors).some(Boolean)

  React.useEffect(() => {
    onValidityChange?.(invalidSchedules.size === 0 && !hasConfigError)
  }, [invalidSchedules, hasConfigError, onValidityChange])

  const manualIndex = value.findIndex((trigger) => trigger.kind === 'manual')
  const manual = manualIndex >= 0 ? (value[manualIndex] as ProcessManualTrigger) : null
  const atCap = value.length >= PROCESS_TRIGGERS_MAX

  const setManual = React.useCallback(
    (next: boolean) => {
      if (next && manualIndex < 0) {
        onChange([...value, { kind: 'manual', requireFeatures: [] }])
      } else if (!next && manualIndex >= 0) {
        onChange(value.filter((_, index) => index !== manualIndex))
      }
    },
    [manualIndex, onChange, value],
  )

  const addSchedule = React.useCallback(() => {
    onChange([...value, { kind: 'schedule', cron: '0 7 * * *', timezone: 'UTC', enabled: true }])
  }, [onChange, value])

  const addEvent = React.useCallback(() => {
    onChange([...value, { kind: 'event', eventPattern: '', priority: 0, enabled: true }])
  }, [onChange, value])

  const removeAt = React.useCallback(
    (index: number) => {
      setConfigDrafts({})
      setConfigErrors({})
      onChange(value.filter((_, position) => position !== index))
    },
    [onChange, value],
  )

  return (
    <div className="space-y-3">
      <datalist id={TIMEZONE_DATALIST_ID}>
        {timeZones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>

      <TriggerCard icon={Hand} title={t('agent_orchestrator.processDefinitions.triggers.manual.title')}>
        <div className="flex items-center gap-2">
          <Switch
            checked={manual !== null}
            disabled={disabled}
            onCheckedChange={setManual}
            aria-label={t('agent_orchestrator.processDefinitions.triggers.manual.toggle')}
          />
          <span className="text-sm text-muted-foreground">
            {t('agent_orchestrator.processDefinitions.triggers.manual.toggle')}
          </span>
        </div>
        {manual ? (
          <div className="space-y-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="om-process-trigger-manual-features"
            >
              {t('agent_orchestrator.processDefinitions.triggers.manual.requireFeatures')}
            </label>
            <Textarea
              id="om-process-trigger-manual-features"
              rows={2}
              disabled={disabled}
              className="font-mono text-xs"
              value={manual.requireFeatures.join('\n')}
              placeholder={t('agent_orchestrator.processDefinitions.triggers.manual.requireFeaturesHint')}
              onChange={(event) =>
                onChange(
                  replaceAt(value, manualIndex, {
                    kind: 'manual',
                    requireFeatures: parseGrantedFeaturesText(event.target.value),
                  }),
                )
              }
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('agent_orchestrator.processDefinitions.triggers.manual.disabledHint')}
          </p>
        )}
      </TriggerCard>

      {value.map((trigger, index) => {
        if (trigger.kind === 'schedule') {
          const preview = formatNextRuns(trigger.cron, trigger.timezone, locale)
          return (
            <TriggerCard
              key={`schedule-${index}`}
              icon={CalendarClock}
              title={t('agent_orchestrator.processDefinitions.triggers.schedule.title')}
              onRemove={() => removeAt(index)}
              removeLabel={t('agent_orchestrator.processDefinitions.triggers.remove')}
              disabled={disabled}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={trigger.cron}
                  disabled={disabled}
                  className="w-40 font-mono"
                  aria-label={t('agent_orchestrator.processDefinitions.triggers.schedule.cron')}
                  placeholder="0 7 * * *"
                  onChange={(event) => onChange(replaceAt(value, index, { ...trigger, cron: event.target.value }))}
                />
                <Input
                  value={trigger.timezone}
                  list={TIMEZONE_DATALIST_ID}
                  disabled={disabled}
                  className="w-56"
                  aria-label={t('agent_orchestrator.processDefinitions.triggers.schedule.timezone')}
                  onChange={(event) => onChange(replaceAt(value, index, { ...trigger, timezone: event.target.value }))}
                />
                <span className="inline-flex items-center gap-1.5">
                  <Switch
                    checked={trigger.enabled}
                    disabled={disabled}
                    onCheckedChange={(next) => onChange(replaceAt(value, index, { ...trigger, enabled: next }))}
                    aria-label={t('agent_orchestrator.processDefinitions.triggers.enabled')}
                  />
                  <span className="text-xs text-muted-foreground">
                    {t('agent_orchestrator.processDefinitions.triggers.enabled')}
                  </span>
                </span>
              </div>
              {!isValidIanaTimeZone(trigger.timezone) ? (
                <p className="inline-flex items-center gap-1 text-xs text-status-error-text">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  {t('agent_orchestrator.processDefinitions.form.errors.timezoneInvalid')}
                </p>
              ) : null}
              {preview.ok ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t('agent_orchestrator.processDefinitions.form.nextRuns')}:
                  </span>{' '}
                  {preview.text}
                </p>
              ) : (
                <p className="inline-flex items-center gap-1 text-xs text-status-error-text">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  {t('agent_orchestrator.processDefinitions.form.nextRunsInvalid', undefined, { error: preview.text })}
                </p>
              )}
            </TriggerCard>
          )
        }

        if (trigger.kind !== 'event') return null
        const draft = configDrafts[index] ?? (trigger.config ? JSON.stringify(trigger.config, null, 2) : '')
        return (
          <TriggerCard
            key={`event-${index}`}
            icon={Radio}
            title={t('agent_orchestrator.processDefinitions.triggers.event.title')}
            onRemove={() => removeAt(index)}
            removeLabel={t('agent_orchestrator.processDefinitions.triggers.remove')}
            disabled={disabled}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={trigger.eventPattern}
                disabled={disabled}
                className="min-w-56 flex-1 font-mono"
                placeholder="customers.deal.created"
                aria-label={t('agent_orchestrator.processDefinitions.triggers.event.pattern')}
                onChange={(event) =>
                  onChange(replaceAt(value, index, { ...trigger, eventPattern: event.target.value }))
                }
              />
              <Input
                type="number"
                value={String(trigger.priority)}
                disabled={disabled}
                className="w-24"
                aria-label={t('agent_orchestrator.processDefinitions.triggers.event.priority')}
                onChange={(event) =>
                  onChange(
                    replaceAt(value, index, { ...trigger, priority: Number.parseInt(event.target.value, 10) || 0 }),
                  )
                }
              />
              <span className="inline-flex items-center gap-1.5">
                <Switch
                  checked={trigger.enabled}
                  disabled={disabled}
                  onCheckedChange={(next) => onChange(replaceAt(value, index, { ...trigger, enabled: next }))}
                  aria-label={t('agent_orchestrator.processDefinitions.triggers.enabled')}
                />
                <span className="text-xs text-muted-foreground">
                  {t('agent_orchestrator.processDefinitions.triggers.enabled')}
                </span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('agent_orchestrator.processDefinitions.triggers.event.patternHint')}
            </p>
            <Textarea
              rows={4}
              disabled={disabled}
              value={draft}
              className="font-mono text-xs"
              aria-label={t('agent_orchestrator.processDefinitions.triggers.event.config')}
              placeholder='{"contextMapping":[{"targetKey":"claimId","sourceExpression":"id"}]}'
              onChange={(event) => {
                const text = event.target.value
                setConfigDrafts((prev) => ({ ...prev, [index]: text }))
                if (!text.trim()) {
                  setConfigErrors((prev) => ({ ...prev, [index]: false }))
                  onChange(replaceAt(value, index, { ...trigger, config: null }))
                  return
                }
                let candidate: unknown
                try {
                  candidate = JSON.parse(text)
                } catch {
                  setConfigErrors((prev) => ({ ...prev, [index]: true }))
                  return
                }
                // Validated against the REAL persisted shape (typed arrays, not
                // maps) so a config that would be rejected server-side is
                // flagged here rather than at save.
                const parsed = processEventTriggerConfigSchema.safeParse(candidate)
                if (!parsed.success) {
                  setConfigErrors((prev) => ({ ...prev, [index]: true }))
                  return
                }
                setConfigErrors((prev) => ({ ...prev, [index]: false }))
                onChange(replaceAt(value, index, { ...trigger, config: parsed.data }))
              }}
            />
            {configErrors[index] ? (
              <p className="inline-flex items-center gap-1 text-xs text-status-error-text">
                <TriangleAlert className="size-3.5 shrink-0" />
                {t('agent_orchestrator.processDefinitions.form.errors.invalidJson')}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('agent_orchestrator.processDefinitions.triggers.event.configHint')}
              </p>
            )}
          </TriggerCard>
        )
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || atCap} onClick={addSchedule}>
          <Plus className="mr-2 size-4" />
          {t('agent_orchestrator.processDefinitions.triggers.addSchedule')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled || atCap} onClick={addEvent}>
          <Plus className="mr-2 size-4" />
          {t('agent_orchestrator.processDefinitions.triggers.addEvent')}
        </Button>
        {atCap ? (
          <span className="text-xs text-muted-foreground">
            {t('agent_orchestrator.processDefinitions.triggers.cap', undefined, { max: String(PROCESS_TRIGGERS_MAX) })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
