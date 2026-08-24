"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Input } from '@open-mercato/ui/primitives/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { LookupSelect } from '@open-mercato/ui/backend/inputs/LookupSelect'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud, createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { ArrowLeft, Plus, Pencil, ChevronDown, Trash2, User, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { KpiCard, Sparkline } from '@open-mercato/ui/backend/charts'
import { ProjectTeamDrawer } from '../../../../../lib/time-tracking-ui/ProjectTeamDrawer'
import { NoProjectAccess } from '../../../../../lib/time-tracking-ui/NoProjectAccess'
import { ProjectBudgetCell } from '../../../../../lib/timesheets-projects-ui/ProjectBudgetCell'
import { computeBudgetBurn } from '../../../../../lib/timesheets-projects/budgetBurn'
import { resolveProjectColorHex } from '../../../../../lib/timesheets-ui/colors'

const logger = createLogger('staff')

const BACK_HREF = '/backend/staff/time-tracking/projects'

const EMPLOYEE_MUTATION_CONTEXT_ID = 'staff-time-project-detail:employees'
const EMPLOYEE_RESOURCE_KIND = 'staff.time_project_member'

type EmployeeMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

/**
 * Mirrors `NO_PROJECT_ACCESS_REASON` from
 * `api/timesheets/time-projects/route.ts`. The route module is server-only, so
 * the literal is restated here rather than imported into the client bundle;
 * `__tests__/no-project-access-contract.test.ts` pins the two together.
 */
const NO_PROJECT_ACCESS_REASON = 'no_project_access'

const PROJECT_ENTITY_ID = 'staff:staff_time_project'

type ProjectDetailInjectionContext = {
  entityId: string
  recordId: string | null
  projectId: string | null
  path: string | null
  retryLastMutation: () => Promise<boolean>
}

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

function readDenialReason(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const reason = (payload as { reason?: unknown }).reason
  return typeof reason === 'string' ? reason : null
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

type ProjectEntryRow = {
  id: string
  date: string
  description: string | null
  durationMinutes: number
  isBillable: boolean
  taskId: string | null
  staffMemberId: string | null
}

type ProjectTaskRow = {
  id: string
  reference: string | null
  title: string
  statusId: string | null
  assigneeStaffMemberId: string | null
  loggedMinutes: number | null
}

/**
 * A group heading inside the reference rail. The rail replaces three full-width
 * cards, so the groups carry the separation those card borders used to.
 */
function RailGroup({ label, first }: { label: string; first?: boolean }) {
  return (
    <div
      className={`border-b pb-1.5 text-overline font-semibold uppercase tracking-widest text-muted-foreground ${
        first ? '' : 'pt-4'
      }`}
    >
      {label}
    </div>
  )
}

function RailFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  )
}

