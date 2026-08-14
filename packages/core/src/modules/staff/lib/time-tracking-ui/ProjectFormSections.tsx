"use client"

import * as React from 'react'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type ProjectBudgetKind = 'none' | 'hours' | 'amount'

export const DEFAULT_BUDGET_WARN_AT_PERCENT = 80

export type BudgetSectionProps = {
  enabled: boolean
  kind: ProjectBudgetKind
  value: string
  warnAtPercent: string
  currencyCode: string | null
  disabled?: boolean
  onChange: (patch: {
    enabled?: boolean
    kind?: ProjectBudgetKind
    value?: string
    warnAtPercent?: string
  }) => void
}

/**
 * Screen 4, "Budżet" — first-class scope per the spec (§9 promoted out of
 * "proposal"). The switch maps to `budgetKind: 'none'`; turning it on restores
 * the last picked kind so a toggle never silently discards the limit.
 */
export function ProjectBudgetSection({
  enabled,
  kind,
  value,
  warnAtPercent,
  currencyCode,
  disabled,
  onChange,
}: BudgetSectionProps) {
  const t = useT()
  const unitLabel = kind === 'amount'
    ? (currencyCode ?? t('staff.time_tracking.projects.budget.amountUnit', 'amount'))
    : t('staff.time_tracking.projects.budget.hoursUnit', 'h')

  return (
    <div className="flex flex-col gap-4">
      <SwitchField
        checked={enabled}
        disabled={disabled}
        onCheckedChange={(next) => onChange({ enabled: next === true, kind: next === true && kind === 'none' ? 'hours' : kind })}
        label={t('staff.time_tracking.projects.budget.enable', 'Track the limit')}
        description={t(
          'staff.time_tracking.projects.budget.enableHint',
          'Warns at {{percent}}% and 100% of the limit.',
          { percent: warnAtPercent || String(DEFAULT_BUDGET_WARN_AT_PERCENT) },
        )}
      />

      {enabled ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t('staff.time_tracking.projects.budget.kind', 'Limit type')}</Label>
            <SegmentedControl
              value={kind === 'none' ? 'hours' : kind}
              disabled={disabled}
              onValueChange={(next) => onChange({ kind: next as ProjectBudgetKind })}
              aria-label={t('staff.time_tracking.projects.budget.kind', 'Limit type')}
            >
              <SegmentedControlItem value="hours">
                {t('staff.time_tracking.projects.budget.kindHours', 'Hours')}
              </SegmentedControlItem>
              <SegmentedControlItem value="amount">
                {t('staff.time_tracking.projects.budget.kindAmount', 'Amount')}
              </SegmentedControlItem>
            </SegmentedControl>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tt-budget-value">
              {t('staff.time_tracking.projects.budget.value', 'Limit')}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="tt-budget-value"
                inputMode="decimal"
                value={value}
                disabled={disabled}
                onChange={(event) => onChange({ value: event.target.value })}
              />
              <span className="shrink-0 text-sm text-muted-foreground">{unitLabel}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tt-budget-warn">
              {t('staff.time_tracking.projects.budget.warnAt', 'Warn at')}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="tt-budget-warn"
                inputMode="numeric"
                value={warnAtPercent}
                disabled={disabled}
                onChange={(event) => onChange({ warnAtPercent: event.target.value })}
              />
              <span className="shrink-0 text-sm text-muted-foreground">%</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type ProjectMemberRow = {
  id?: unknown
  staffMemberId?: unknown
  staff_member_id?: unknown
  status?: unknown
}

type TeamMemberRow = {
  id?: unknown
  firstName?: unknown
  lastName?: unknown
  first_name?: unknown
  last_name?: unknown
  displayName?: unknown
  email?: unknown
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function memberLabel(row: TeamMemberRow): string {
  const display = readString(row.displayName)
  if (display) return display
  const first = readString(row.firstName) ?? readString(row.first_name)
  const last = readString(row.lastName) ?? readString(row.last_name)
  const joined = [first, last].filter(Boolean).join(' ')
  return joined || readString(row.email) || readString(row.id) || ''
}

export type ProjectTeamSectionProps = {
  projectId?: string | null
}

/**
 * Screen 4's right column: the assigned team as chips plus the entry point into
 * the team drawer. The drawer itself is a separate task and lives behind
 * `?panel=team` on the project route.
 */
export function ProjectTeamSection({ projectId }: ProjectTeamSectionProps) {
  const t = useT()
  const [names, setNames] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(Boolean(projectId))

  React.useEffect(() => {
    if (!projectId) {
      setNames([])
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const membersRes = await apiCall<{ items?: ProjectMemberRow[] }>(
          `/api/staff/timesheets/time-projects/${projectId}/employees?pageSize=100&status=active`,
        )
        const memberIds = (Array.isArray(membersRes.result?.items) ? membersRes.result.items : [])
          .map((row) => readString(row.staffMemberId) ?? readString(row.staff_member_id))
          .filter((id): id is string => id !== null)
        if (memberIds.length === 0) {
          if (!cancelled) setNames([])
          return
        }
        const staffRes = await apiCall<{ items?: TeamMemberRow[] }>(
          `/api/staff/team-members?ids=${memberIds.join(',')}&pageSize=100`,
        )
        const rows = Array.isArray(staffRes.result?.items) ? staffRes.result.items : []
        if (!cancelled) setNames(rows.map(memberLabel).filter((name) => name.length > 0))
      } catch {
        if (!cancelled) setNames([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [projectId])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {t(
          'staff.time_tracking.projects.team.hint',
          'Without an assignment only the Team Leader can see the project.',
        )}
      </p>
      {projectId && names.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {names.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-2 py-1 text-xs text-foreground"
            >
              <Avatar label={name} size="sm" />
              {name}
            </span>
          ))}
        </div>
      ) : null}
      {projectId && !loading && names.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('staff.time_tracking.projects.team.empty', 'Nobody is assigned yet.')}
        </p>
      ) : null}
      {projectId ? (
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={`/backend/staff/time-tracking/projects/${projectId}?panel=team`}>
            <Users className="h-4 w-4" aria-hidden />
            {t('staff.time_tracking.projects.team.manage', 'Manage team')}
          </Link>
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('staff.time_tracking.projects.team.afterCreate', 'You can assign people once the project is saved.')}
        </p>
      )}
    </div>
  )
}

