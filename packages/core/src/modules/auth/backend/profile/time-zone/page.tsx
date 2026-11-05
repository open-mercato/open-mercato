"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { useDateLocaleSettings } from '@open-mercato/ui/primitives/date-locale-settings'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { listSupportedTimeZones } from '@open-mercato/shared/lib/date/timezone'

const ORGANIZATION_DEFAULT = 'organization'

type ProfileResponse = { timezone?: string | null }
type TimeZoneFormValues = { timezone: string }

export default function ProfileTimeZonePage() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const settings = useDateLocaleSettings()
  const [timezone, setTimezone] = React.useState<string | null | undefined>(undefined)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoadError(null)
    try {
      const payload = await readApiResultOrThrow<ProfileResponse>('/api/auth/profile', undefined, {
        errorMessage: t('auth.profile.timeZone.errors.load', 'Failed to load your time zone.'),
      })
      setTimezone(payload.timezone ?? null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('auth.profile.timeZone.errors.load', 'Failed to load your time zone.'))
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'timezone',
      type: 'combobox',
      label: t('auth.profile.timeZone.field', 'Time zone'),
      description: t(
        'auth.profile.timeZone.fieldHint',
        'Dates and times across the app are shown in this zone. Choose the organization default to follow your administrator’s setting.',
      ),
      options: [
        { value: ORGANIZATION_DEFAULT, label: t('auth.profile.timeZone.organizationDefault', 'Organization default') },
        ...listSupportedTimeZones(timezone).map((zone) => ({ value: zone, label: zone })),
      ],
      allowCustomValues: false,
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
  ], [locale, settings, t, timezone])

  const handleSubmit = React.useCallback(async (values: TimeZoneFormValues) => {
    const next = values.timezone && values.timezone !== ORGANIZATION_DEFAULT ? values.timezone : null
    // optimistic-lock-exempt: a personal preference only its owner can edit through
    // /api/auth/profile; there is no concurrent editor whose change could be lost.
    await updateCrud('auth/profile', { timezone: next }, {
      errorMessage: t('auth.profile.timeZone.errors.save', 'Failed to save your time zone.'),
    })
    setTimezone(next)
    flash(t('auth.profile.timeZone.saved', 'Time zone saved.'), 'success')
    router.refresh()
  }, [router, t])

  return (
    <Page>
      <PageBody>
        {loadError ? (
          <ErrorMessage label={loadError} />
        ) : timezone === undefined ? (
          <LoadingMessage label={t('auth.profile.timeZone.loading', 'Loading your time zone…')} />
        ) : (
          <CrudForm<TimeZoneFormValues>
            key={timezone ?? ORGANIZATION_DEFAULT}
            title={t('auth.profile.timeZone.pageTitle', 'Time zone')}
            fields={fields}
            initialValues={{ timezone: timezone ?? ORGANIZATION_DEFAULT }}
            // Zone options use the zone name as both value and label, which ComboboxInput treats
            // as an unresolved placeholder and will not paint into a focused input, so focusing
            // the only field on load would show the saved zone as an empty box.
            disableInitialFocus
            disableOptimisticLock
            submitLabel={t('auth.profile.timeZone.save', 'Save time zone')}
            onSubmit={handleSubmit}
          />
        )}
      </PageBody>
    </Page>
  )
}
