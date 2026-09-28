"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'

import type { EmployeeDocumentType } from '../data/entities'
import {
  DOCUMENT_TYPE_FALLBACKS,
  DOCUMENT_TYPE_VALUES,
  type EmployeeDocumentRow,
} from './EmployeeDocumentsTable'
import { useEmployeeLabels } from './hrOptions'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'hr_management:hr_employee_document'
const LIST_HREF = '/backend/hr/documents'
const RESOURCE = 'hr_management/employee-documents'

export type EmployeeDocumentFormValues = {
  id: string
  employeeId: string
  documentType: EmployeeDocumentType
  documentNumber: string
  issueDate: string
  expiryDate: string
  notes: string
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

function toDateOnly(value: string | null | undefined): string {
  if (!value) return ''
  return value.length >= 10 ? value.slice(0, 10) : value
}

/** Maps a loaded row into form values (snake_case from the list, camelCase in the form). */
export function toEmployeeDocumentFormValues(row: EmployeeDocumentRow): EmployeeDocumentFormValues {
  return {
    id: row.id,
    employeeId: row.employee_id ?? '',
    documentType: row.document_type,
    documentNumber: row.document_number ?? '',
    issueDate: toDateOnly(row.issue_date),
    expiryDate: toDateOnly(row.expiry_date),
    notes: row.notes ?? '',
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildEmployeeDocumentFormDefaults(id = ''): EmployeeDocumentFormValues {
  return {
    id,
    employeeId: '',
    documentType: 'national_id',
    documentNumber: '',
    issueDate: '',
    expiryDate: '',
    notes: '',
    updatedAt: null,
  }
}

/**
 * Turns form values into the payload the schemas accept.
 *
 * Empty optional text becomes `null` so an update can clear it — a document with no expiry recorded
 * must be storable, and the list reports it as `unknown` rather than as valid.
 */
export function toEmployeeDocumentPayload(values: EmployeeDocumentFormValues): Record<string, unknown> {
  const optional = (value: string) => (value.trim().length > 0 ? value.trim() : null)
  return {
    employeeId: values.employeeId,
    documentType: values.documentType,
    documentNumber: optional(values.documentNumber),
    issueDate: optional(values.issueDate),
    expiryDate: optional(values.expiryDate),
    notes: optional(values.notes),
  }
}

type Translate = ReturnType<typeof useT>

function useDocumentFields(
  t: Translate,
  employeeOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'employeeId',
      label: t('hr_management.documents.form.fields.employee', 'Employee'),
      type: 'select',
      required: true,
      options: employeeOptions,
    },
    {
      id: 'documentType',
      label: t('hr_management.documents.form.fields.type', 'Document type'),
      type: 'select',
      required: true,
      options: DOCUMENT_TYPE_VALUES.map((value) => ({
        value,
        label: t(`hr_management.documents.types.${value}`, DOCUMENT_TYPE_FALLBACKS[value]),
      })),
    },
    { id: 'documentNumber', label: t('hr_management.documents.form.fields.number', 'Document number'), type: 'text' },
    { id: 'issueDate', label: t('hr_management.documents.form.fields.issued', 'Issue date'), type: 'date' },
    {
      id: 'expiryDate',
      label: t('hr_management.documents.form.fields.expires', 'Expiry date'),
      type: 'date',
      help: t('hr_management.documents.form.fields.expiresHint', 'Leave empty for a document that does not expire; the register then shows it as having no date.'),
    },
    { id: 'notes', label: t('hr_management.documents.form.fields.notes', 'Notes'), type: 'textarea', rows: 3 },
  ], [employeeOptions, t])
}

function useDocumentGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'document', title: t('hr_management.documents.form.groups.document'), column: 1, fields: ['employeeId', 'documentType', 'documentNumber'] },
    { id: 'validity', title: t('hr_management.documents.form.groups.validity'), column: 2, fields: ['issueDate', 'expiryDate', 'notes'] },
  ], [t])
}

/** Employee options with an explicit empty entry: a document always belongs to an employee. */
function useDocumentEmployeeOptions() {
  const t = useT()
  const { employees } = useEmployeeLabels()
  return React.useMemo(() => [
    { value: '', label: t('hr_management.documents.form.fields.employeeNone', 'Select an employee') },
    ...employees.map((employee) => ({
      value: employee.id,
      label: `${employee.first_name} ${employee.last_name}`.trim(),
    })),
  ], [employees, t])
}

export function EmployeeDocumentCreateForm() {
  const t = useT()
  const employeeOptions = useDocumentEmployeeOptions()
  const fields = useDocumentFields(t, employeeOptions)
  const groups = useDocumentGroups(t)
  const initialValues = React.useMemo(() => buildEmployeeDocumentFormDefaults(), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.documents.form.flash.saved', 'Document saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<EmployeeDocumentFormValues>
      title={t('hr_management.documents.form.create.title', 'New document')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('hr_management.documents.form.create.submit', 'Create document')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toEmployeeDocumentPayload(values))
      }}
    />
  )
}

export function EmployeeDocumentEditForm({ id }: { id: string }) {
  const t = useT()
  const employeeOptions = useDocumentEmployeeOptions()
  const fields = useDocumentFields(t, employeeOptions)
  const groups = useDocumentGroups(t)
  const [initial, setInitial] = React.useState<EmployeeDocumentFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<EmployeeDocumentRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toEmployeeDocumentFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message ? caught.message : t('hr_management.documents.form.error.load', 'Could not load the document.'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.documents.form.flash.saved', 'Document saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.documents.form.flash.deleted', 'Document deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('hr_management.documents.form.error.notFound', 'Document not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.documents.actions.backToList', 'Back to documents')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<EmployeeDocumentFormValues>
      title={t('hr_management.documents.form.edit.title', 'Edit document')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildEmployeeDocumentFormDefaults(id)}
      submitLabel={t('hr_management.documents.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('hr_management.documents.form.loading', 'Loading document…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toEmployeeDocumentPayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
