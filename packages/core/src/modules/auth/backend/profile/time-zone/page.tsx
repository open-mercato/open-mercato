"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { useDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-settings'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { listSupportedTimeZones } from '@open-mercato/shared/lib/date/timezone'

const ORGANIZATION_DEFAULT = 'organization'

type ProfileResponse = { timezone?: string | null; updatedAt?: string | null }
type TimeZoneFormValues = { timezone: string; updatedAt?: string | null }

export default function ProfileTimeZonePage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const settings = useDateLocaleSettings()
  const pickerId = React.useId()
  const draftTimezone = React.useRef<string | null>(null)
  const [timezone, setTimezone] = React.useState<string | null | undefined>(undefined)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoadError(null)
    try {
      const payload = await readApiResultOrThrow<ProfileResponse>('/api/auth/profile', undefined, {
        errorMessage: t('auth.profile.timeZone.errors.load', 'Failed to load your time zone.'),
      })
      setTimezone(payload.timezone ?? null)
      setUpdatedAt(payload.updatedAt ?? null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('auth.profile.timeZone.errors.load', 'Failed to load your time zone.'))
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const timezoneOptions = React.useMemo(() => [
    { value: ORGANIZATION_DEFAULT, label: t('auth.profile.timeZone.organizationDefault', 'Organization default') },
    ...listSupportedTimeZones(timezone).map((zone) => ({ value: zone, label: zone })),
  ], [t, timezone])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'timezone',
      type: 'custom',
      label: t('auth.profile.timeZone.field', 'Time zone'),
      description: t(
        'auth.profile.timeZone.fieldHint',
        'Dates and times across the app are shown in this zone. Choose the organization default to follow your administrator’s setting.',
      ),
      rendersOwnError: true,
      component: ({ value, setValue, error, disabled }) => (
        <div onChangeCapture={(event) => {
          if (event.target instanceof HTMLInputElement) draftTimezone.current = event.target.value
        }}>
          <label htmlFor={pickerId} className="sr-only">{t('auth.profile.timeZone.field', 'Time zone')}</label>
          <ComboboxInput
            id={pickerId}
            value={typeof value === 'string' ? value : ''}
            onChange={(next) => {
              draftTimezone.current = null
              setValue(next)
            }}
            suggestions={timezoneOptions}
            allowCustomValues={false}
            clearable
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${pickerId}-error` : undefined}
          />
          {error ? <p id={`${pickerId}-error`} className="mt-2 text-xs text-status-error-text">{error}</p> : null}
        </div>
      ),
    },
    {
      id: 'preview',
      type: 'custom',
      label: t('auth.profile.timeZone.preview', 'Current time'),
      component: ({ values }) => {
        const choice = typeof values?.timezone === 'string' ? values.timezone : ORGANIZATION_DEFAULT
        if (choice === ORGANIZATION_DEFAULT && settings.sources.timeZone === 'user') {
          return (
            <p className="text-sm text-muted-foreground" data-testid="profile-time-zone-preview">
              {t('auth.profile.timeZone.previewAfterSave', 'Shown in the organization time zone after you save.')}
            </p>
          )
        }
        const zone = choice === ORGANIZATION_DEFAULT ? settings.timeZone : choice
        return (
          <p className="text-sm font-medium tabular-nums" data-testid="profile-time-zone-preview">
            {formatDisplayDateTime(new Date(), locale, { ...settings, timeZone: zone }) ?? '—'}
          </p>
        )
      },
    },
  ], [locale, pickerId, settings, t, timezoneOptions])

  const handleSubmit = React.useCallback(async (values: TimeZoneFormValues) => {
    const draft = draftTimezone.current?.trim().toLowerCase()
    const choice = draft
      ? timezoneOptions.find((option) => option.label.toLowerCase() === draft)?.value
      : (draft ?? values.timezone)
    if (choice === undefined) {
      const message = t('auth.profile.errors.timeZone', 'Choose a time zone from the list.')
      throw createCrudFormError(message, { timezone: message })
    }
    const next = choice && choice !== ORGANIZATION_DEFAULT ? choice : null
    const saved = await updateCrud<ProfileResponse>('auth/profile', { timezone: next }, {
      errorMessage: t('auth.profile.timeZone.errors.save', 'Failed to save your time zone.'),
    })
    draftTimezone.current = null
    setUpdatedAt(saved.result?.updatedAt ?? null)
    setTimezone(next)
    flash(t('auth.profile.timeZone.saved', 'Time zone saved.'), 'success')
    router.refresh()
  }, [router, t, timezoneOptions])

  return (
    <Page>
      <PageBody>
        {loadError ? (
          <ErrorMessage label={loadError} />
        ) : timezone === undefined ? (
          <LoadingMessage label={t('auth.profile.timeZone.loading', 'Loading your time zone…')} />
        ) : (
          <CrudForm<TimeZoneFormValues>
            key={`${timezone ?? ORGANIZATION_DEFAULT}:${updatedAt ?? ''}`}
            title={t('auth.profile.timeZone.pageTitle', 'Time zone')}
            fields={fields}
            initialValues={{ timezone: timezone ?? ORGANIZATION_DEFAULT, updatedAt }}
            // Zone options use the zone name as both value and label, which ComboboxInput treats
            // as an unresolved placeholder and will not paint into a focused input, so focusing
            // the only field on load would show the saved zone as an empty box.
            disableInitialFocus
            submitLabel={t('auth.profile.timeZone.save', 'Save time zone')}
            onSubmit={handleSubmit}
          />
        )}
      </PageBody>
    </Page>
  )
}
