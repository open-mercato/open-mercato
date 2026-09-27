"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useDepartmentOptions, useEmployeeLabels, employeeLabel } from './hrOptions'
import type { DepartmentRow } from './DepartmentsTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'hr_management:hr_department'
const LIST_HREF = '/backend/hr/departments'
const RESOURCE = 'hr_management/departments'

export type DepartmentFormValues = {
  id: string
  name: string
  code: string
  description: string
  parentDepartmentId: string
  managerEmployeeId: string
  isActive: boolean
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

/** Maps a loaded row (snake_case, as the query engine projects it) into form values (camelCase). */
export function toDepartmentFormValues(row: DepartmentRow): DepartmentFormValues {
  return {
    id: row.id,
    name: row.name ?? '',
    code: row.code ?? '',
    description: row.description ?? '',
    parentDepartmentId: row.parent_department_id ?? '',
    managerEmployeeId: row.manager_employee_id ?? '',
    isActive: row.is_active !== false,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildDepartmentFormDefaults(id = ''): DepartmentFormValues {
  return {
    id,
    name: '',
    code: '',
    description: '',
    parentDepartmentId: '',
    managerEmployeeId: '',
    isActive: true,
    updatedAt: null,
  }
}

/**
 * Turns form values into the payload the schemas accept.
 *
 * Empty optional text becomes `null` rather than `''` so a value can be cleared on update
 * (`updateDepartmentSchema` is `partial().nullable()` for those fields). `isActive` is always sent
 * because the form always shows a value for it.
 */
export function toDepartmentPayload(values: DepartmentFormValues): Record<string, unknown> {
  const optional = (value: string) => (value.trim().length > 0 ? value.trim() : null)
  return {
    name: values.name.trim(),
    code: optional(values.code),
    description: optional(values.description),
    parentDepartmentId: values.parentDepartmentId.length > 0 ? values.parentDepartmentId : null,
    managerEmployeeId: values.managerEmployeeId.length > 0 ? values.managerEmployeeId : null,
    isActive: values.isActive,
  }
}

/**
 * Ids that cannot be chosen as the parent of `departmentId`: the department itself and everything
 * below it.
 *
 * Following a cycle would make the tree unrenderable and every ancestor walk non-terminating, and
 * nothing in the database stops it — `parent_department_id` is a plain FK. The list endpoint returns
 * the whole tree in one page for exactly this reason, so the check is a pure lookup here.
 */
export function excludedParentIds(
  departments: Array<Pick<DepartmentRow, 'id' | 'parent_department_id'>>,
  departmentId: string,
): Set<string> {
  const excluded = new Set<string>()
  if (!departmentId) return excluded
  excluded.add(departmentId)
  let grew = true
  while (grew) {
    grew = false
    for (const department of departments) {
      if (excluded.has(department.id)) continue
      const parentId = department.parent_department_id ?? null
      if (parentId && excluded.has(parentId)) {
        excluded.add(department.id)
        grew = true
      }
    }
  }
  return excluded
}

type Translate = ReturnType<typeof useT>

function useDepartmentFields(
  t: Translate,
  parentOptions: Array<{ value: string; label: string }>,
  managerOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('hr_management.departments.form.fields.name', 'Name'), type: 'text', required: true },
    { id: 'code', label: t('hr_management.departments.form.fields.code', 'Code'), type: 'text' },
    {
      id: 'parentDepartmentId',
      label: t('hr_management.departments.form.fields.parent', 'Parent department'),
      type: 'select',
      options: parentOptions,
    },
    {
      id: 'managerEmployeeId',
      label: t('hr_management.departments.form.fields.manager', 'Manager'),
      type: 'select',
      options: managerOptions,
    },
    {
      id: 'isActive',
      label: t('hr_management.departments.form.fields.isActive', 'Active'),
      type: 'checkbox',
      help: t('hr_management.departments.form.fields.isActiveHint', 'Inactive departments stay in the tree but cannot be assigned to new employees.'),
    },
    {
      id: 'description',
      label: t('hr_management.departments.form.fields.description', 'Description'),
      type: 'textarea',
      rows: 3,
    },
  ], [t, managerOptions, parentOptions])
}

function useDepartmentGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'identity', title: t('hr_management.departments.form.groups.identity'), column: 1, fields: ['name', 'code', 'description'] },
    { id: 'structure', title: t('hr_management.departments.form.groups.structure'), column: 2, fields: ['parentDepartmentId', 'managerEmployeeId', 'isActive'] },
  ], [t])
}

/** Parent and manager options, each with an explicit empty entry so both are clearable. */
function useDepartmentSelectOptions(departmentId = '') {
  const t = useT()
  const { departments } = useDepartmentOptions()
  const { employees } = useEmployeeLabels()

  const parentOptions = React.useMemo(() => {
    const excluded = excludedParentIds(departments, departmentId)
    return [
      { value: '', label: t('hr_management.departments.form.fields.parentNone', 'Top level') },
      ...departments
        .filter((department) => !excluded.has(department.id))
        .map((department) => ({ value: department.id, label: department.name })),
    ]
  }, [departments, departmentId, t])

  const managerOptions = React.useMemo(() => [
    { value: '', label: t('hr_management.departments.form.fields.managerNone', 'No manager assigned') },
    ...employees.map((employee) => ({ value: employee.id, label: employeeLabel(employee) })),
  ], [employees, t])

  return { parentOptions, managerOptions }
}

export function DepartmentCreateForm() {
  const t = useT()
  const { parentOptions, managerOptions } = useDepartmentSelectOptions()
  const fields = useDepartmentFields(t, parentOptions, managerOptions)
  const groups = useDepartmentGroups(t)
  const initialValues = React.useMemo(() => buildDepartmentFormDefaults(), [])
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.departments.form.flash.saved', 'Department saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<DepartmentFormValues>
      title={t('hr_management.departments.form.create.title', 'New department')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      submitLabel={t('hr_management.departments.form.create.submit', 'Create department')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toDepartmentPayload(values))
      }}
    />
  )
}

export function DepartmentEditForm({ id }: { id: string }) {
  const t = useT()
  const { parentOptions, managerOptions } = useDepartmentSelectOptions(id)
  const fields = useDepartmentFields(t, parentOptions, managerOptions)
  const groups = useDepartmentGroups(t)
  const [initial, setInitial] = React.useState<DepartmentFormValues | null>(null)
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
        const data = await fetchCrudList<DepartmentRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toDepartmentFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message ? caught.message : t('hr_management.departments.form.error.load', 'Could not load the department.'))
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
    () => withFlash(LIST_HREF, t('hr_management.departments.form.flash.saved', 'Department saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('hr_management.departments.form.flash.deleted', 'Department deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('hr_management.departments.form.error.notFound', 'Department not found.')}
        backHref={LIST_HREF}
        backLabel={t('hr_management.departments.actions.backToList', 'Back to departments')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<DepartmentFormValues>
      title={t('hr_management.departments.form.edit.title', 'Edit department')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildDepartmentFormDefaults(id)}
      submitLabel={t('hr_management.departments.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('hr_management.departments.form.loading', 'Loading department…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toDepartmentPayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}
