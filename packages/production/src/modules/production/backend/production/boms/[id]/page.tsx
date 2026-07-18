'use client'

import * as React from 'react'
import type { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { bomUpdateSchema } from '../../../../data/validators.js'
import { BomItemsEditor, type BomItemRow } from '../../components/BomItemsEditor'
import { CostRollupPanel } from '../../components/CostRollupPanel'

const bomEditSchema = bomUpdateSchema.omit({ id: true })
type BomEditValues = z.infer<typeof bomEditSchema>

type BomDetail = {
  id: string
  productId: string
  variantId: string | null
  version: number
  status: 'draft' | 'active' | 'archived'
  validFrom: string | null
  validTo: string | null
  name: string
  updatedAt: string
  items: BomItemRow[]
}

export default function EditBomPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const [record, setRecord] = React.useState<BomDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const loadRecord = React.useCallback(async () => {
    if (!params?.id) return
    setLoading(true)
    try {
      const call = await apiCall<BomDetail>(`/api/production/boms/${params.id}`)
      if (call.ok && call.result) {
        setRecord(call.result)
      } else if (call.status === 404) {
        setIsNotFound(true)
      } else {
        setError(t('production.boms.error.load_failed', 'Failed to load BOM'))
      }
    } catch {
      setError(t('production.boms.error.load_failed', 'Failed to load BOM'))
    } finally {
      setLoading(false)
    }
  }, [params?.id, t])

  React.useEffect(() => {
    loadRecord()
  }, [loadRecord])

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'name', type: 'text', label: t('production.boms.field.name', 'Name'), required: true },
      {
        id: 'status',
        type: 'select',
        label: t('production.boms.field.status', 'Status'),
        layout: 'half',
        options: [
          { value: 'draft', label: t('production.status.draft', 'Draft') },
          { value: 'active', label: t('production.status.active', 'Active') },
          { value: 'archived', label: t('production.status.archived', 'Archived') },
        ],
      },
      { id: 'validFrom', type: 'date', label: t('production.boms.field.valid_from', 'Valid from'), layout: 'half' },
      { id: 'validTo', type: 'date', label: t('production.boms.field.valid_to', 'Valid to'), layout: 'half' },
      {
        id: 'items',
        type: 'custom',
        label: t('production.boms.items.title', 'BOM items'),
        layout: 'full',
        component: ({ value, setValue }) => (
          <BomItemsEditor value={(value as BomItemRow[]) ?? []} onChange={setValue} t={t} />
        ),
      },
    ],
    [t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!record) return
    try {
      // CrudForm already wraps onDelete with withScopedApiRequestHeaders(
      // buildOptimisticLockHeader(optimisticLockUpdatedAt), ...), so no manual
      // header wrap is needed here.
      await deleteCrud('production/boms', { id: record.id })
      flash(t('production.boms.success.deleted', 'BOM deleted successfully'), 'success')
      router.push('/backend/production/boms')
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      flash(t('production.boms.error.delete_failed', 'Failed to delete BOM'), 'error')
    }
  }, [record, t, router])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('production.boms.loading', 'Loading BOM...')} />
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('production.boms.error.not_found', 'BOM not found')}
            backHref="/backend/production/boms"
            backLabel={t('production.boms.title', 'Bills of Materials')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('production.boms.error.not_found', 'BOM not found')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CostRollupPanel bomId={record.id} t={t} />
        <CrudForm<BomEditValues>
          title={t('production.boms.edit.title', 'Edit BOM')}
          backHref="/backend/production/boms"
          fields={fields}
          schema={bomEditSchema}
          optimisticLockUpdatedAt={record.updatedAt}
          initialValues={{
            name: record.name,
            status: record.status,
            validFrom: record.validFrom ?? undefined,
            validTo: record.validTo ?? undefined,
            items: record.items,
          } as unknown as Partial<BomEditValues>}
          submitLabel={t('production.boms.form.save', 'Save changes')}
          cancelHref="/backend/production/boms"
          onDelete={handleDelete}
          onSubmit={async (values) => {
            try {
              await updateCrud('production/boms', { id: record.id, ...values })
            } catch (err) {
              if (surfaceRecordConflict(err, t)) return
              throw err
            }
            flash(t('production.boms.success.updated', 'BOM updated successfully'), 'success')
            router.push('/backend/production/boms')
          }}
        />
      </PageBody>
    </Page>
  )
}
