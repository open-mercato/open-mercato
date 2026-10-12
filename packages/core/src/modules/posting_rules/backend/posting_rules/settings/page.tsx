'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { loadClass4AccountOptions, loadClass5AccountOptions } from '../../lib/optionLoaders'
import { ClearingAccountBanner } from '../../../components/ClearingAccountBanner'

type PostingRulesSettingsData = {
  settingsId: string
  clearingAccountId: string | null
  unallocatedCostAccountId: string | null
  updatedAt: string | null
}

// A single-row settings resource (one `PostingRulesSettings` row per
// organization, upserted — never created/listed like a normal CRUD
// entity), matching `FixedAssetSettings`'s own precedent per the spec's
// Design Decisions. `GET`/`PATCH /api/posting_rules/settings` are called
// directly rather than through `createCrud`/`updateCrud`, since this
// isn't a standard `id`-keyed CRUD resource.
export default function PostingRulesSettingsPage() {
  const t = useT()

  const [settings, setSettings] = React.useState<PostingRulesSettingsData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await apiCall<PostingRulesSettingsData>('/api/posting_rules/settings')
        if (cancelled) return
        if (response.ok && response.result) {
          setSettings(response.result)
        } else {
          setError(t('posting_rules.settings.error.load', 'Failed to load posting rules settings'))
        }
      } catch {
        if (!cancelled) setError(t('posting_rules.settings.error.load', 'Failed to load posting rules settings'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [t])

  // Whether the chart of accounts has any account of class 4 (clearing
  // account) and class 5 (reclassification targets). `null` while loading.
  // The pickers fall back to the unfiltered list when the class cannot be
  // resolved, so a count of 0 only appears when the class exists and is empty.
  const [classCounts, setClassCounts] = React.useState<{ class4: number; class5: number } | null>(null)
  React.useEffect(() => {
    let cancelled = false
    Promise.all([loadClass4AccountOptions(), loadClass5AccountOptions()])
      .then(([class4, class5]) => {
        if (!cancelled) setClassCounts({ class4: class4.length, class5: class5.length })
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('posting_rules.settings.group.details', 'Accounts'),
        fields: [
          {
            id: 'clearingAccountId',
            type: 'select',
            label: t('posting_rules.settings.field.clearingAccount', 'Clearing account (account 490 equivalent)'),
            placeholder: t('posting_rules.settings.field.placeholder', 'None'),
            loadOptions: loadClass4AccountOptions,
          },
          {
            id: 'unallocatedCostAccountId',
            type: 'select',
            label: t('posting_rules.settings.field.unallocatedCostAccount', 'Unallocated-cost account'),
            placeholder: t('posting_rules.settings.field.placeholder', 'None'),
            loadOptions: loadClass5AccountOptions,
          },
        ],
      },
    ],
    [t],
  )

  if (loading) {
    return (
      <Page>
        <PageBody>
          <DataLoader isLoading loadingMessage={t('posting_rules.settings.loading', 'Loading posting rules settings…')}>
            <></>
          </DataLoader>
        </PageBody>
      </Page>
    )
  }

  if (error || !settings) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('posting_rules.settings.error.load', 'Failed to load posting rules settings')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <ClearingAccountBanner clearingAccountId={settings.clearingAccountId} />
        {classCounts && classCounts.class4 === 0 ? (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>
              {t(
                'posting_rules.settings.hint.noClass4Accounts',
                'There is no account of class 4 in the chart of accounts. Create the clearing account (490) as an account of an account type in group 4 first.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        {classCounts && classCounts.class5 === 0 ? (
          <Alert variant="warning" className="mb-4">
            <AlertDescription>
              {t(
                'posting_rules.settings.hint.noClass5Accounts',
                'There is no account of class 5 in the chart of accounts. The default chart ships only a few; add the cost-by-function accounts your business needs.',
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        <CrudForm
          title={t('posting_rules.settings.page.title', 'Posting rules settings')}
          titleHeadingLevel={1}
          fields={[]}
          groups={groups}
          optimisticLockUpdatedAt={settings.updatedAt}
          initialValues={{
            clearingAccountId: settings.clearingAccountId ?? '',
            unallocatedCostAccountId: settings.unallocatedCostAccountId ?? '',
          }}
          submitLabel={t('posting_rules.settings.action.save', 'Save changes')}
          onSubmit={async (values) => {
            const payload = {
              clearingAccountId: values.clearingAccountId ? String(values.clearingAccountId) : null,
              unallocatedCostAccountId: values.unallocatedCostAccountId ? String(values.unallocatedCostAccountId) : null,
            }

            const response = await apiCall<PostingRulesSettingsData>('/api/posting_rules/settings', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (!response.ok || !response.result) {
              throw new Error(t('posting_rules.settings.error.save', 'Failed to save posting rules settings'))
            }

            setSettings(response.result)
            flash(t('posting_rules.settings.success.save', 'Posting rules settings saved'), 'success')
          }}
        />
      </PageBody>
    </Page>
  )
}
