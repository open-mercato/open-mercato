'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { loadLedgerAccountOptions } from '../../lib/optionLoaders'
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
            loadOptions: loadLedgerAccountOptions,
          },
          {
            id: 'unallocatedCostAccountId',
            type: 'select',
            label: t('posting_rules.settings.field.unallocatedCostAccount', 'Unallocated-cost account'),
            placeholder: t('posting_rules.settings.field.placeholder', 'None'),
            loadOptions: loadLedgerAccountOptions,
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
