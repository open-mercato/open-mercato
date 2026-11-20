'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { RecordNotFoundState, ErrorMessage } from '@open-mercato/ui/backend/detail'

type CostCenterData = {
  id: string
  code: string
  name: string
  isActive: boolean
  organizationId: string
  tenantId: string
  updatedAt: string | null
}

export default function EditCostCenterPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()

  const [costCenter, setCostCenter] = React.useState<CostCenterData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    async function load() {
      try {
        const response = await apiCall<{ items: CostCenterData[] }>(`/api/posting_rules/cost-centers?id=${params?.id}`)
        if (response.ok && response.result && response.result.items.length > 0) {
          setCostCenter(response.result.items[0])
        } else if (!response.ok) {
          setError(t('posting_rules.cost_centers.form.errors.load', 'Failed to load this cost centre'))
        } else {
          setIsNotFound(true)
        }
      } catch {
        setError(t('posting_rules.cost_centers.form.errors.load', 'Failed to load this cost centre'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [params, t])

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('posting_rules.cost_centers.form.group.details', 'Details'),
        fields: [
          { id: 'code', type: 'text', label: t('posting_rules.cost_centers.form.field.code', 'Code'), required: true, maxLength: 100 },
          { id: 'name', type: 'text', label: t('posting_rules.cost_centers.form.field.name', 'Name'), required: true, maxLength: 200 },
          { id: 'isActive', type: 'checkbox', label: t('posting_rules.cost_centers.form.field.isActive', 'Active') },
        ],
      },
    ],
    [t],
  )

  if (loading) {
    return (
      <Page>
        <PageBody>
          <DataLoader isLoading loadingMessage={t('posting_rules.cost_centers.form.loading', 'Loading cost centre…')}>
            <></>
          </DataLoader>
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('posting_rules.cost_centers.form.errors.notFound', 'Cost centre not found.')}
            backHref="/backend/cost-centers"
            backLabel={t('posting_rules.cost_centers.form.actions.backToList', 'Back to cost centres')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !costCenter) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('posting_rules.cost_centers.form.errors.notFound', 'Cost centre not found.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('posting_rules.cost_centers.edit.title', 'Edit cost centre')}
          titleHeadingLevel={1}
          backHref="/backend/cost-centers"
          fields={[]}
          groups={groups}
          optimisticLockUpdatedAt={costCenter.updatedAt}
          initialValues={{
            code: costCenter.code,
            name: costCenter.name,
            isActive: costCenter.isActive,
          }}
          submitLabel={t('posting_rules.cost_centers.form.action.save', 'Save changes')}
          cancelHref="/backend/cost-centers"
          onSubmit={async (values) => {
            const payload = {
              id: costCenter.id,
              code: String(values.code || '').trim(),
              name: String(values.name || '').trim(),
              isActive: values.isActive !== false,
            }

            await updateCrud('posting_rules/cost-centers', payload)

            flash(t('posting_rules.cost_centers.form.success.updated', 'Cost centre updated'), 'success')
            router.push('/backend/cost-centers')
          }}
        />
      </PageBody>
    </Page>
  )
}
