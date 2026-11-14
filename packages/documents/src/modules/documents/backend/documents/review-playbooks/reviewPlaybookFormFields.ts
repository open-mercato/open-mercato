import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import type { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ReviewPlaybookFormValues } from './reviewPlaybookModel'

type Translate = ReturnType<typeof useT>

export function buildReviewPlaybookFields(t: Translate): CrudField[] {
  return [
    { id: 'name', label: t('documents.reviewPlaybooks.fields.name'), type: 'text', required: true, layout: 'half', maxLength: 200 },
    {
      id: 'code',
      label: t('documents.reviewPlaybooks.fields.code'),
      type: 'text',
      required: true,
      layout: 'half',
      maxLength: 64,
      description: t('documents.reviewPlaybooks.fields.codeHelp'),
    },
    { id: 'description', label: t('documents.reviewPlaybooks.fields.description'), type: 'textarea', rows: 2, maxLength: 4000 },
    {
      id: 'instructions',
      label: t('documents.reviewPlaybooks.fields.instructions'),
      type: 'textarea',
      rows: 6,
      maxLength: 8000,
      showCount: true,
      description: t('documents.reviewPlaybooks.fields.instructionsHelp'),
    },
    { id: 'isActive', label: t('documents.reviewPlaybooks.fields.isActive'), type: 'checkbox' },
  ]
}

export function reviewPlaybookPayload(values: ReviewPlaybookFormValues): Record<string, unknown> {
  const description = typeof values.description === 'string' ? values.description.trim() : ''
  const instructions = typeof values.instructions === 'string' ? values.instructions.trim() : ''
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    description: description.length > 0 ? description : null,
    instructions: instructions.length > 0 ? instructions : null,
    isActive: values.isActive === true,
  }
}