export default function TimesheetProjectDetailPage({ params }: { params?: { id?: string } }) {
  const projectId = params?.id
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [project, setProject] = React.useState<ProjectRecord | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [accessDenied, setAccessDenied] = React.useState(false)

  const [employees, setEmployees] = React.useState<EmployeeAssignment[]>([])
  const [employeesLoading, setEmployeesLoading] = React.useState(false)
  const [expandedCards, setExpandedCards] = React.useState<Set<string>>(new Set())
  const [reloadToken, setReloadToken] = React.useState(0)

  // Tabs govern the working column only — the details rail stays visible on every
  // tab, because reference facts are what you check *while* reading the tab you
  // are on, not a destination of their own.
  const [activeTab, setActiveTab] = React.useState<string>('team')
  const [recentEntries, setRecentEntries] = React.useState<ProjectEntryRow[]>([])
  const [recentEntriesLoading, setRecentEntriesLoading] = React.useState(false)
  const [projectTasks, setProjectTasks] = React.useState<ProjectTaskRow[]>([])
  const [projectTasksLoading, setProjectTasksLoading] = React.useState(false)

  const [canManageProjects, setCanManageProjects] = React.useState(false)
  // Money is gated on the same feature the portfolio gates it on; a rate hidden
  // in the list must not be readable one click deeper.
  const [canSeeMoney, setCanSeeMoney] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<{ ok: boolean; granted: string[] }>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            features: ['staff.timesheets.projects.manage', 'staff.timesheets.rates.view'],
          }),
        })
        if (!cancelled) {
          const granted = new Set(res.result?.granted ?? [])
          setCanManageProjects(granted.has('staff.timesheets.projects.manage'))
          setCanSeeMoney(granted.has('staff.timesheets.rates.view'))
        }
      } catch {
        // default: no manage access, no money
      }
    })()
    return () => { cancelled = true }
  }, [])

  const [addDialogOpen, setAddDialogOpen] = React.useState(false)
  const [addStaffMemberId, setAddStaffMemberId] = React.useState<string | null>(null)
  const [addRole, setAddRole] = React.useState('')
  const [addStartDate, setAddStartDate] = React.useState('')
  const [addSaving, setAddSaving] = React.useState(false)
  const [staffLookupError, setStaffLookupError] = React.useState<string | null>(null)

  // Fetched per tab rather than up front: a project page opened to check a rate
  // should not pay for two lists nobody looked at.
  React.useEffect(() => {
    if (!projectId || activeTab !== 'time') return
    let cancelled = false
    void (async () => {
      setRecentEntriesLoading(true)
      try {
        const res = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/staff/timesheets/time-entries?projectId=${encodeURIComponent(projectId)}&page=1&pageSize=25&sortField=date&sortDir=desc`,
        )
        if (cancelled || !res.ok) return
        const items = Array.isArray(res.result?.items) ? res.result.items : []
        setRecentEntries(
          items
            .map((row): ProjectEntryRow | null => {
              const id = typeof row.id === 'string' ? row.id : null
              if (!id) return null
              const raw = row as Record<string, unknown>
              const minutes = raw.duration_minutes ?? raw.durationMinutes
              return {
                id,
                date: typeof raw.date === 'string' ? raw.date.slice(0, 10) : '',
                description:
                  typeof raw.description === 'string'
                    ? raw.description
                    : typeof raw.notes === 'string'
                      ? raw.notes
                      : null,
                durationMinutes: typeof minutes === 'number' ? minutes : Number(minutes ?? 0) || 0,
                isBillable: raw.is_billable === true || raw.isBillable === true,
                taskId: typeof (raw.task_id ?? raw.taskId) === 'string' ? String(raw.task_id ?? raw.taskId) : null,
                staffMemberId:
                  typeof (raw.staff_member_id ?? raw.staffMemberId) === 'string'
                    ? String(raw.staff_member_id ?? raw.staffMemberId)
                    : null,
              }
            })
            .filter((row): row is ProjectEntryRow => row !== null),
        )
      } catch (err) {
        logger.warn('staff.timesheets.projects.detail recent entries failed', { err })
      } finally {
        if (!cancelled) setRecentEntriesLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, activeTab, reloadToken])

  React.useEffect(() => {
    if (!projectId || activeTab !== 'tasks') return
    let cancelled = false
    void (async () => {
      setProjectTasksLoading(true)
      try {
        const res = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          // `timeProjectId`, not `projectId`: the tasks list schema declares the
          // former and is `.passthrough()`, so the wrong name is accepted, never
          // read, and the tab silently lists every task in the tenant.
          `/api/staff/timesheets/tasks?timeProjectId=${encodeURIComponent(projectId)}&page=1&pageSize=50&sortField=reference&sortDir=asc`,
        )
        if (cancelled || !res.ok) return
        const items = Array.isArray(res.result?.items) ? res.result.items : []
        setProjectTasks(
          items
            .map((row): ProjectTaskRow | null => {
              const id = typeof row.id === 'string' ? row.id : null
              const title = typeof row.title === 'string' ? row.title : null
              if (!id || !title) return null
              const raw = row as Record<string, unknown>
              const logged = raw.loggedMinutes ?? raw.logged_minutes
              return {
                id,
                reference: typeof raw.reference === 'string' ? raw.reference : null,
                title,
                statusId:
                  typeof (raw.task_status_id ?? raw.taskStatusId) === 'string'
                    ? String(raw.task_status_id ?? raw.taskStatusId)
                    : null,
                assigneeStaffMemberId:
                  typeof (raw.assignee_staff_member_id ?? raw.assigneeStaffMemberId) === 'string'
                    ? String(raw.assignee_staff_member_id ?? raw.assigneeStaffMemberId)
                    : null,
                loggedMinutes: typeof logged === 'number' ? logged : null,
              }
            })
            .filter((row): row is ProjectTaskRow => row !== null),
        )
      } catch (err) {
        logger.warn('staff.timesheets.projects.detail tasks failed', { err })
      } finally {
        if (!cancelled) setProjectTasksLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, activeTab, reloadToken])

  const employeeNameById = React.useMemo(
    () => new Map(employees.map((emp) => [emp.staffMemberId, emp.displayName ?? ''])),
    [employees],
  )
  const activeCount = employees.filter((emp) => emp.status === 'active').length
  const inactiveCount = employees.length - activeCount

  // --- Load project ---
  React.useEffect(() => {
    if (!projectId) return
    let cancelled = false
    async function loadProject() {
      setLoading(true)
      setError(null)
      setIsNotFound(false)
      setAccessDenied(false)
      try {
        const queryParams = new URLSearchParams({ page: '1', pageSize: '1', ids: projectId! })
        const call = await apiCall<ProjectResponse>(
          `/api/staff/timesheets/time-projects?${queryParams.toString()}`,
        )
        // Screen 17: the route answers 404 with this discriminator for a project
        // the caller is not a member of, without naming it.
        if (call.status === 404 && readDenialReason(call.result) === NO_PROJECT_ACCESS_REASON) {
          if (!cancelled) setAccessDenied(true)
          return
        }
        if (!call.ok) {
          throw new Error(t('staff.timesheets.projects.errors.load', 'Failed to load project.'))
        }
        const payload = call.result
        const record = Array.isArray(payload?.items) ? payload.items[0] : null
        if (!record) {
          if (!cancelled) setIsNotFound(true)
          return
        }
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
    if (!projectId || accessDenied) return
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
          const staffRes = await apiCall<StaffMembersResponse>(
            `/api/staff/team-members?ids=${staffMemberIds.join(',')}&pageSize=100`,
          )
          if (staffRes.ok) {
            const staffItems = Array.isArray(staffRes.result?.items) ? staffRes.result.items : []
            staffMap = new Map(staffItems.map((member) => [member.id, member]))
          }
        } catch {
          // name resolution failed (e.g. 403 for employees) — show IDs as fallback
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
      logger.error('staff.timesheets.projects.employees.list', { err: loadError })
    } finally {
      setEmployeesLoading(false)
    }
  }, [projectId, accessDenied, t])

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

  const { runMutation, retryLastMutation } = useGuardedMutation<EmployeeMutationContext>({
    contextId: EMPLOYEE_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const projectInjectionContext = React.useMemo<ProjectDetailInjectionContext>(
    () => ({
      entityId: PROJECT_ENTITY_ID,
      recordId: projectId ?? null,
      projectId: projectId ?? null,
      path: pathname ?? null,
      retryLastMutation,
    }),
    [pathname, projectId, retryLastMutation],
  )

  const { widgets: injectedTabWidgets } = useInjectionWidgets<ProjectDetailInjectionContext>(
    extensionPoints.hosts.projectDetailTabs.spotId,
    { context: projectInjectionContext, triggerOnLoad: true },
  )

  const employeeMutationContext = React.useCallback(
    (resourceId: string): EmployeeMutationContext => ({
      formId: EMPLOYEE_MUTATION_CONTEXT_ID,
      resourceKind: EMPLOYEE_RESOURCE_KIND,
      resourceId,
      retryLastMutation,
    }),
    [retryLastMutation],
  )

  // optimistic-lock-exempt: the employee add/remove calls below mutate the
  // time-project ↔ staff-member assignment junction (createCrud/deleteCrud of a
  // membership row), not a shared editable aggregate. Junction add/remove is exempt
  // from OSS optimistic locking per the data-integrity contract.
  // --- Remove employee ---
  const handleRemoveEmployee = React.useCallback(async (emp: EmployeeAssignment) => {
    const confirmed = await confirm({
      title: t('staff.timesheets.projects.employees.remove', 'Remove'),
      text: t('staff.timesheets.projects.employees.removeConfirm', 'Remove this employee from the project?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () =>
          deleteCrud(
            `staff/timesheets/time-projects/${projectId}/employees`,
            emp.id,
            { errorMessage: t('staff.timesheets.projects.employees.removeError', 'Failed to remove employee.') },
          ),
        context: employeeMutationContext(emp.id),
        mutationPayload: { id: emp.id },
      })
      flash(t('staff.timesheets.projects.employees.removed', 'Employee removed.'), 'success')
      setReloadToken((token) => token + 1)
    } catch (removeError) {
      if (surfaceRecordConflict(removeError, t)) return
      flash(t('staff.timesheets.projects.employees.removeError', 'Failed to remove employee.'), 'error')
    }
  }, [projectId, confirm, employeeMutationContext, runMutation, t])

  // --- Add employee dialog ---
  const openAddDialog = React.useCallback(() => {
    setAddStaffMemberId(null)
    setAddRole('')
    setAddStartDate(new Date().toISOString().slice(0, 10))
    setStaffLookupError(null)
    setAddDialogOpen(true)
  }, [])

  // A failed lookup is not an empty roster: swallowing it here left the picker
  // claiming "No team members found" while the request had actually errored.
  const staffLookupErrorMessage = t(
    'staff.timesheets.projects.employees.loadError',
    'Could not load team members. Check your connection and try again.',
  )

  const fetchStaffMembers = React.useCallback(async (query: string) => {
    const params = new URLSearchParams({ search: query, pageSize: '20', isActive: 'true' })
    try {
      const payload = await readApiResultOrThrow<StaffMembersResponse>(
        `/api/staff/team-members?${params.toString()}`,
        undefined,
        { errorMessage: staffLookupErrorMessage, fallback: { items: [] } },
      )
      const items = Array.isArray(payload.items) ? payload.items : []
      setStaffLookupError(null)
      return items.map((member) => ({
        id: member.id,
        title: member.display_name ?? member.displayName ?? member.id,
        subtitle: member.team?.name ?? null,
      }))
    } catch (lookupError) {
      logger.error('staff.timesheets.projects.employees.lookup', { err: lookupError })
      setStaffLookupError(staffLookupErrorMessage)
      throw lookupError
    }
  }, [staffLookupErrorMessage])

  const handleAddEmployee = React.useCallback(async () => {
    if (!projectId || !addStaffMemberId || !addStartDate) return
    const payload = {
      staffMemberId: addStaffMemberId,
      timeProjectId: projectId,
      role: addRole.trim() || null,
      assignedStartDate: addStartDate,
    }
    setAddSaving(true)
    try {
      await runMutation({
        operation: () =>
          createCrud(`staff/timesheets/time-projects/${projectId}/employees`, payload, {
            errorMessage: t('staff.timesheets.projects.employees.addError', 'Failed to add employee.'),
          }),
        context: employeeMutationContext(addStaffMemberId),
        mutationPayload: payload,
      })
      flash(t('staff.timesheets.projects.employees.added', 'Employee added.'), 'success')
      setAddDialogOpen(false)
      setReloadToken((token) => token + 1)
    } catch (addError) {
      if (surfaceRecordConflict(addError, t)) return
      flash(addError instanceof Error ? addError.message : t('staff.timesheets.projects.employees.addError', 'Failed to add employee.'), 'error')
    } finally {
      setAddSaving(false)
    }
  }, [projectId, addStaffMemberId, addRole, addStartDate, employeeMutationContext, runMutation, t])

  // Screen 5: the team drawer lives behind `?panel=team` so the project form
  // link and the access-request notification (D-6, `&requesterUserId=`) can both
  // deep-link into it. Assignment is a Team-Leader affordance, so the panel only
  // mounts for holders of `staff.timesheets.projects.manage`.
  const teamPanelRequested = searchParams?.get('panel') === 'team'
  const teamDrawerOpen = teamPanelRequested && canManageProjects
  const requesterUserId = searchParams?.get('requesterUserId') ?? null

  const openTeamDrawer = React.useCallback(() => {
    router.replace(`${pathname}?panel=team`)
  }, [pathname, router])

  const handleTeamDrawerOpenChange = React.useCallback((next: boolean) => {
    if (next) openTeamDrawer()
    else router.replace(pathname ?? BACK_HREF)
  }, [openTeamDrawer, pathname, router])

  const handleTeamSaved = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

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

  // Screen 17 — the caller may not open this project. The guard state names
  // neither the customer nor the project (note 1), and the surrounding shell
  // (sidebar, topbar) is untouched because the caller still has other projects
  // (note 3).
  if (accessDenied) {
    return <NoProjectAccess timeProjectId={projectId} />
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('staff.timesheets.projects.errors.notFound', 'Project not found.')}
            backHref={BACK_HREF}
            backLabel={t('staff.timesheets.projects.actions.backToList', 'Back to projects')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !project) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('staff.timesheets.projects.errors.load', 'Failed to load project.')} />
        </PageBody>
      </Page>
    )
  }

  const projectStatus = project.status ?? 'active'
  const projectType = project.projectType ?? project.project_type ?? null
  const projectStartDate = project.startDate ?? project.start_date ?? null
  const projectCode = project.code

  // Everything below already arrives in the list projection this page reads with
  // `?ids=`; the card used to render five of the ~22 columns and drop the rest,
  // so rate, budget, customer and cost centre were only visible by opening Edit.
  const readString = (...keys: string[]): string | null => {
    for (const key of keys) {
      const raw = (project as Record<string, unknown>)[key]
      if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim()
      if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
    }
    return null
  }
  const readNumber = (...keys: string[]): number | null => {
    for (const key of keys) {
      const raw = (project as Record<string, unknown>)[key]
      const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }
  const readBool = (...keys: string[]): boolean | null => {
    for (const key of keys) {
      const raw = (project as Record<string, unknown>)[key]
      if (typeof raw === 'boolean') return raw
    }
    return null
  }

  const enrichment = ((project as Record<string, unknown>)._staff ?? {}) as Record<string, unknown>
  const readEnriched = (key: string): number | null => {
    const raw = enrichment[key]
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }

  const customerSnapshot = ((project as Record<string, unknown>).customerSnapshot
    ?? (project as Record<string, unknown>).customer_snapshot) as Record<string, unknown> | null | undefined
  const customerName =
    (typeof customerSnapshot?.name === 'string' ? customerSnapshot.name : null)
    ?? (typeof enrichment.customerName === 'string' ? enrichment.customerName : null)
  const customerId = readString('customerId', 'customer_id')
  const projectColor = readString('color')
  const costCenter = readString('costCenter', 'cost_center')
  const currencyCode = readString('currencyCode', 'currency_code')
  const hourlyRate = readNumber('hourlyRate', 'hourly_rate')
  const billableByDefault = readBool('billableByDefault', 'billable_by_default')
  const createdAt = readString('createdAt', 'created_at')
  const updatedAt = readString('updatedAt', 'updated_at')
  const entryCount = readNumber('entryCount')
  const currencyLocked = readBool('currencyLocked') ?? false
  const lockedEntryCount = readNumber('lockedEntryCount')
  const totalMinutes = readEnriched('totalMinutes') ?? 0
  const billableMinutes = readEnriched('billableMinutes')
  const cost = readEnriched('cost')
  const nonBillableMinutes = billableMinutes === null ? null : Math.max(0, totalMinutes - billableMinutes)
  const billablePercent =
    billableMinutes === null || totalMinutes <= 0 ? null : Math.round((billableMinutes / totalMinutes) * 100)
  const hoursTrend = Array.isArray(enrichment.hoursTrend)
    ? (enrichment.hoursTrend as unknown[]).filter((value): value is number => typeof value === 'number')
    : []

  const budgetKind = readString('budgetKind', 'budget_kind')
  const budgetValue = readNumber('budgetValue', 'budget_value')
  const budgetWarnAt = readNumber('budgetWarnAtPercent', 'budget_warn_at_percent')
  const budgetBurn = computeBudgetBurn({
    kind: budgetKind as 'none' | 'hours' | 'amount' | null,
    budgetValue,
    warnAtPercent: budgetWarnAt,
    totalMinutes,
    cost,
  })

  const formatHours = (minutes: number | null): string => {
    if (minutes === null) return '—'
    const sign = minutes < 0 ? '-' : ''
    const abs = Math.abs(minutes)
    return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
  }
  const formatDateTime = (value: string | null): string => {
    if (!value) return '—'
    // The query engine returns `2026-05-24 00:00:00+00` — a space separator and a
    // two-digit offset, neither of which `Date` accepts, so both need widening
    // before parsing or every timestamp renders raw.
    //
    // The offset is only widened when a clock precedes it: anchoring on the
    // trailing `-24` alone also matches the day of a date-only `2026-05-24`,
    // which turns a valid date into `2026-05-24:00` and renders it raw.
    const normalized = value
      .replace(' ', 'T')
      .replace(/(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})$/, '$1$2:00')
    const parsed = new Date(normalized)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString()
  }
  const budgetUsageLabel = budgetBurn
    ? budgetBurn.kind === 'hours'
      ? t('staff.timesheets.projects.detail.budgetHours', '{percent}% of {value} h', {
          percent: budgetBurn.percent,
          value: budgetBurn.budgetValue,
        })
      : t('staff.timesheets.projects.detail.budgetAmount', '{percent}% of {value}', {
          percent: budgetBurn.percent,
          value: formatCurrency(budgetBurn.budgetValue, currencyCode ?? undefined) ?? String(budgetBurn.budgetValue),
        })
    : null

  const injectedTabs = injectedTabWidgets
    .filter((widget) => (widget.placement?.kind ?? 'tab') === 'tab')
    .map((widget) => {
      const tabId = widget.placement?.groupId ?? widget.widgetId
      const groupLabel = widget.placement?.groupLabel
      const label = groupLabel ? t(groupLabel, groupLabel) : widget.module.metadata.title ?? tabId
      const priority = typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0
      return { tabId, label, priority, Widget: widget.module.Widget }
    })
    .sort((left, right) => right.priority - left.priority)

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          {/*
            * Identity first: colour, name, and the two states worth knowing before
            * anything else — is it running, and is the budget in trouble. The code,
            * customer, type and start date sit under it as one meta line rather than
            * four labelled rows, because none of them is a decision on its own.
            */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <Button variant="ghost" size="icon" asChild>
                <Link href={BACK_HREF}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-sm border border-border"
                    style={{ backgroundColor: resolveProjectColorHex(projectColor, project.name) }}
                    aria-hidden
                  />
                  <h1 className="text-xl font-semibold">{project.name}</h1>
                  <Badge
                    variant={projectStatus === 'active' ? 'success' : projectStatus === 'on_hold' ? 'warning' : 'neutral'}
                    className="capitalize"
                  >
                    {projectStatus}
                  </Badge>
                  {canSeeMoney && budgetBurn && budgetBurn.tone !== 'accent' ? (
                    <Badge variant={budgetBurn.tone === 'destructive' ? 'destructive' : 'warning'}>
                      {t('staff.timesheets.projects.detail.budgetBadge', 'Budget {percent}%', {
                        percent: budgetBurn.percent,
                      })}
                    </Badge>
                  ) : null}
                  <InjectionSpot
                    spotId={extensionPoints.hosts.projectDetailStatusBadges.spotId}
                    context={projectInjectionContext}
                    data={project}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                    {projectCode}
                  </span>
                  {customerName ? (
                    <>
                      <span aria-hidden>·</span>
                      {customerId ? (
                        <Link className="underline underline-offset-2" href={`/backend/customers/companies/${customerId}`}>
                          {customerName}
                        </Link>
                      ) : (
                        <span>{customerName}</span>
                      )}
                    </>
                  ) : null}
                  {projectType ? (<><span aria-hidden>·</span><span>{projectType}</span></>) : null}
                  {projectStartDate ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        {t('staff.timesheets.projects.detail.startedOn', 'Started {date}', {
                          date: formatDateTime(projectStartDate),
                        })}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            {canManageProjects && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={openTeamDrawer}>
                  <Users className="mr-2 h-4 w-4" aria-hidden />
                  {t('staff.time_tracking.projects.team.manage', 'Manage team')}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/backend/staff/time-tracking/projects/${projectId}/edit`}>
                    <Pencil className="mr-2 h-4 w-4" aria-hidden />
                    {t('staff.timesheets.projects.form.actions.edit', 'Edit Project')}
                  </Link>
                </Button>
              </div>
            )}
            <InjectionSpot
              spotId={extensionPoints.hosts.projectDetailHeader.spotId}
              context={projectInjectionContext}
              data={project}
            />
          </div>

          {/*
            * Summary before detail. Four figures across the full width, in the order
            * somebody asks them: how much time, how much of it billable, what it
            * cost, how close the budget is. The three stacked label/value cards this
            * replaces gave all fourteen fields identical weight.
            */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title={t('staff.timesheets.projects.detail.loggedHours', 'Logged hours')}
              value={totalMinutes / 60}
              formatValue={() => formatHours(totalMinutes)}
              footer={
                hoursTrend.length > 0 ? (
                  <Sparkline
                    values={hoursTrend}
                    ariaLabel={t('staff.timesheets.projects.detail.trendAria', 'Hours per week, last 7 weeks')}
                  />
                ) : undefined
              }
              headerAction={
                entryCount !== null ? (
                  <span className="text-xs text-muted-foreground">
                    {entryCount === 1
                      ? t('staff.timesheets.projects.detail.entryCountOne', '1 entry')
                      : t('staff.timesheets.projects.detail.entryCountShort', '{count} entries', { count: entryCount })}
                  </span>
                ) : undefined
              }
            />
            <KpiCard
              title={t('staff.timesheets.projects.detail.billableHours', 'Billable hours')}
              value={(billableMinutes ?? 0) / 60}
              formatValue={() => formatHours(billableMinutes)}
              headerAction={
                billablePercent !== null ? (
                  <Badge variant={billablePercent >= 80 ? 'success' : 'neutral'}>{`${billablePercent}%`}</Badge>
                ) : undefined
              }
              footer={
                nonBillableMinutes !== null ? (
                  <span className="text-xs text-muted-foreground">
                    {t('staff.timesheets.projects.detail.nonBillable', '{hours} non-billable', {
                      hours: formatHours(nonBillableMinutes),
                    })}
                  </span>
                ) : undefined
              }
            />
            {canSeeMoney ? (
              <KpiCard
                title={t('staff.timesheets.projects.detail.cost', 'Cost to date')}
                value={cost}
                formatValue={(value) => formatCurrency(value, currencyCode ?? undefined) ?? String(value)}
                footer={
                  hourlyRate !== null ? (
                    <span className="text-xs text-muted-foreground">
                      {t('staff.timesheets.projects.detail.costBasis', '{hours} × {rate}', {
                        hours: formatHours(billableMinutes),
                        rate: `${formatCurrency(hourlyRate, currencyCode ?? undefined) ?? hourlyRate}/h`,
                      })}
                    </span>
                  ) : undefined
                }
              />
            ) : null}
            {canSeeMoney ? (
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t('staff.timesheets.projects.form.budget', 'Budget')}
                  </span>
                  {budgetBurn ? (
                    <Badge
                      variant={
                        budgetBurn.tone === 'destructive'
                          ? 'destructive'
                          : budgetBurn.tone === 'warning'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {`${budgetBurn.percent}%`}
                    </Badge>
                  ) : (
                    <Badge variant="neutral">{t('staff.timesheets.projects.detail.noBudget', 'No budget')}</Badge>
                  )}
                </div>
                <div className="mt-2 space-y-2">
                  <p className="text-2xl font-semibold tabular-nums">
                    {budgetBurn ? `${budgetBurn.percent}%` : '—'}
                  </p>
                  <ProjectBudgetCell
                    burn={budgetBurn}
                    usageLabel={budgetUsageLabel}
                    noBudgetLabel={t('staff.timesheets.projects.detail.budgetHint', 'Set one to track burn')}
                    ariaLabel={t('staff.timesheets.projects.detail.budgetUsage', 'Budget usage')}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/*
            * Working content left, reference right. Everything static — rate,
            * currency, cost centre, timestamps — collapses into one rail instead of
            * three full-width cards, which is what left the right half of a wide
            * screen carrying nothing.
            */}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            variant="underline"
            className="min-w-0"
          >
            <TabsList aria-label={t('staff.timesheets.projects.detail.tabs', 'Project sections')}>
              <TabsTrigger value="team" count={activeCount}>
                {t('staff.timesheets.projects.detail.tabTeam', 'Team')}
              </TabsTrigger>
              <TabsTrigger value="time" count={entryCount ?? undefined}>
                {t('staff.timesheets.projects.detail.tabTime', 'Time')}
              </TabsTrigger>
              <TabsTrigger value="tasks">
                {t('staff.timesheets.projects.detail.tabTasks', 'Tasks')}
              </TabsTrigger>
              {injectedTabs.map((tab) => (
                <TabsTrigger key={tab.tabId} value={tab.tabId}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="team">
          {/* Assigned Employees — collapsible cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="sr-only">
                {t('staff.timesheets.projects.employees.title', 'Assigned Employees')}
              </h2>
              <span />
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
                          <Badge
                            variant={(emp.status ?? 'active') === 'active' ? 'success' : 'neutral'}
                            className="capitalize"
                          >
                            {emp.status ?? 'active'}
                          </Badge>
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
            </TabsContent>

            <TabsContent value="time">
              {recentEntriesLoading ? (
                <LoadingMessage label={t('staff.timesheets.projects.detail.loadingTime', 'Loading time entries…')} />
              ) : recentEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm font-medium">
                    {t('staff.timesheets.projects.detail.noTime', 'No time logged yet')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('staff.timesheets.projects.detail.noTimeHint', 'Hours logged against this project appear here.')}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left">
                        <th className="px-3 py-2 font-medium text-muted-foreground">
                          {t('staff.timesheets.projects.detail.colDate', 'Date')}
                        </th>
                        <th className="px-3 py-2 font-medium text-muted-foreground">
                          {t('staff.timesheets.projects.detail.colWho', 'Person')}
                        </th>
                        <th className="px-3 py-2 font-medium text-muted-foreground">
                          {t('staff.timesheets.projects.detail.colDescription', 'Description')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                          {t('staff.timesheets.projects.detail.colHours', 'Hours')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentEntries.map((entry) => (
                        <tr key={entry.id} className="border-b last:border-b-0">
                          <td className="whitespace-nowrap px-3 py-2">{entry.date}</td>
                          <td className="whitespace-nowrap px-3 py-2">
                            {employeeNameById.get(entry.staffMemberId ?? '') ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2">
                              <span className="truncate">{entry.description ?? '—'}</span>
                              {entry.isBillable ? null : (
                                <Badge variant="neutral">
                                  {t('staff.timesheets.projects.detail.nonBillableTag', 'non-billable')}
                                </Badge>
                              )}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                            {formatHours(entry.durationMinutes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="tasks">
              {projectTasksLoading ? (
                <LoadingMessage label={t('staff.timesheets.projects.detail.loadingTasks', 'Loading tasks…')} />
              ) : projectTasks.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm font-medium">
                    {t('staff.timesheets.projects.detail.noTasks', 'No tasks yet')}
                  </p>
                </div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {projectTasks.map((task) => (
                    <div key={task.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      {task.reference ? (
                        <span className="shrink-0 rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {task.reference}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {employeeNameById.get(task.assigneeStaffMemberId ?? '') ?? ''}
                      </span>
                      {task.loggedMinutes !== null ? (
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                          {formatHours(task.loggedMinutes)}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {injectedTabs.map((tab) => (
              <TabsContent key={tab.tabId} value={tab.tabId}>
                <tab.Widget context={projectInjectionContext} data={project} />
              </TabsContent>
            ))}
          </Tabs>

          {/* Reference rail — one card, grouped, no longer three stacked sections. */}
          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">
                {t('staff.timesheets.projects.detail.details', 'Details')}
              </h2>
            </div>
            <div className="px-4 py-3">
              {canSeeMoney ? (
                <>
                  <RailGroup label={t('staff.timesheets.projects.detail.commercials', 'Billing')} first />
                  <dl>
                    <RailFact
                      label={t('staff.timesheets.projects.form.hourlyRate', 'Hourly rate')}
                      value={
                        hourlyRate === null
                          ? '—'
                          : `${formatCurrency(hourlyRate, currencyCode ?? undefined) ?? hourlyRate} / h`
                      }
                    />
                    <RailFact
                      label={t('staff.timesheets.projects.form.currency', 'Currency')}
                      value={
                        <span className="inline-flex items-center gap-1.5">
                          {currencyCode ?? '—'}
                          {currencyLocked ? (
                            <Badge
                              variant="neutral"
                              title={t(
                                'staff.timesheets.projects.detail.currencyLockedHint',
                                'Locked because hours are already logged against this project.',
                              )}
                            >
                              {t('staff.timesheets.projects.detail.locked', 'locked')}
                            </Badge>
                          ) : null}
                        </span>
                      }
                    />
                    <RailFact
                      label={t('staff.timesheets.projects.form.billableByDefault', 'Billable by default')}
                      value={
                        billableByDefault === null ? (
                          '—'
                        ) : (
                          <Badge variant={billableByDefault ? 'success' : 'neutral'}>
                            {billableByDefault
                              ? t('staff.timesheets.projects.detail.yes', 'Yes')
                              : t('staff.timesheets.projects.detail.no', 'No')}
                          </Badge>
                        )
                      }
                    />
                  </dl>
                </>
              ) : null}

              <RailGroup
                label={t('staff.timesheets.projects.detail.delivery', 'Delivery')}
                first={!canSeeMoney}
              />
              <dl>
                <RailFact
                  label={t('staff.timesheets.projects.detail.entryCount', 'Time entries')}
                  value={entryCount ?? '—'}
                />
                <RailFact
                  label={t('staff.timesheets.projects.detail.lockedEntries', 'Locked in reports')}
                  value={lockedEntryCount ?? '—'}
                />
              </dl>

              <RailGroup label={t('staff.timesheets.projects.detail.administration', 'Administration')} />
              <dl>
                <RailFact
                  label={t('staff.timesheets.projects.form.costCenter', 'Cost center')}
                  value={costCenter ?? '—'}
                />
                <RailFact
                  label={t('staff.timesheets.projects.form.color', 'Project color')}
                  value={
                    <span className="inline-flex items-center gap-1.5 capitalize">
                      <span
                        className="size-2.5 rounded-full border border-border"
                        style={{ backgroundColor: resolveProjectColorHex(projectColor, project.name) }}
                        aria-hidden
                      />
                      {projectColor ?? t('staff.timesheets.projects.detail.autoColor', 'Auto')}
                    </span>
                  }
                />
                <RailFact
                  label={t('staff.timesheets.projects.detail.createdAt', 'Created')}
                  value={formatDateTime(createdAt)}
                />
                <RailFact
                  label={t('staff.timesheets.projects.detail.updatedAt', 'Last updated')}
                  value={formatDateTime(updatedAt)}
                />
              </dl>

              {project.description ? (
                <>
                  <RailGroup label={t('staff.timesheets.projects.form.description', 'Description')} />
                  <p className="whitespace-pre-wrap pt-2 text-sm text-muted-foreground">{project.description}</p>
                </>
              ) : null}
              <InjectionSpot
                spotId={extensionPoints.hosts.projectDetailSidebar.spotId}
                context={projectInjectionContext}
                data={project}
              />
            </div>
          </div>
          </div>
          <InjectionSpot
            spotId={extensionPoints.hosts.projectDetailFooter.spotId}
            context={projectInjectionContext}
            data={project}
          />
        </div>

        {ConfirmDialogElement}

        {projectId && teamDrawerOpen ? (
          <ProjectTeamDrawer
            projectId={projectId}
            projectName={project.name}
            open={teamDrawerOpen}
            onOpenChange={handleTeamDrawerOpenChange}
            preselectUserId={requesterUserId}
            onSaved={handleTeamSaved}
          />
        ) : null}

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
                {staffLookupError ? (
                  <p className="text-xs text-status-error-text" role="alert">
                    {staffLookupError}
                  </p>
                ) : null}
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
                  {addSaving ? <Spinner className="size-4" /> : null}
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
