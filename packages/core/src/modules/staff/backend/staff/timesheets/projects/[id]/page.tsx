"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { LookupSelect } from '@open-mercato/ui/backend/inputs/LookupSelect'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud, deleteCrud, createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { ArrowLeft, Plus, Pencil, Save, X, ChevronDown, Trash2, User } from 'lucide-react'
import Link from 'next/link'

const BACK_HREF = '/backend/staff/timesheets/projects'

type ProjectRecord = {
  id: string
  name: string
  code: string
  description?: string | null
  projectType?: string | null
  project_type?: string | null
  startDate?: string | null
  start_date?: string | null
  costCenter?: string | null
  cost_center?: string | null
  status?: string | null
  customerId?: string | null
  customer_id?: string | null
} & Record<string, unknown>

type ProjectResponse = {
  items?: ProjectRecord[]
}

type EmployeeAssignment = {
  id: string
  staffMemberId: string
  role: string | null
  status: string | null
  assignedStartDate: string | null
  assignedEndDate: string | null
  displayName: string | null
  teamName: string | null
}

type EmployeesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
}

type StaffMemberRecord = {
  id: string
  display_name?: string
  displayName?: string
  team?: { id: string; name: string } | null
}

type StaffMembersResponse = {
  items?: StaffMemberRecord[]
}

