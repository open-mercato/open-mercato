"use client"

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
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
import { DefinitionTriggersEditor } from '../../../components/DefinitionTriggersEditor'
import { MobileDefinitionDetail } from '../../../components/mobile/MobileDefinitionDetail'
import { useIsMobile } from '@open-mercato/ui/hooks/useIsMobile'
import type { WorkflowDefinitionTrigger } from '../../../data/entities'

export default function EditWorkflowDefinitionPage() {
  const router = useRouter()
  const params = useParams()
  const t = useT()
  const isMobile = useIsMobile()

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

  const [triggers, setTriggers] = React.useState<WorkflowDefinitionTrigger[]>([])

  React.useEffect(() => {
    setTriggers(initialValues?.triggers ?? [])
  }, [initialValues])

  const source = definition?.source as 'code' | 'code_override' | 'user' | undefined
  const isCodeOnly = source === 'code'
  const isCodeOverride = source === 'code_override'

  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const handleSubmit = async (values: WorkflowDefinitionFormValues) => {
    const payload = buildWorkflowPayload({ ...values, triggers })

    const response = await apiFetch(`/api/workflows/definitions/${definitionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || t('workflows.errors.updateFailed'))
    }

    const result = await response.json()
    // If we just customized a code def, redirect to the new DB row
    if (isCodeOnly && result.data?.id) {
      router.push(`/backend/definitions/${result.data.id}`)
      router.refresh()
      return
    }

    router.push('/backend/definitions')
    router.refresh()
  }

  const handleResetToCode = async () => {
    const confirmed = await confirm({
      title: t('workflows.actions.resetToCode'),
      description: t('workflows.actions.resetConfirm'),
      confirmText: t('workflows.actions.resetToCode'),
      variant: 'destructive',
    })
    if (!confirmed) return

    const response = await apiFetch(`/api/workflows/definitions/${definitionId}/reset-to-code`, {
      method: 'POST',
    })

    if (response.ok) {
      const result = await response.json()
      flash(t('workflows.messages.updated'), 'success')
      const codeId = result.data?.id || `code:${definition?.workflowId}`
      router.push(`/backend/definitions/${codeId}`)
      router.refresh()
    } else {
      flash(t('workflows.messages.updateFailed'), 'error')
    }
  }

  const fields = React.useMemo(() => createFieldDefinitions(t), [t])

  const formGroups = React.useMemo(
    () => isMobile ? [] : createFormGroups(t, StepsEditor, TransitionsEditor),
    [t, isMobile]
  )

  const navigateToVisualEditor = React.useCallback(() => {
    router.push(`/backend/definitions/visual-editor?id=${definitionId}`)
  }, [router, definitionId])

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
        {isCodeOnly && (
          <Alert variant="info" className="mb-4">
            <AlertDescription className="flex items-center justify-between">
              <span>{t('workflows.source.code.readonlyBanner')}</span>
              <Button variant="outline" size="sm" onClick={() => handleSubmit(initialValues!)}>
                {t('workflows.actions.customize')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {isCodeOverride && (
          <Alert variant="warning" className="mb-4">
            <AlertDescription className="flex items-center justify-between">
              <span>{t('workflows.source.code_override.banner')}</span>
              <Button variant="outline" size="sm" onClick={handleResetToCode}>
                {t('workflows.actions.resetToCode')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
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
          <Button asChild variant="outline" size="sm" className="w-full sm:w-auto border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50">
            <a href={`/backend/definitions/visual-editor?id=${definitionId}`}>
              {t('workflows.actions.openVisualEditor')}
            </a>
          </Button>
        </div>
        <CrudForm
          key={definitionId}
          title={isCodeOnly ? definition?.workflowName || t('workflows.edit.title') : t('workflows.edit.title')}
          backHref="/backend/definitions"
          schema={workflowDefinitionFormSchema}
          fields={fields}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          cancelHref="/backend/definitions"
          groups={formGroups}
          submitLabel={isCodeOnly ? t('workflows.actions.customize') : t('workflows.form.update')}
          {...(isCodeOnly ? { readOnly: true } : {})}
        />

        {/* Mobile Steps & Transitions View */}
        {isMobile && initialValues && (
          <div className="mt-4">
            <MobileDefinitionDetail
              values={initialValues}
              onEditStep={navigateToVisualEditor}
              onDeleteStep={navigateToVisualEditor}
              onAddStep={navigateToVisualEditor}
              onEditTransition={navigateToVisualEditor}
              onDeleteTransition={navigateToVisualEditor}
              onAddTransition={navigateToVisualEditor}
            />
          </div>
        )}

        {/* Event Triggers Section */}
        <div className="mt-8">
          <DefinitionTriggersEditor
            value={triggers}
            onChange={setTriggers}
          />
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
