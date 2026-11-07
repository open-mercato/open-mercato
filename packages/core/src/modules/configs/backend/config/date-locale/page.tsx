"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError, type CrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { formatDisplayDate, formatDisplayDateTime, formatDisplayTime } from '@open-mercato/ui/primitives/date-format'
import { resolveDisplayTimeZone } from '@open-mercato/ui/primitives/date-locale-settings'
import { resolveFirstDayOfWeek, type ResolvedFirstDayOfWeek } from '@open-mercato/shared/lib/date-locale/weekStart'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { DATE_LOCALE_AUTO } from '@open-mercato/shared/lib/date-locale/presets'
import type {
  DateLocaleEnvDefaults,
  DateLocaleField,
  DateLocaleSource,
  NormalizedDateLocaleSettingsRecord,
} from '@open-mercato/shared/lib/date-locale/types'
import {
  CUSTOM_PATTERN,
  PATTERN_FIELDS,
  buildDateLocaleFormValues,
  buildDateLocalePayload,
  remapDateLocaleFieldErrors,
  type DateLocaleFormValues,
} from '../../../lib/dateLocaleForm'
import { listSupportedTimeZones } from '@open-mercato/shared/lib/date/timezone'

type DateLocaleResponse = {
  settings: NormalizedDateLocaleSettingsRecord
  envDefaults: DateLocaleEnvDefaults
  updatedAt: string | null
}

const API_PATH = 'configs/date-locale'

// Only locales with a bundled date-fns locale (`ui/primitives/date-fns-locales.ts`): any other one
// renders the month and weekday names of a custom pattern in English.
const LOCALE_OPTIONS = ['en-US', 'en-GB', 'pl-PL', 'de-DE', 'es-ES', 'ko-KR']

const PREVIEW_SAMPLE = new Date(Date.UTC(2026, 11, 31, 13, 45))

function weekdayName(day: number, locale: string): string {
  const reference = new Date(Date.UTC(2026, 0, 4 + day))
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(reference)
}

function describeWeekStart(
  resolved: ResolvedFirstDayOfWeek,
  locale: string,
  t: ReturnType<typeof useT>,
): string {
  const day = weekdayName(resolved.day, locale)
  if (resolved.source === 'locale') {
    return t('configs.dateLocale.weekStart.fromLocale', '{{day}} (from the {{locale}} formatting locale)', { day, locale: resolved.locale ?? '' })
  }
  if (resolved.source === 'default') {
    return t('configs.dateLocale.weekStart.default', '{{day}} (default — no formatting locale set)', { day })
  }
  return day
}

