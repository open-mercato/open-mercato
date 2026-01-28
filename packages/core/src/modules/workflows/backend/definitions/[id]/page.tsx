"use client"

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  workflowDefinitionFormSchema,
  createFormGroups,
  createFieldDefinitions,
  parseWorkflowToFormValues,
  buildWorkflowPayload,
  type WorkflowDefinitionFormValues,
} from '../../../components/formConfig'
import { StepsEditor } from '../../../components/StepsEditor'
import { TransitionsEditor } from '../../../components/TransitionsEditor'
import { EventTriggersEditor } from '../../../components/EventTriggersEditor'

export default function EditWorkflowDefinitionPage() {
  const router = useRouter()
  const params = useParams()
  const t = useT()

  // Handle catch-all route: params.slug = ['definitions', 'uuid']
  let definitionId: string | undefined
  if (params?.slug && Array.isArray(params.slug)) {
    definitionId = params.slug[1] // Second element is the ID
  } else if (params?.id) {
    definitionId = Array.isArray(params.id) ? params.id[0] : params.id
  }

  const { data: definition, isLoading, error } = useQuery({
    queryKey: ['workflow-definition', definitionId],
    queryFn: async () => {
      const response = await apiFetch(`/api/workflows/definitions/${definitionId}`)
      if (!response.ok) {
        throw new Error(t('workflows.errors.fetchFailed'))
      }
      const result = await response.json()
      return result.data
    },
    enabled: !!definitionId,
  })

  const initialValues = React.useMemo(() => {
    if (definition) {
      return parseWorkflowToFormValues(definition)
    }
    return null
  }, [definition])

  const handleSubmit = async (values: WorkflowDefinitionFormValues) => {
    const payload = buildWorkflowPayload(values)

    const response = await apiFetch(`/api/workflows/definitions/${definitionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || t('workflows.errors.updateFailed'))
    }

    router.push('/backend/definitions')
    router.refresh()
  }

  const fields = React.useMemo(() => createFieldDefinitions(t), [t])

  const formGroups = React.useMemo(
    () => createFormGroups(t, StepsEditor, TransitionsEditor),
    [t]
  )

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="h-6 w-6" />
            <span>{t('workflows.edit.loading')}</span>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !definition) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-[50vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <p>{t('workflows.errors.loadFailed')}</p>
            <Button asChild variant="outline">
              <a href="/backend/definitions">{t('workflows.backToList')}</a>
            </Button>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (!initialValues) {
    return null
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                {t('workflows.edit.visualEditorAvailable')}
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                {t('workflows.edit.visualEditorDescription')}
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50">
            <a href={`/backend/definitions/visual-editor?id=${definitionId}`}>
              {t('workflows.actions.openVisualEditor')}
            </a>
          </Button>
        </div>
        <CrudForm
          key={definitionId}
          title={t('workflows.edit.title')}
          backHref="/backend/definitions"
          schema={workflowDefinitionFormSchema}
          fields={fields}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          cancelHref="/backend/definitions"
          groups={formGroups}
          submitLabel={t('workflows.form.update')}
        />

        {/* Event Triggers Section */}
        <div className="mt-8">
          <EventTriggersEditor
            workflowDefinitionId={definitionId!}
            workflowId={definition?.workflowId}
          />
        </div>
      </PageBody>
    </Page>
  )
}