export default function TimesheetProjectDetailPage({ params }: { params?: { id?: string } }) {
  const projectId = params?.id
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [project, setProject] = React.useState<ProjectRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [isEditing, setIsEditing] = React.useState(false)
  const [editName, setEditName] = React.useState('')
  const [editDescription, setEditDescription] = React.useState('')
  const [editStatus, setEditStatus] = React.useState('')
  const [isSaving, setIsSaving] = React.useState(false)

  const [employees, setEmployees] = React.useState<EmployeeAssignment[]>([])
  const [employeesLoading, setEmployeesLoading] = React.useState(false)
  const [expandedCards, setExpandedCards] = React.useState<Set<string>>(new Set())
  const [reloadToken, setReloadToken] = React.useState(0)

  const [canManageProjects, setCanManageProjects] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<{ ok: boolean; granted: string[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['staff.timesheets.projects.manage'] }),
        })
        if (!cancelled) {
          setCanManageProjects(new Set(res.result?.granted ?? []).has('staff.timesheets.projects.manage'))
        }
      } catch {
        // default: no manage access
      }
    })()
    return () => { cancelled = true }
  }, [])

  const [addDialogOpen, setAddDialogOpen] = React.useState(false)
  const [addStaffMemberId, setAddStaffMemberId] = React.useState<string | null>(null)
  const [addRole, setAddRole] = React.useState('')
  const [addStartDate, setAddStartDate] = React.useState('')
  const [addSaving, setAddSaving] = React.useState(false)

  const activeCount = employees.filter((emp) => emp.status === 'active').length
  const inactiveCount = employees.length - activeCount

  // --- Load project ---
  React.useEffect(() => {
    if (!projectId) return
    let cancelled = false
    async function loadProject() {
      setLoading(true)
      setError(null)
      try {
        const queryParams = new URLSearchParams({ page: '1', pageSize: '1', ids: projectId! })
        const payload = await readApiResultOrThrow<ProjectResponse>(
          `/api/staff/timesheets/time-projects?${queryParams.toString()}`,
          undefined,
          { errorMessage: t('staff.timesheets.projects.errors.load', 'Failed to load project.') },
        )
        const record = Array.isArray(payload.items) ? payload.items[0] : null
        if (!record) throw new Error(t('staff.timesheets.projects.errors.notFound', 'Project not found.'))
        if (!cancelled) setProject(record)
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t('staff.timesheets.projects.errors.load', 'Failed to load project.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadProject()
    return () => { cancelled = true }
  }, [projectId, t, scopeVersion])

  // --- Load employees with name resolution ---
  const loadEmployees = React.useCallback(async () => {
    if (!projectId) return
    setEmployeesLoading(true)
    try {
      const payload = await readApiResultOrThrow<EmployeesResponse>(
        `/api/staff/timesheets/time-projects/${projectId}/employees?page=1&pageSize=100`,
        undefined,
        { errorMessage: t('staff.timesheets.projects.employees.empty', 'No employees assigned yet.'), fallback: { items: [], total: 0 } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []

      const staffMemberIds = items
        .map((item) => String(item.staff_member_id ?? item.staffMemberId ?? ''))
        .filter((id) => id.length > 0)

      let staffMap = new Map<string, StaffMemberRecord>()
      if (staffMemberIds.length > 0) {
        try {
          const staffPayload = await readApiResultOrThrow<StaffMembersResponse>(
            `/api/staff/team-members?ids=${staffMemberIds.join(',')}&pageSize=100`,
            undefined,
            { errorMessage: '', fallback: { items: [] } },
          )
          const staffItems = Array.isArray(staffPayload.items) ? staffPayload.items : []
          staffMap = new Map(staffItems.map((member) => [member.id, member]))
        } catch {
          // name resolution failed — show IDs as fallback
        }
      }

      const mapped: EmployeeAssignment[] = items.map((item) => {
        const staffMemberId = String(item.staff_member_id ?? item.staffMemberId ?? '')
        const staff = staffMap.get(staffMemberId)
        return {
          id: String(item.id ?? ''),
          staffMemberId,
          role: typeof item.role === 'string' ? item.role : null,
          status: typeof item.status === 'string' ? item.status : null,
          assignedStartDate: String(item.assigned_start_date ?? item.assignedStartDate ?? ''),
          assignedEndDate: typeof (item.assigned_end_date ?? item.assignedEndDate) === 'string'
            ? String(item.assigned_end_date ?? item.assignedEndDate)
            : null,
          displayName: staff?.display_name ?? staff?.displayName ?? null,
          teamName: staff?.team?.name ?? null,
        }
      })

      setEmployees(mapped)
    } catch (loadError) {
      console.error('staff.timesheets.projects.employees.list', loadError)
    } finally {
      setEmployeesLoading(false)
    }
  }, [projectId, t])

  React.useEffect(() => {
    void loadEmployees()
  }, [loadEmployees, reloadToken, scopeVersion])

  // --- Toggle card expand/collapse ---
  const toggleCard = React.useCallback((employeeId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(employeeId)) next.delete(employeeId)
      else next.add(employeeId)
      return next
    })
  }, [])

  // --- Remove employee ---
  const handleRemoveEmployee = React.useCallback(async (emp: EmployeeAssignment) => {
    const confirmed = await confirm({
      title: t('staff.timesheets.projects.employees.remove', 'Remove'),
      text: t('staff.timesheets.projects.employees.removeConfirm', 'Remove this employee from the project?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await deleteCrud(
        `staff/timesheets/time-projects/${projectId}/employees`,
        emp.id,
        { errorMessage: t('staff.timesheets.projects.employees.removeError', 'Failed to remove employee.') },
      )
      flash(t('staff.timesheets.projects.employees.removed', 'Employee removed.'), 'success')
      setReloadToken((token) => token + 1)
    } catch {
      flash(t('staff.timesheets.projects.employees.removeError', 'Failed to remove employee.'), 'error')
    }
  }, [projectId, confirm, t])

  // --- Edit project ---
  const startEditing = React.useCallback(() => {
    if (!project) return
    setEditName(project.name)
    setEditDescription(project.description ?? '')
    setEditStatus(project.status ?? '')
    setIsEditing(true)
  }, [project])

  const cancelEditing = React.useCallback(() => {
    setIsEditing(false)
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!projectId || !editName.trim()) return
    setIsSaving(true)
    try {
      const payload: Record<string, unknown> = {
        id: projectId,
        name: editName.trim(),
      }
      if (editDescription.trim()) payload.description = editDescription.trim()
      else payload.description = null
      if (editStatus.trim()) payload.status = editStatus.trim()

      await updateCrud('staff/timesheets/time-projects', payload, {
        errorMessage: t('staff.timesheets.projects.errors.save', 'Failed to save project.'),
      })
      flash(t('staff.timesheets.projects.messages.saved', 'Project saved.'), 'success')
      setProject((prev) => prev ? { ...prev, name: editName.trim(), description: editDescription.trim() || null, status: editStatus.trim() || null } : prev)
      setIsEditing(false)
    } catch (saveError) {
      flash(saveError instanceof Error ? saveError.message : t('staff.timesheets.projects.errors.save', 'Failed to save project.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [projectId, editName, editDescription, editStatus, t])

  const handleEditKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSave()
    }
    if (event.key === 'Escape') cancelEditing()
  }, [handleSave, cancelEditing])

  // --- Add employee dialog ---
  const openAddDialog = React.useCallback(() => {
    setAddStaffMemberId(null)
    setAddRole('')
    setAddStartDate(new Date().toISOString().slice(0, 10))
    setAddDialogOpen(true)
  }, [])

  const fetchStaffMembers = React.useCallback(async (query: string) => {
    try {
      const params = new URLSearchParams({ search: query, pageSize: '20', isActive: 'true' })
      const payload = await readApiResultOrThrow<StaffMembersResponse>(
        `/api/staff/team-members?${params.toString()}`,
        undefined,
        { errorMessage: '', fallback: { items: [] } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      return items.map((member) => ({
        id: member.id,
        title: member.display_name ?? member.displayName ?? member.id,
        subtitle: member.team?.name ?? null,
      }))
    } catch {
      return []
    }
  }, [])

  const handleAddEmployee = React.useCallback(async () => {
    if (!projectId || !addStaffMemberId || !addStartDate) return
    setAddSaving(true)
    try {
      await createCrud(`staff/timesheets/time-projects/${projectId}/employees`, {
        staffMemberId: addStaffMemberId,
        timeProjectId: projectId,
        role: addRole.trim() || null,
        assignedStartDate: addStartDate,
      }, {
        errorMessage: t('staff.timesheets.projects.employees.addError', 'Failed to add employee.'),
      })
      flash(t('staff.timesheets.projects.employees.added', 'Employee added.'), 'success')
      setAddDialogOpen(false)
      setReloadToken((token) => token + 1)
    } catch (addError) {
      flash(addError instanceof Error ? addError.message : t('staff.timesheets.projects.employees.addError', 'Failed to add employee.'), 'error')
    } finally {
      setAddSaving(false)
    }
  }, [projectId, addStaffMemberId, addRole, addStartDate, t])

  const handleAddDialogKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleAddEmployee()
    }
  }, [handleAddEmployee])

  // --- Render ---
  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('staff.timesheets.projects.loading', 'Loading project...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !project) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('staff.timesheets.projects.errors.notFound', 'Project not found.')} />
        </PageBody>
      </Page>
    )
  }

  const projectStatus = project.status ?? 'active'
  const projectType = project.projectType ?? project.project_type ?? null
  const projectStartDate = project.startDate ?? project.start_date ?? null
  const projectCode = project.code

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          {/* Header: Back arrow, title, subtitle, Edit button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" asChild>
                <Link href={BACK_HREF}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <div>
                <h1 className="text-xl font-semibold">{project.name}</h1>
                <p className="text-sm text-muted-foreground">{t('staff.timesheets.projects.detail.subtitle', 'Project Settings')}</p>
              </div>
            </div>
            {!isEditing && canManageProjects && (
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Pencil className="mr-2 h-4 w-4" aria-hidden />
                {t('staff.timesheets.projects.form.actions.edit', 'Edit Project')}
              </Button>
            )}
          </div>

          {/* Project Information (edit mode or read-only) */}
          {isEditing && canManageProjects ? (
            <div className="max-w-2xl space-y-4 rounded-lg border p-4" onKeyDown={handleEditKeyDown}>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="edit-name">
                  {t('staff.timesheets.projects.form.name', 'Name')}
                </label>
                <Input id="edit-name" value={editName} onChange={(event) => setEditName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="edit-status">
                  {t('staff.timesheets.projects.form.status', 'Status')}
                </label>
                <Input id="edit-status" value={editStatus} onChange={(event) => setEditStatus(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="edit-description">
                  {t('staff.timesheets.projects.form.description', 'Description')}
                </label>
                <Textarea id="edit-description" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={3} />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleSave} disabled={isSaving || !editName.trim()} size="sm">
                  <Save className="mr-2 h-4 w-4" aria-hidden />
                  {t('staff.timesheets.projects.form.actions.save', 'Save')}
                </Button>
                <Button variant="outline" size="sm" onClick={cancelEditing}>
                  <X className="mr-2 h-4 w-4" aria-hidden />
                  {t('staff.timesheets.projects.form.actions.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl rounded-lg border p-4">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="font-medium text-muted-foreground">{t('staff.timesheets.projects.form.code', 'Code')}</dt>
                  <dd className="font-mono">{projectCode}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">{t('staff.timesheets.projects.form.status', 'Status')}</dt>
                  <dd>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${projectStatus === 'active' ? 'bg-green-100 text-green-800' : projectStatus === 'on_hold' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
                      {projectStatus}
                    </span>
                  </dd>
                </div>
                {projectType ? (
                  <div>
                    <dt className="font-medium text-muted-foreground">{t('staff.timesheets.projects.form.projectType', 'Project type')}</dt>
                    <dd>{projectType}</dd>
                  </div>
                ) : null}
                {projectStartDate ? (
                  <div>
                    <dt className="font-medium text-muted-foreground">{t('staff.timesheets.projects.form.startDate', 'Start date')}</dt>
                    <dd>{projectStartDate}</dd>
                  </div>
                ) : null}
                {project.description ? (
                  <div className="col-span-2">
                    <dt className="font-medium text-muted-foreground">{t('staff.timesheets.projects.form.description', 'Description')}</dt>
                    <dd className="whitespace-pre-wrap">{project.description}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          )}

          {/* Summary Cards: Active / Inactive employees */}
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-bold">{activeCount}</p>
              <p className="text-xs text-muted-foreground">{t('staff.timesheets.projects.active_employees', 'Active Employees')}</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-bold">{inactiveCount}</p>
              <p className="text-xs text-muted-foreground">{t('staff.timesheets.projects.inactive_employees', 'Inactive Employees')}</p>
            </div>
          </div>

          {/* Assigned Employees — collapsible cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {t('staff.timesheets.projects.employees.title', 'Assigned Employees')}
              </h2>
              {canManageProjects && (
                <Button size="sm" onClick={openAddDialog}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden />
                  {t('staff.timesheets.projects.add_employee', 'Add Employee')}
                </Button>
              )}
            </div>

            {employeesLoading ? (
              <LoadingMessage label={t('staff.timesheets.projects.employees.loading', 'Loading employees...')} />
            ) : employees.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <User className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('staff.timesheets.projects.employees.empty', 'No employees assigned yet.')}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {employees.map((emp) => {
                  const isExpanded = expandedCards.has(emp.id)
                  const isInactive = emp.status !== 'active'
                  return (
                    <div
                      key={emp.id}
                      className={`rounded-lg border ${isInactive ? 'opacity-60' : ''}`}
                    >
                      {/* Collapsed view: name, role, status badge, start date, expand toggle */}
                      <button
                        type="button"
                        className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
                        onClick={() => toggleCard(emp.id)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                            <User className="h-4 w-4 text-muted-foreground" aria-hidden />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {emp.displayName ?? emp.staffMemberId}
                            </p>
                            {emp.role ? (
                              <p className="text-xs text-muted-foreground truncate">{emp.role}</p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${emp.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {emp.status ?? 'active'}
                          </span>
                          {emp.assignedStartDate ? (
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                              {emp.assignedStartDate}
                            </span>
                          ) : null}
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden />
                        </div>
                      </button>

                      {/* Expanded view: assignment details */}
                      {isExpanded ? (
                        <div className="border-t px-4 pb-4 pt-3 space-y-3">
                          <dl className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <dt className="font-medium text-muted-foreground">
                                {t('staff.timesheets.projects.employees.role', 'Role')}
                              </dt>
                              <dd>{emp.role || '-'}</dd>
                            </div>
                            <div>
                              <dt className="font-medium text-muted-foreground">
                                {t('staff.timesheets.projects.employees.status', 'Status')}
                              </dt>
                              <dd className="capitalize">{emp.status ?? 'active'}</dd>
                            </div>
                            <div>
                              <dt className="font-medium text-muted-foreground">
                                {t('staff.timesheets.projects.employees.startDate', 'Assignment start')}
                              </dt>
                              <dd>{emp.assignedStartDate || '-'}</dd>
                            </div>
                            <div>
                              <dt className="font-medium text-muted-foreground">
                                {t('staff.timesheets.projects.employees.endDate', 'Assignment end')}
                              </dt>
                              <dd>{emp.assignedEndDate || '-'}</dd>
                            </div>
                            {emp.teamName ? (
                              <div>
                                <dt className="font-medium text-muted-foreground">
                                  {t('staff.timesheets.projects.employees.department', 'Department')}
                                </dt>
                                <dd>{emp.teamName}</dd>
                              </div>
                            ) : null}
                          </dl>
                          {canManageProjects && (
                            <div className="flex justify-end">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => { void handleRemoveEmployee(emp) }}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden />
                                {t('staff.timesheets.projects.employees.remove', 'Remove')}
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {ConfirmDialogElement}

        {/* Add Employee Dialog */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent className="sm:max-w-md" onKeyDown={handleAddDialogKeyDown}>
            <DialogHeader>
              <DialogTitle>{t('staff.timesheets.projects.add_employee', 'Add Employee')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t('staff.timesheets.projects.employees.selectEmployee', 'Select Employee')}
                </label>
                <LookupSelect
                  value={addStaffMemberId}
                  onChange={setAddStaffMemberId}
                  fetchItems={fetchStaffMembers}
                  searchPlaceholder={t('staff.timesheets.projects.employees.searchEmployee', 'Search team members...')}
                  emptyLabel={t('staff.timesheets.projects.employees.noResults', 'No team members found')}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="add-role">
                  {t('staff.timesheets.projects.employees.roleOnProject', 'Role on Project')}
                </label>
                <Input
                  id="add-role"
                  value={addRole}
                  onChange={(event) => setAddRole(event.target.value)}
                  placeholder={t('staff.timesheets.projects.employees.rolePlaceholder', 'e.g. Developer, Designer...')}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="add-start-date">
                  {t('staff.timesheets.projects.employees.assignmentStartDate', 'Assignment Start Date')}
                </label>
                <Input
                  id="add-start-date"
                  type="date"
                  value={addStartDate}
                  onChange={(event) => setAddStartDate(event.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>
                  {t('staff.timesheets.projects.form.actions.cancel', 'Cancel')}
                </Button>
                <Button
                  size="sm"
                  disabled={addSaving || !addStaffMemberId || !addStartDate}
                  onClick={handleAddEmployee}
                >
                  {t('staff.timesheets.projects.add_employee', 'Add Employee')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}