export default function DateLocaleSettingsPage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chromePayload } = useBackendChrome()
  const canManage = hasFeature(chromePayload?.grantedFeatures, 'configs.date_locale.manage')

  const [data, setData] = React.useState<DateLocaleResponse | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoadError(null)
    try {
      const payload = await readApiResultOrThrow<DateLocaleResponse>(`/api/${API_PATH}`, undefined, {
        errorMessage: t('configs.dateLocale.errors.load', 'Failed to load date and time settings.'),
      })
      setData(payload)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('configs.dateLocale.errors.load', 'Failed to load date and time settings.'))
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load, scopeVersion])

  const sourceLabel = React.useCallback(
    (source: DateLocaleSource, field: DateLocaleField) => {
      if (source === 'env') return t('configs.dateLocale.source.env', 'from the deployment environment')
      if (field === 'timeZone') return t('configs.dateLocale.source.device', 'nothing configured')
      return t('configs.dateLocale.source.fallback', 'from the language')
    },
    [t],
  )

  const inheritedHint = React.useCallback(
    (field: DateLocaleField, render: (value: string) => string = (value) => value) => {
      if (!data) return undefined
      const inherited = resolveDateLocaleSettings({ env: data.envDefaults })
      const value = inherited[field]
      if (field === 'dateTimeFormat' && value === null) {
        return t(
          'configs.dateLocale.inherit.dateTimeDerived',
          'Automatic uses the date format followed by the time format (or the locale’s short time); with no date format set, the locale default.',
        )
      }
      const emptyLabel = field === 'timeZone'
        ? t('configs.dateLocale.inherit.viewerDevice', 'each viewer’s device time zone')
        : t('configs.dateLocale.inherit.localeDefault', 'locale default')
      const label = value === null ? emptyLabel : render(String(value))
      const hint = t('configs.dateLocale.inherit.hint', 'Automatic uses {{value}} ({{source}}).', {
        value: label,
        source: sourceLabel(inherited.sources[field], field),
      })
      if (field !== 'dateTimeFormat') return hint
      return `${hint} ${t(
        'configs.dateLocale.inherit.dateTimeFollowsDate',
        'A date format chosen here takes precedence: timestamps then use it followed by the time format (or the locale’s short time).',
      )}`
    },
    [data, sourceLabel, t],
  )

  const fields = React.useMemo<CrudField[]>(() => {
    const autoOption = { value: DATE_LOCALE_AUTO, label: t('configs.dateLocale.options.auto', 'Automatic') }
    const customOption = { value: CUSTOM_PATTERN, label: t('configs.dateLocale.options.custom', 'Custom pattern…') }
    const patternLabels: Record<(typeof PATTERN_FIELDS)[number]['id'], string> = {
      dateFormat: t('configs.dateLocale.fields.dateFormat', 'Date format'),
      dateTimeFormat: t('configs.dateLocale.fields.dateTimeFormat', 'Date and time format'),
      timeFormat: t('configs.dateLocale.fields.timeFormat', 'Time format'),
    }
    const patternFields = PATTERN_FIELDS.flatMap<CrudField>((field) => [
      {
        id: `${field.id}Mode`,
        type: 'select',
        label: patternLabels[field.id],
        description: inheritedHint(field.id),
        options: [
          autoOption,
          ...field.presets.map((preset) => ({
            value: preset,
            label: `${preset} — ${formatDisplayDateTime(PREVIEW_SAMPLE, locale, {
              locale: null, dateFormat: preset, dateTimeFormat: preset, timeFormat: preset, timeZone: 'UTC',
            }) ?? preset}`,
          })),
          customOption,
        ],
        disabled: !canManage,
        layout: 'half',
      },
      {
        id: `${field.id}Custom`,
        type: 'text',
        label: t('configs.dateLocale.fields.customPattern', 'Custom pattern'),
        placeholder: field.presets[0],
        description: t(
          'configs.dateLocale.fields.customPatternHint',
          "Uses date-fns tokens, for example dd.MM.yyyy or h:mm a. Wrap literal text in single quotes: unquoted letters are tokens, so write d MMM 'at' HH:mm, not d MMM at HH:mm.",
        ),
        visibleWhen: { field: `${field.id}Mode`, equals: CUSTOM_PATTERN },
        maxLength: 64,
        disabled: !canManage,
        layout: 'half',
      },
    ])
    return [
      {
        id: 'locale',
        type: 'select',
        label: t('configs.dateLocale.fields.locale', 'Formatting locale'),
        description: inheritedHint('locale'),
        options: [
          autoOption,
          ...[...LOCALE_OPTIONS, ...(data?.settings.locale && !LOCALE_OPTIONS.includes(data.settings.locale) ? [data.settings.locale] : [])]
            .map((code) => ({ value: code, label: code })),
        ],
        disabled: !canManage,
        layout: 'half',
      },
      {
        id: 'timeZone',
        type: 'combobox',
        label: t('configs.dateLocale.fields.timeZone', 'Time zone'),
        description: inheritedHint('timeZone'),
        options: [
          { value: DATE_LOCALE_AUTO, label: t('configs.dateLocale.options.autoTimeZone', "Automatic (each viewer's device)") },
          ...listSupportedTimeZones(data?.settings.timeZone).map((zone) => ({ value: zone, label: zone })),
        ],
        allowCustomValues: false,
        disabled: !canManage,
        layout: 'half',
      },
      {
        id: 'firstDayOfWeek',
        type: 'select',
        label: t('configs.dateLocale.fields.firstDayOfWeek', 'First day of the week'),
        description: data
          ? t('configs.dateLocale.weekStart.hint', 'Automatic uses the formatting locale’s week start, or Monday when no locale is set. Currently: {{value}}.', {
            value: describeWeekStart(
              resolveFirstDayOfWeek({
                firstDayOfWeek: null,
                locale: resolveDateLocaleSettings({ tenant: data.settings, env: data.envDefaults }).locale,
              }),
              locale,
              t,
            ),
          })
          : undefined,
        options: [autoOption, ...[1, 2, 3, 4, 5, 6, 0].map((day) => ({ value: String(day), label: weekdayName(day, locale) }))],
        disabled: !canManage,
        layout: 'half',
      },
      ...patternFields,
    ]
  }, [canManage, data, inheritedHint, locale, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'regional',
      title: t('configs.dateLocale.groups.regional', 'Region'),
      column: 1,
      fields: ['locale', 'timeZone', 'firstDayOfWeek'],
    },
    {
      id: 'formats',
      title: t('configs.dateLocale.groups.formats', 'Formats'),
      column: 1,
      fields: PATTERN_FIELDS.flatMap((field) => [`${field.id}Mode`, `${field.id}Custom`]),
    },
    {
      id: 'preview',
      title: t('configs.dateLocale.groups.preview', 'Preview'),
      column: 2,
      component: ({ values }) => {
        if (!data) return null
        const preview = resolveDateLocaleSettings({
          tenant: buildDateLocalePayload(values as Partial<DateLocaleFormValues>),
          env: data.envDefaults,
        })
        const weekStart = resolveFirstDayOfWeek(preview)
        const rows: Array<[string, string]> = [
          [t('configs.dateLocale.preview.date', 'Date'), formatDisplayDate(PREVIEW_SAMPLE, locale, preview) ?? '—'],
          [t('configs.dateLocale.preview.dateTime', 'Date and time'), formatDisplayDateTime(PREVIEW_SAMPLE, locale, preview) ?? '—'],
          [t('configs.dateLocale.preview.time', 'Time'), formatDisplayTime(PREVIEW_SAMPLE, locale, preview) ?? '—'],
          [t('configs.dateLocale.preview.timeZone', 'Time zone'), resolveDisplayTimeZone(preview)],
          [t('configs.dateLocale.preview.weekStart', 'Week starts on'), describeWeekStart(weekStart, preview.locale ?? locale, t)],
        ]
        return (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm" data-testid="date-locale-preview">
            {rows.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        )
      },
    },
  ], [data, locale, t])

  const initialValues = React.useMemo(
    () => (data ? buildDateLocaleFormValues(data.settings, data.updatedAt) : undefined),
    [data],
  )

  const handleSubmit = React.useCallback(async (values: DateLocaleFormValues) => {
    try {
      await updateCrud(API_PATH, buildDateLocalePayload(values), {
        errorMessage: t('configs.dateLocale.errors.save', 'Failed to save date and time settings.'),
      })
    } catch (error) {
      const failure = error as CrudFormError
      const fieldErrors = remapDateLocaleFieldErrors(failure.fieldErrors)
      if (!fieldErrors) throw error
      throw createCrudFormError(failure.message, fieldErrors, { status: failure.status, details: failure.details })
    }
    flash(t('configs.dateLocale.flash.saved', 'Date and time settings saved.'), 'success')
    await load()
    router.refresh()
  }, [load, router, t])

  return (
    <Page>
      <PageBody>
        {loadError ? (
          <ErrorMessage label={loadError} />
        ) : !data || !initialValues ? (
          <LoadingMessage label={t('configs.dateLocale.loading', 'Loading date and time settings…')} />
        ) : (
          <div className="space-y-4">
            {canManage ? null : (
              <Alert status="information">
                <AlertDescription>
                  {t('configs.dateLocale.readOnly', 'You can view these settings but not change them.')}
                </AlertDescription>
              </Alert>
            )}
            <CrudForm<DateLocaleFormValues>
              key={data.updatedAt ?? 'unsaved'}
              title={t('configs.dateLocale.title', 'Date & time')}
              fields={fields}
              groups={groups}
              initialValues={initialValues}
              optimisticLockUpdatedAt={data.updatedAt}
              submitLabel={t('configs.dateLocale.save', 'Save settings')}
              onSubmit={handleSubmit}
              hideFooterActions={!canManage}
            />
          </div>
        )}
      </PageBody>
    </Page>
  )
}