type RoundingSettingsResponse = {
  rounding?: { unitMinutes?: unknown; direction?: unknown } | null
}

export function describeRounding(
  unitMinutes: number,
  direction: string,
  t: TranslateFn,
): string {
  if (!unitMinutes) return t('staff.time_tracking.projects.rounding.none', 'no rounding')
  return direction === 'nearest'
    ? t('staff.time_tracking.projects.rounding.nearest', 'to the nearest {{unit}} min', { unit: String(unitMinutes) })
    : t('staff.time_tracking.projects.rounding.up', 'up to {{unit}} min', { unit: String(unitMinutes) })
}

/**
 * Screen 4's info alert: rounding is global (§10 fixes it there, with no
 * per-project override), so the form names the current tenant setting and points
 * at module settings rather than offering a field.
 */
export function ProjectRoundingNotice() {
  const t = useT()
  const [summary, setSummary] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await apiCall<RoundingSettingsResponse>('/api/staff/timesheets/settings')
        const rounding = res.result?.rounding
        const unitMinutes = typeof rounding?.unitMinutes === 'number' ? rounding.unitMinutes : 0
        const direction = typeof rounding?.direction === 'string' ? rounding.direction : 'up'
        if (!cancelled) setSummary(describeRounding(unitMinutes, direction, t))
      } catch {
        if (!cancelled) setSummary(null)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [t])

  return (
    <Alert status="information" style="lighter" size="default">
      <div className="flex flex-col">
        <AlertTitle>
          {t('staff.time_tracking.projects.rounding.title', 'Rounding is global')}
        </AlertTitle>
        <AlertDescription>
          {summary
            ? t(
              'staff.time_tracking.projects.rounding.body',
              'Currently: {{summary}}. The change applies to every project — set it in the module settings.',
              { summary },
            )
            : t(
              'staff.time_tracking.projects.rounding.bodyUnknown',
              'The change applies to every project — set it in the module settings.',
            )}
        </AlertDescription>
      </div>
    </Alert>
  )
}
