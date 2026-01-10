"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import { AvailabilityRulesEditor, type AvailabilityScheduleItemBuilder } from '@open-mercato/core/modules/booking/components/AvailabilityRulesEditor'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { extractCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields-client'
import { useT } from '@/lib/i18n/context'
import { AvailabilityRuleSetForm, buildAvailabilityRuleSetPayload, type AvailabilityRuleSetFormValues } from '@open-mercato/core/modules/booking/components/AvailabilityRuleSetForm'

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
  name_raw?: string | null
} & Record<string, unknown>

type RuleSetResponse = {
  items?: RuleSetRecord[]
}

export default function BookingAvailabilityRuleSetDetailPage({ params }: { params?: { id?: string } }) {
  const rulesetId = params?.id
  const translate = useT()
  const router = useRouter()
  const [initialValues, setInitialValues] = React.useState<AvailabilityRuleSetFormValues | null>(null)
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')

  React.useEffect(() => {
    if (!rulesetId) return
    const rulesetIdValue = rulesetId
    let cancelled = false
    async function loadRuleSet() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: rulesetIdValue })
        const payload = await readApiResultOrThrow<RuleSetResponse>(
          `/api/booking/availability-rule-sets?${params.toString()}`,
          undefined,
          { errorMessage: translate('booking.availabilityRuleSets.form.errors.load', 'Failed to load schedule.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(translate('booking.availabilityRuleSets.form.errors.notFound', 'Schedule not found.'))
        const customFields = extractCustomFieldEntries(record)
        if (!cancelled) {
          setInitialValues({
            id: record.id,
            name: record.name ?? record.name_raw ?? '',
            description: record.description ?? '',
            timezone: record.timezone ?? 'UTC',
            ...customFields,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : translate('booking.availabilityRuleSets.form.errors.load', 'Failed to load schedule.')
        flash(message, 'error')
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
    await updateCrud('booking/availability-rule-sets', payload, {
      errorMessage: translate('booking.availabilityRuleSets.form.errors.update', 'Failed to update schedule.'),
    })
    flash(translate('booking.availabilityRuleSets.form.flash.updated', 'Schedule updated.'), 'success')
    router.push('/backend/booking/availability-rulesets')
  }, [initialValues?.timezone, router, rulesetId, translate])

  const handleDelete = React.useCallback(async () => {
    if (!rulesetId) return
    try {
      await deleteCrud('booking/availability-rule-sets', rulesetId, {
        errorMessage: translate('booking.availabilityRuleSets.form.errors.delete', 'Failed to delete schedule.'),
      })
      flash(translate('booking.availabilityRuleSets.form.flash.deleted', 'Schedule deleted.'), 'success')
      router.push('/backend/booking/availability-rulesets')
    } catch (error) {
      const normalized = normalizeCrudServerError(error)
      flash(
        normalized.message ?? translate('booking.availabilityRuleSets.form.errors.delete', 'Failed to delete schedule.'),
        'error',
      )
    }
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
        ? 'booking.availabilityRuleSets.availability.title.unavailable'
        : `booking.availabilityRuleSets.availability.title.${window.repeat}`
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
    { id: 'details', label: translate('booking.availabilityRuleSets.tabs.details', 'Details') },
    { id: 'availability', label: translate('booking.availabilityRuleSets.tabs.availability', 'Availability') },
  ]), [translate])

  const resolvedInitialValues = initialValues ?? {}

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="border-b">
            <nav className="flex flex-wrap items-center gap-5 text-sm" aria-label={translate('booking.availabilityRuleSets.tabs.label', 'Schedule sections')}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id as 'details' | 'availability')}
                  className={`relative -mb-px border-b-2 px-0 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {activeTab === 'details' ? (
            <AvailabilityRuleSetForm
              title={translate('booking.availabilityRuleSets.form.editTitle', 'Edit schedule')}
              backHref="/backend/booking/availability-rulesets"
              cancelHref="/backend/booking/availability-rulesets"
              initialValues={resolvedInitialValues}
              onSubmit={handleSubmit}
              onDelete={handleDelete}
              isLoading={!initialValues}
              loadingMessage={translate('booking.availabilityRuleSets.form.loading', 'Loading schedule...')}
            />
          ) : (
            <AvailabilityRulesEditor
              subjectType="ruleset"
              subjectId={rulesetId ?? ''}
              initialTimezone={typeof initialValues?.timezone === 'string' ? initialValues.timezone : undefined}
              labelPrefix="booking.availabilityRuleSets"
              mode="availability"
              buildScheduleItems={buildScheduleItems}
            />
          )}
        </div>
      </PageBody>
    </Page>
  )
}
