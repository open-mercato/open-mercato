"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  workflowDefinitionFormSchema,
  createFormGroups,
  createFieldDefinitions,
  defaultFormValues,
  buildWorkflowPayload,
  type WorkflowDefinitionFormValues,
} from '../../../components/formConfig'
import { StepsEditor } from '../../../components/StepsEditor'
import { TransitionsEditor } from '../../../components/TransitionsEditor'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Zap } from 'lucide-react'

export default function CreateWorkflowDefinitionPage() {
  const router = useRouter()
  const t = useT()

  const handleSubmit = async (values: WorkflowDefinitionFormValues) => {
    const payload = buildWorkflowPayload(values)

    const response = await apiFetch('/api/workflows/definitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || t('workflows.errors.createFailed'))
    }

    const result = await response.json()
    router.push(`/backend/definitions/${result.id}`)
    router.refresh()
  }

  const fields = React.useMemo(() => createFieldDefinitions(t), [t])

  const formGroups = React.useMemo(
    () => createFormGroups(t, StepsEditor, TransitionsEditor),
    [t]
  )

  return (
    <Page>
      <PageBody>
        <Alert variant="info" className="mb-6">
          <Zap className="w-4 h-4" />
          <AlertTitle>Event Triggers</AlertTitle>
          <AlertDescription>
            After creating this workflow definition, you can configure event triggers to automatically start the workflow when specific events occur in the system.
          </AlertDescription>
        </Alert>
        <CrudForm
          title={t('workflows.create.title')}
          backHref="/backend/definitions"
          schema={workflowDefinitionFormSchema}
          fields={fields}
          initialValues={defaultFormValues}
          onSubmit={handleSubmit}
          cancelHref="/backend/definitions"
          groups={formGroups}
          submitLabel={t('workflows.form.create')}
        />
      </PageBody>
    </Page>
  )
}
