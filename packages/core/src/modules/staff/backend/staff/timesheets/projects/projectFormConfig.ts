import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type ProjectFormValues = {
  id?: string
  name: string
  code: string
  description?: string | null
  projectType?: string | null
  startDate?: string | null
  costCenter?: string | null
  status?: string
}

export function createProjectFormSchema() {
  return z.object({
    name: z.string().min(1),
    code: z.string().min(1).max(50).regex(/^[a-zA-Z0-9-]+$/),
    description: z.string().max(2000).optional().nullable(),
    projectType: z.string().max(100).optional().nullable(),
    startDate: z.string().optional().nullable(),
    costCenter: z.string().max(100).optional().nullable(),
    status: z.enum(['active', 'on_hold', 'completed']).optional(),
  })
}

export function createProjectFormFields(t: TranslateFn): CrudField[] {
  return [
    {
      id: 'name',
      type: 'text',
      label: t('staff.timesheets.projects.form.name', 'Name'),
      placeholder: t('staff.timesheets.projects.form.namePlaceholder', 'Project name'),
      required: true,
    },
    {
      id: 'code',
      type: 'text',
      label: t('staff.timesheets.projects.form.code', 'Code'),
      placeholder: t('staff.timesheets.projects.form.codePlaceholder', 'PROJECT-001'),
      required: true,
    },
    {
      id: 'status',
      type: 'select',
      label: t('staff.timesheets.projects.form.status', 'Status'),
      options: [
        { value: 'active', label: t('staff.timesheets.projects.statuses.active', 'Active') },
        { value: 'on_hold', label: t('staff.timesheets.projects.statuses.onHold', 'On Hold') },
        { value: 'completed', label: t('staff.timesheets.projects.statuses.completed', 'Completed') },
      ],
    },
    {
      id: 'description',
      type: 'textarea',
      label: t('staff.timesheets.projects.form.description', 'Description'),
      placeholder: t('staff.timesheets.projects.form.descriptionPlaceholder', 'Project description'),
    },
    {
      id: 'projectType',
      type: 'text',
      label: t('staff.timesheets.projects.form.projectType', 'Project type'),
      placeholder: t('staff.timesheets.projects.form.projectTypePlaceholder', 'e.g. Internal, Client, R&D'),
    },
    {
      id: 'startDate',
      type: 'date',
      label: t('staff.timesheets.projects.form.startDate', 'Start date'),
    },
    {
      id: 'costCenter',
      type: 'text',
      label: t('staff.timesheets.projects.form.costCenter', 'Cost center'),
      placeholder: t('staff.timesheets.projects.form.costCenterPlaceholder', 'Cost center code'),
    },
  ]
}

export function createProjectFormGroups(t: TranslateFn): CrudFormGroup[] {
  return [
    {
      id: 'main',
      title: t('staff.timesheets.projects.form.groupMain', 'Project Details'),
      fields: ['name', 'code', 'status', 'projectType', 'startDate'],
    },
    {
      id: 'details',
      title: t('staff.timesheets.projects.form.groupDetails', 'Additional Information'),
      fields: ['description', 'costCenter'],
    },
  ]
}

export function buildProjectPayload(values: ProjectFormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    code: values.code.trim(),
  }
  if (values.id) payload.id = values.id
  if (values.description?.trim()) payload.description = values.description.trim()
  else payload.description = null
  if (values.projectType?.trim()) payload.projectType = values.projectType.trim()
  else payload.projectType = null
  if (values.startDate) payload.startDate = values.startDate
  else payload.startDate = null
  if (values.costCenter?.trim()) payload.costCenter = values.costCenter.trim()
  else payload.costCenter = null
  if (values.status) payload.status = values.status
  return payload
}
