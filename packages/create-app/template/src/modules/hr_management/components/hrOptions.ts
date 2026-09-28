"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * The two lookups every HR screen needs, in one place.
 *
 * The query engine cannot join across modules, so a list that projects `employee_id` or
 * `department_id` has to resolve the label from the sibling endpoint — and five screens now do
 * exactly that. Keeping the hooks here rather than in whichever screen first needed them also keeps
 * the dependency graph readable: a departments screen should not import from the attendance screen.
 */

export type EmployeeOption = {
  id: string
  first_name: string
  last_name: string
  employee_number?: string | null
}

export type DepartmentOption = {
  id: string
  name: string
}

export function employeeLabel(employee: Pick<EmployeeOption, 'first_name' | 'last_name'>): string {
  return `${employee.first_name} ${employee.last_name}`.trim()
}

export type WorkflowOption = {
  id: string
  name: string
  code?: string | null
  entity_type?: string | null
  is_active?: boolean | null
}

/**
 * Approval workflows once per scope, for the step screens: the label of a step's workflow, the
 * options of a filter, and the choice a new step is created under.
 */
export function useWorkflowOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['hr-workflow-options', scopeVersion],
    queryFn: () => fetchCrudList<WorkflowOption>('hr_management/approval-workflows', {
      pageSize: 100,
      sortField: 'name',
      sortDir: 'asc',
    }),
    staleTime: 5 * 60 * 1000,
  })
  const workflows = query.data?.items ?? []
  const labels = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const workflow of workflows) map.set(workflow.id, workflow.name)
    return map
  }, [workflows])
  return { workflows, labels }
}

/** Departments once per scope: the labels for a column and the options for a filter or picker. */
export function useDepartmentOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['hr-department-options', scopeVersion],
    queryFn: () => fetchCrudList<DepartmentOption>('hr_management/departments', {
      pageSize: 100,
      sortField: 'name',
      sortDir: 'asc',
    }),
    staleTime: 5 * 60 * 1000,
  })
  const departments = query.data?.items ?? []
  const labels = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const department of departments) map.set(department.id, department.name)
    return map
  }, [departments])
  return { departments, labels }
}

/** Employees once per scope, for the same two purposes. */
export function useEmployeeLabels() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['hr-employee-options', scopeVersion],
    queryFn: () => fetchCrudList<EmployeeOption>('hr_management/employees', {
      pageSize: 100,
      sortField: 'lastName',
      sortDir: 'asc',
    }),
    staleTime: 5 * 60 * 1000,
  })
  const employees = query.data?.items ?? []
  const labels = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const employee of employees) map.set(employee.id, employeeLabel(employee))
    return map
  }, [employees])
  return { employees, labels }
}
