/**
 * Detail page template (lineage: om-ds-guardian page-templates.md §Detail Page,
 * upgraded to the shipped primitives: FormHeader mode="detail" + Tabs
 * variant="underline", optimistic locking via initialValues.updatedAt).
 *
 * Deliberately stays on public primitives — the customers module's
 * DetailTabsLayout is module-internal and MUST NOT be copied here.
 */
export const detailPageTemplate = `"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { FormHeader } from '@open-mercato/ui/backend/forms/FormHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { {{entityCamel}}UpdateSchema, type {{entityPascal}}UpdateInput } from '../../../data/validators'
{{statusImports}}import {
  {{entityUpperSnake}}_ENTITY_ID,
  create{{entityPascal}}FormFields,
  create{{entityPascal}}FormGroups,
} from '../../../components/formConfig'

type {{entityPascal}}Record = {
  id: string
  updatedAt?: string | null
{{rowTypeFields}}
}

type {{entityPascal}}ListResponse = {
  items: {{entityPascal}}Record[]
}

export default function {{entityPascal}}DetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : null
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation({ contextId: '{{moduleId}}.detail' })
  const [record, setRecord] = React.useState<{{entityPascal}}Record | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) {
        setLoadError(t('{{moduleId}}.detail.notFound', '{{entityTitle}} not found'))
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      setLoadError(null)
      try {
        const query = new URLSearchParams({ ids: id, pageSize: '1' })
        const call = await apiCall<{{entityPascal}}ListResponse>('/api/{{moduleId}}?' + query.toString())
        if (cancelled) return
        if (!call.ok) {
          setLoadError(t('{{moduleId}}.detail.loadError', 'Failed to load {{entityLower}}'))
          return
        }
        const item = call.result?.items?.[0] ?? null
        if (!item) {
          setLoadError(t('{{moduleId}}.detail.notFound', '{{entityTitle}} not found'))
          return
        }
        setRecord(item)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id, reloadToken, t])

  const fields = React.useMemo(() => create{{entityPascal}}FormFields(t), [t])
  const groups = React.useMemo(() => create{{entityPascal}}FormGroups(t), [t])

  // updatedAt MUST stay in initialValues: CrudForm auto-derives the
  // x-om-ext-optimistic-lock-expected-updated-at header from it on submit AND delete.
  const initialValues = React.useMemo<Partial<{{entityPascal}}UpdateInput> | undefined>(() => {
    if (!record) return undefined
    return {
      id: record.id,
      updatedAt: record.updatedAt ?? undefined,
{{initialValueLines}}
    }
  }, [record])

  const handleDelete = React.useCallback(async () => {
    if (!record) return
    const confirmed = await confirm({
      title: t('{{moduleId}}.delete.confirmTitle', 'Delete {{entityLower}}?'),
      description: t('{{moduleId}}.delete.confirmDescription', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(record.updatedAt ?? undefined),
            () => deleteCrud('{{moduleId}}', record.id),
          ),
        context: { resourceKind: '{{moduleId}}.{{entitySnake}}', resourceId: record.id },
        mutationPayload: { id: record.id },
      })
      flash(t('{{moduleId}}.delete.success', '{{entityTitle}} deleted'), 'success')
      router.push('/backend/{{moduleId}}')
    } catch {
      flash(t('{{moduleId}}.delete.error', 'Failed to delete {{entityLower}}'), 'error')
    }
  }, [confirm, record, router, runMutation, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('{{moduleId}}.detail.loading', 'Loading {{entityLower}}')} />
        </PageBody>
      </Page>
    )
  }

  if (loadError || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={loadError ?? t('{{moduleId}}.detail.notFound', '{{entityTitle}} not found')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <FormHeader
          mode="detail"
          backHref="/backend/{{moduleId}}"
          title={{{detailTitleExpr}}}
{{statusBadgeProp}}          onDelete={() => { void handleDelete() }}
          deleteLabel={t('{{moduleId}}.detail.actions.delete', 'Delete')}
        />
        <Tabs defaultValue="overview" variant="underline" className="mt-4">
          <TabsList aria-label={t('{{moduleId}}.detail.tabs.label', '{{entityTitle}} sections')}>
            <TabsTrigger value="overview">{t('{{moduleId}}.detail.tabs.overview', 'Overview')}</TabsTrigger>
            {/* Extension point: add related-entity tabs here (activity, attachments, ...). */}
          </TabsList>
          <TabsContent value="overview">
            <CrudForm<{{entityPascal}}UpdateInput>
              schema={{{entityCamel}}UpdateSchema}
              fields={fields}
              groups={groups}
              initialValues={initialValues}
              entityIds={[{{entityUpperSnake}}_ENTITY_ID]}
              submitLabel={t('{{moduleId}}.form.submit', 'Save')}
              onSubmit={async (values) => {
                await updateCrud('{{moduleId}}', values)
                flash(t('{{moduleId}}.detail.updateSuccess', '{{entityTitle}} updated'), 'success')
                setReloadToken((token) => token + 1)
              }}
            />
          </TabsContent>
        </Tabs>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
`
