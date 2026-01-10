"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { AvailabilityRulesEditor } from '@open-mercato/core/modules/booking/backend/components/AvailabilityRulesEditor'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { useT } from '@/lib/i18n/context'

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
  const t = useT()
  const router = useRouter()
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown> | null>(null)
  const [activeTab, setActiveTab] = React.useState<'details' | 'availability'>('details')

  React.useEffect(() => {
    if (!rulesetId) return
    let cancelled = false
    async function loadRuleSet() {
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', ids: rulesetId })
        const payload = await readApiResultOrThrow<RuleSetResponse>(
          `/api/booking/availability-rule-sets?${params.toString()}`,
          undefined,
          { errorMessage: t('booking.availabilityRuleSets.form.errors.load', 'Failed to load schedule.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(t('booking.availabilityRuleSets.form.errors.notFound', 'Schedule not found.'))
        if (!cancelled) {
          setInitialValues({
            id: record.id,
            name: record.name ?? record.name_raw ?? '',
            description: record.description ?? '',
            timezone: record.timezone ?? 'UTC',
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('booking.availabilityRuleSets.form.errors.load', 'Failed to load schedule.')
        flash(message, 'error')
      }
    }
    loadRuleSet()
    return () => { cancelled = true }
  }, [rulesetId, t])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('booking.availabilityRuleSets.form.fields.name', 'Name'),
      type: 'text',
      required: true,
    },
    {
      id: 'description',
      label: t('booking.availabilityRuleSets.form.fields.description', 'Description'),
      type: 'richtext',
      editor: 'markdown',
    },
    {
      id: 'timezone',
      label: t('booking.availabilityRuleSets.form.fields.timezone', 'Timezone'),
      type: 'text',
      required: true,
    },
  ], [t])

  const handleSubmit = React.useCallback(async (values: Record<string, unknown>) => {
    if (!rulesetId) return
    const payload = {
      id: rulesetId,
      name: typeof values.name === 'string' ? values.name : '',
      description: typeof values.description === 'string' && values.description.trim().length ? values.description : null,
      timezone: typeof values.timezone === 'string' && values.timezone.trim().length ? values.timezone.trim() : 'UTC',
    }
    await updateCrud('booking/availability-rule-sets', payload, {
      errorMessage: t('booking.availabilityRuleSets.form.errors.update', 'Failed to update schedule.'),
    })
    flash(t('booking.availabilityRuleSets.form.flash.updated', 'Schedule updated.'), 'success')
  }, [rulesetId, t])

  const handleDelete = React.useCallback(async () => {
    if (!rulesetId) return
    await deleteCrud('booking/availability-rule-sets', rulesetId, {
      errorMessage: t('booking.availabilityRuleSets.form.errors.delete', 'Failed to delete schedule.'),
    })
    flash(t('booking.availabilityRuleSets.form.flash.deleted', 'Schedule deleted.'), 'success')
    router.push('/backend/booking/availability-rulesets')
  }, [router, rulesetId, t])

  const buildScheduleItems = React.useCallback(({ availabilityRules, bookedEvents, translate }) => {
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
      const baseTitle = translate(titleKey, fallback)
      const title = rule.note ? `${baseTitle}: ${rule.note}` : baseTitle
      return {
        id: rule.id,
        kind: isUnavailable ? 'exception' as const : 'availability' as const,
        title,
        startsAt: window.startAt,
        endsAt: window.endAt,
        metadata: { rule },
      }
    })
    return availabilityItems
  }, [])

  const tabs = React.useMemo(() => ([
    { id: 'details', label: t('booking.availabilityRuleSets.tabs.details', 'Details') },
    { id: 'availability', label: t('booking.availabilityRuleSets.tabs.availability', 'Availability') },
  ]), [t])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="border-b">
            <nav className="flex flex-wrap items-center gap-5 text-sm" aria-label={t('booking.availabilityRuleSets.tabs.label', 'Schedule sections')}>
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
            <CrudForm
              title={t('booking.availabilityRuleSets.form.editTitle', 'Edit schedule')}
              backHref="/backend/booking/availability-rulesets"
              cancelHref="/backend/booking/availability-rulesets"
              fields={fields}
              initialValues={initialValues ?? undefined}
              onSubmit={handleSubmit}
              onDelete={handleDelete}
              isLoading={!initialValues}
              loadingMessage={t('booking.availabilityRuleSets.form.loading', 'Loading schedule...')}
            />
          ) : (
            <AvailabilityRulesEditor
              subjectType="ruleset"
              subjectId={rulesetId ?? ''}
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
