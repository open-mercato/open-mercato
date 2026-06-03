"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { AvailabilityRulesEditor, type AvailabilityScheduleItemBuilder } from '@open-mercato/core/modules/planner/components/AvailabilityRulesEditor'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/planner/lib/availabilitySchedule'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AvailabilityRuleSetForm, buildAvailabilityRuleSetPayload, type AvailabilityRuleSetFormValues } from '@open-mercato/core/modules/planner/components/AvailabilityRuleSetForm'

const DAY_MS = 24 * 60 * 60 * 1000

function toFullDayWindow(value: Date): { start: Date; end: Date } {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const end = new Date(start.getTime() + DAY_MS)
  return { start, end }
}

type RuleSetRecord = {
  id: string
  name: string
  description?: string | null
  timezone: string
  updatedAt?: string | null
  updated_at?: string | null
  name_raw?: string | null
} & Record<string, unknown>

type RuleSetResponse = {
  items?: RuleSetRecord[]
}

export default function PlannerAvailabilityRuleSetDetailPage({ params }: { params?: { id?: string } }) {
  const rulesetId = params?.id
  const translate = useT()
  const router = useRouter()
  // optimistic-lock: AvailabilityRuleSetForm forwards optimisticLockUpdatedAt from initialValues.updatedAt (wrapper auto-derives the header on save + delete).
  const [initialValues, setInitialValues] = React.useState<AvailabilityRuleSetFormValues | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')

  React.useEffect(() => {
    if (!rulesetId) return
    const rulesetIdValue = rulesetId
    let cancelled = false
    async function loadRuleSet() {
      if (!cancelled) {
        setError(null)
        setIsNotFound(false)
      }
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: rulesetIdValue })
        const payload = await readApiResultOrThrow<RuleSetResponse>(
          `/api/planner/availability-rule-sets?${params.toString()}`,
          undefined,
          { errorMessage: translate('planner.availabilityRuleSets.form.errors.load', 'Failed to load schedule.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        const customFields = extractCustomFieldEntries(record)
        if (!cancelled) {
          setInitialValues({
            id: record.id,
            name: record.name ?? record.name_raw ?? '',
            description: record.description ?? '',
            timezone: record.timezone ?? 'UTC',
            updatedAt: typeof record.updatedAt === 'string'
              ? record.updatedAt
              : typeof record.updated_at === 'string'
                ? record.updated_at
                : null,
            ...customFields,
          })
        }
      } catch (err) {
        if (!cancelled) {
          if ((err as { status?: number }).status === 404) {
            setIsNotFound(true)
          } else {
            const message = err instanceof Error ? err.message : translate('planner.availabilityRuleSets.form.errors.load', 'Failed to load schedule.')
            setError(message)
          }
        }
      }
    }
    loadRuleSet()
    return () => { cancelled = true }
  }, [rulesetId, translate])

  const handleSubmit = React.useCallback(async (values: AvailabilityRuleSetFormValues) => {
    if (!rulesetId) return
    const timezone = typeof initialValues?.timezone === 'string' && initialValues.timezone.trim().length
      ? initialValues.timezone.trim()
      : 'UTC'
    const payload = buildAvailabilityRuleSetPayload(values, { id: rulesetId, timezone })
    await updateCrud('planner/availability-rule-sets', payload, {
      errorMessage: translate('planner.availabilityRuleSets.form.errors.update', 'Failed to update schedule.'),
    })
    flash(translate('planner.availabilityRuleSets.form.flash.updated', 'Schedule updated.'), 'success')
    router.push('/backend/planner/availability-rulesets')
  }, [initialValues?.timezone, router, rulesetId, translate])

  const handleDelete = React.useCallback(async () => {
    if (!rulesetId) return
    // Let a non-ok DELETE (e.g. the 409 optimistic-lock conflict) propagate so
    // CrudForm surfaces the unified conflict bar and skips its success toast.
    // Swallowing the error here made CrudForm treat the delete as successful and
    // show a false "Schedule deleted." toast even though the record was kept.
    await deleteCrud('planner/availability-rule-sets', rulesetId, {
      errorMessage: translate('planner.availabilityRuleSets.form.errors.delete', 'Failed to delete schedule.'),
    })
    flash(translate('planner.availabilityRuleSets.form.flash.deleted', 'Schedule deleted.'), 'success')
    router.push('/backend/planner/availability-rulesets')
  }, [router, rulesetId, translate])

  const buildScheduleItems: AvailabilityScheduleItemBuilder = React.useCallback(({ availabilityRules, bookedEvents, translate: translateLabel }) => {
    const overrideExdates = Array.from(new Set(
      availabilityRules
        .map((rule) => parseAvailabilityRuleWindow(rule))
        .filter((window) => window.repeat === 'once')
        .map((window) => toFullDayWindow(window.startAt).start.toISOString()),
    ))
    const availabilityItems = availabilityRules.map((rule) => {
      const window = parseAvailabilityRuleWindow(rule)
      const isUnavailable = rule.kind === 'unavailability'
      const titleKey = isUnavailable
        ? 'planner.availabilityRuleSets.availability.title.unavailable'
        : `planner.availabilityRuleSets.availability.title.${window.repeat}`
      const fallback = isUnavailable
        ? 'Unavailable'
        : window.repeat === 'weekly'
          ? 'Weekly availability'
          : window.repeat === 'daily'
            ? 'Daily availability'
            : 'Availability'
      const baseTitle = translateLabel(titleKey, fallback)
      const title = rule.note ? `${baseTitle}: ${rule.note}` : baseTitle
      const windowTime = window.repeat === 'once' ? toFullDayWindow(window.startAt) : { start: window.startAt, end: window.endAt }
      const exdates = window.repeat === 'once'
        ? rule.exdates ?? []
        : [...(rule.exdates ?? []), ...overrideExdates]
      return {
        id: rule.id,
        kind: isUnavailable ? 'exception' as const : 'availability' as const,
        title,
        startsAt: windowTime.start,
        endsAt: windowTime.end,
        metadata: { rule: { ...rule, exdates } },
      }
    })
    return availabilityItems
  }, [])

  const tabs = React.useMemo(() => ([
    { id: 'details', label: translate('planner.availabilityRuleSets.tabs.details', 'Details') },
    { id: 'availability', label: translate('planner.availabilityRuleSets.tabs.availability', 'Availability') },
  ]), [translate])

  const resolvedInitialValues = initialValues ?? {}

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={translate('planner.availabilityRuleSets.form.errors.notFound', 'Schedule not found.')}
            backHref="/backend/planner/availability-rulesets"
            backLabel={translate('planner.availabilityRuleSets.actions.backToList', 'Back to schedules')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error && !initialValues) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="border-b">
            <nav className="flex flex-wrap items-center gap-5 text-sm" aria-label={translate('planner.availabilityRuleSets.tabs.label', 'Schedule sections')}>
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  variant="ghost"
                  size="sm"
                  className={`relative -mb-px h-auto rounded-none border-b-2 px-0 py-2 font-medium ${
                    activeTab === tab.id
                      ? 'border-accent-indigo text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setActiveTab(tab.id as 'details' | 'availability')}
                >
                  {tab.label}
                </Button>
              ))}
            </nav>
          </div>

          {activeTab === 'details' ? (
            <AvailabilityRuleSetForm
              title={translate('planner.availabilityRuleSets.form.editTitle', 'Edit schedule')}
              backHref="/backend/planner/availability-rulesets"
              cancelHref="/backend/planner/availability-rulesets"
              initialValues={resolvedInitialValues}
              onSubmit={handleSubmit}
              onDelete={handleDelete}
              isLoading={!initialValues}
              loadingMessage={translate('planner.availabilityRuleSets.form.loading', 'Loading schedule...')}
            />
          ) : (
            <AvailabilityRulesEditor
              subjectType="ruleset"
              subjectId={rulesetId ?? ''}
              initialTimezone={typeof initialValues?.timezone === 'string' ? initialValues.timezone : undefined}
              labelPrefix="planner.availabilityRuleSets"
              mode="availability"
              buildScheduleItems={buildScheduleItems}
            />
          )}
        </div>
      </PageBody>
    </Page>
  )
}
