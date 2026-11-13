/**
 * Demo data for the time-tracking consulting suite.
 *
 * The module has a cold-start problem the team examples do not: a fresh tenant
 * lands on an empty portfolio, an empty board, an empty week grid and an empty
 * report list, and every screen that makes the module worth having only means
 * something once hours exist. This seed fills all four at once — four projects
 * against real customers, a populated Kanban board, ten weeks of logged time and
 * two reports, one of them closed so the lock behaviour is visible without
 * anybody having to close one first.
 *
 * Everything is derived from a fixed pseudo-random sequence rather than
 * `Math.random`, so two people demoing the same build see the same hours and the
 * same totals, and a screenshot stays true after a re-seed.
 *
 * Idempotency is a single check on the demo project codes: this is example data,
 * not reference data, so it is written once and afterwards left alone rather
 * than reconciled field by field.
 *
 * **Indexing.** Rows are written straight through the EntityManager rather than
 * through the module's commands, so none of them reach the query index. Listing
 * is unaffected — the engine reads base tables — but `$ilike` filters are
 * answered from the token index, so search returns nothing for seeded data until
 * `mercato query_index reindex` has run. The CLI command says so on success; a
 * caller invoking this function directly has to know.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import {
  StaffTeamMember,
  StaffTimeEntry,
  StaffTimeEntryTag,
  StaffTimeProject,
  StaffTimeProjectMember,
  StaffTimeReport,
  StaffTimeReportEntry,
  StaffTimeReportEvent,
  StaffTimeReportProject,
  StaffTimeTag,
  StaffTimeTask,
  StaffTimeTaskComment,
  StaffTimeTaskStatus,
  StaffTimeTaskTag,
} from '../data/entities'
import { seedProjectTaskStatuses } from './timesheets-tasks/seedProjectStatuses'
import { formatTaskReference } from './timesheets-tasks/taskReference'
import { allocateReportReference, highestReportSequenceNumber } from './timesheets-reports/reportReference'
import { entryAmount, round2, sumAmounts } from './time-tracking/cost'
import { DEFAULT_ROUNDING_SETTINGS, roundMinutes } from './time-tracking/rounding'
import type { ProjectColorKey } from './timesheets-ui/colors'

export type StaffTimeTrackingSeedScope = { tenantId: string; organizationId: string }

type ProjectSeed = {
  code: string
  name: string
  description: string
  projectType: string
  color: ProjectColorKey
  status: 'active' | 'on_hold' | 'completed'
  hourlyRate: number
  currencyCode: string
  billableByDefault: boolean
  budgetKind: 'none' | 'hours' | 'amount'
  budgetValue: number | null
  costCenter: string
  customerIndex: number
  startedDaysAgo: number
  /** Members by index into the resolved staff list, first one is the lead. */
  memberIndexes: number[]
  memberRoles: string[]
}

type TaskSeed = {
  statusSlug: string
  title: string
  description: string
  assigneeIndex: number | null
  tagSlugs: string[]
  comments?: string[]
  subtasks?: { statusSlug: string; title: string; assigneeIndex: number | null }[]
}

type TagSeed = { slug: string; label: string; color: ProjectColorKey }

const DEMO_TAGS: TagSeed[] = [
  { slug: 'client-call', label: 'Client call', color: 'blue' },
  { slug: 'development', label: 'Development', color: 'indigo' },
  { slug: 'bugfix', label: 'Bugfix', color: 'red' },
  { slug: 'research', label: 'Research', color: 'purple' },
  { slug: 'internal', label: 'Internal', color: 'slate' },
]

/**
 * Budgets are sized against the hours this file generates so the portfolio shows
 * one of each state rather than four identical red bars: Atlas and Nova sit
 * comfortably inside, Apollo runs into the 80% warning, Orbit is over. The exact
 * percentages drift a little with the weekday the seed runs on, which is fine —
 * the states do not.
 */
const DEMO_PROJECTS: ProjectSeed[] = [
  {
    code: 'APOLLO',
    name: 'Apollo — Website Redesign',
    description:
      'Full redesign of the public site and booking flow, delivered in three milestones with a fixed launch date.',
    projectType: 'Fixed scope',
    color: 'blue',
    status: 'active',
    hourlyRate: 150,
    currencyCode: 'USD',
    billableByDefault: true,
    budgetKind: 'hours',
    budgetValue: 720,
    costCenter: 'CC-100',
    customerIndex: 0,
    startedDaysAgo: 84,
    memberIndexes: [0, 1, 3],
    memberRoles: ['Project manager', 'Frontend engineer', 'UX designer'],
  },
  {
    code: 'ATLAS',
    name: 'Atlas — Data Platform Integration',
    description:
      'Ingest pipeline, warehouse modelling and a reporting API against the customer analytics platform.',
    projectType: 'Time & materials',
    color: 'emerald',
    status: 'active',
    hourlyRate: 175,
    currencyCode: 'USD',
    billableByDefault: true,
    budgetKind: 'amount',
    budgetValue: 100000,
    costCenter: 'CC-200',
    customerIndex: 1,
    startedDaysAgo: 63,
    memberIndexes: [0, 4, 2],
    memberRoles: ['Tech lead', 'DevOps engineer', 'Product manager'],
  },
  {
    code: 'ORBIT',
    name: 'Orbit — Support Retainer',
    description:
      'Monthly retainer covering incident response, small enhancements and a standing weekly check-in call.',
    projectType: 'Retainer',
    color: 'orange',
    status: 'active',
    hourlyRate: 120,
    currencyCode: 'USD',
    billableByDefault: true,
    budgetKind: 'hours',
    budgetValue: 360,
    costCenter: 'CC-300',
    customerIndex: 2,
    startedDaysAgo: 70,
    memberIndexes: [4, 1],
    memberRoles: ['Support lead', 'Frontend engineer'],
  },
  {
    code: 'NOVA',
    name: 'Nova — ERP Migration Discovery',
    description:
      'Discovery phase for the ERP migration. Paused while the customer finalises the vendor short-list.',
    projectType: 'Discovery',
    color: 'purple',
    status: 'on_hold',
    hourlyRate: 165,
    currencyCode: 'USD',
    billableByDefault: true,
    budgetKind: 'hours',
    budgetValue: 240,
    costCenter: 'CC-400',
    customerIndex: 0,
    startedDaysAgo: 49,
    memberIndexes: [2, 0],
    memberRoles: ['Product manager', 'Solution architect'],
  },
]

const DEMO_TASKS: Record<string, TaskSeed[]> = {
  APOLLO: [
    {
      statusSlug: 'done',
      title: 'Discovery workshop with the client',
      description: 'Two half-day sessions covering the current booking funnel and the drop-off points.',
      assigneeIndex: 0,
      tagSlugs: ['client-call', 'research'],
      comments: ['Recording and notes shared with the client the same afternoon.'],
    },
    {
      statusSlug: 'done',
      title: 'Information architecture and sitemap',
      description: 'Consolidate 40 pages into 18 and agree the new navigation.',
      assigneeIndex: 3,
      tagSlugs: ['research'],
    },
    {
      statusSlug: 'in-review',
      title: 'Design system and component library',
      description: 'Tokens, typography scale and the twelve components the new pages are built from.',
      assigneeIndex: 3,
      tagSlugs: ['development'],
      comments: ['Waiting on brand sign-off for the secondary palette.'],
      subtasks: [
        { statusSlug: 'done', title: 'Colour and typography tokens', assigneeIndex: 3 },
        { statusSlug: 'in-review', title: 'Form and input components', assigneeIndex: 1 },
      ],
    },
    {
      statusSlug: 'in-progress',
      title: 'Booking flow rebuild',
      description: 'Rebuild the four-step booking flow on the new component library.',
      assigneeIndex: 1,
      tagSlugs: ['development'],
      subtasks: [
        { statusSlug: 'done', title: 'Step 1 — date and party size', assigneeIndex: 1 },
        { statusSlug: 'in-progress', title: 'Step 2 — table selection', assigneeIndex: 1 },
        { statusSlug: 'backlog', title: 'Step 3 — guest details', assigneeIndex: null },
      ],
    },
    {
      statusSlug: 'in-progress',
      title: 'Fix layout shift on the gallery page',
      description: 'Images without intrinsic dimensions push the footer around on first paint.',
      assigneeIndex: 1,
      tagSlugs: ['bugfix'],
    },
    {
      statusSlug: 'backlog',
      title: 'Analytics and conversion tracking',
      description: 'Event map for the new funnel plus the dashboard the client reviews weekly.',
      assigneeIndex: 0,
      tagSlugs: ['development'],
    },
    {
      statusSlug: 'backlog',
      title: 'Content migration',
      description: 'Move and re-edit the existing copy into the new page templates.',
      assigneeIndex: null,
      tagSlugs: [],
    },
  ],
  ATLAS: [
    {
      statusSlug: 'done',
      title: 'Source system audit',
      description: 'Catalogue the six source systems, their volumes and their refresh windows.',
      assigneeIndex: 0,
      tagSlugs: ['research'],
    },
    {
      statusSlug: 'in-progress',
      title: 'Ingest pipeline',
      description: 'Incremental loads with replay, running on the customer scheduler.',
      assigneeIndex: 4,
      tagSlugs: ['development'],
      comments: [
        'Replay from an arbitrary watermark works; still tuning the batch size for the largest table.',
      ],
      subtasks: [
        { statusSlug: 'done', title: 'Connector framework', assigneeIndex: 4 },
        { statusSlug: 'in-progress', title: 'Incremental watermarks', assigneeIndex: 4 },
      ],
    },
    {
      statusSlug: 'in-progress',
      title: 'Warehouse dimensional model',
      description: 'Star schema for orders, customers and merchandising decisions.',
      assigneeIndex: 0,
      tagSlugs: ['development'],
    },
    {
      statusSlug: 'in-review',
      title: 'Reporting API contract',
      description: 'The endpoints the customer BI layer reads, versioned and documented.',
      assigneeIndex: 2,
      tagSlugs: ['client-call'],
    },
    {
      statusSlug: 'backlog',
      title: 'Data quality monitors',
      description: 'Freshness, row-count and null-rate checks with alerting into the customer channel.',
      assigneeIndex: 4,
      tagSlugs: ['development'],
    },
    {
      statusSlug: 'backlog',
      title: 'Handover documentation',
      description: 'Runbook, architecture note and the on-call escalation path.',
      assigneeIndex: null,
      tagSlugs: ['internal'],
    },
  ],
  ORBIT: [
    {
      statusSlug: 'done',
      title: 'March incident — checkout timeouts',
      description: 'Connection pool exhaustion under the promotion traffic spike.',
      assigneeIndex: 4,
      tagSlugs: ['bugfix'],
      comments: ['Root cause and the pool sizing change written up for the customer.'],
    },
    {
      statusSlug: 'in-progress',
      title: 'Monthly dependency and security updates',
      description: 'Patch level, CVE review and a staged rollout.',
      assigneeIndex: 4,
      tagSlugs: ['internal'],
    },
    {
      statusSlug: 'in-progress',
      title: 'Weekly check-in call',
      description: 'Standing Thursday call — backlog triage and the week ahead.',
      assigneeIndex: 1,
      tagSlugs: ['client-call'],
    },
    {
      statusSlug: 'backlog',
      title: 'Search relevance tuning',
      description: 'Synonyms and boosting for the ten highest-volume queries.',
      assigneeIndex: 1,
      tagSlugs: ['development'],
    },
  ],
  NOVA: [
    {
      statusSlug: 'done',
      title: 'Stakeholder interviews',
      description: 'Nine interviews across finance, warehouse and customer service.',
      assigneeIndex: 2,
      tagSlugs: ['client-call', 'research'],
    },
    {
      statusSlug: 'in-review',
      title: 'Process gap analysis',
      description: 'Where the current ERP is worked around, and what that costs per month.',
      assigneeIndex: 2,
      tagSlugs: ['research'],
      comments: ['Draft with the client; feedback expected once the vendor short-list closes.'],
    },
    {
      statusSlug: 'backlog',
      title: 'Migration options and estimates',
      description: 'Three options with cost, risk and a rough delivery window each.',
      assigneeIndex: 0,
      tagSlugs: [],
    },
  ],
}

const ENTRY_NOTES = [
  'Pairing session on the open items',
  'Implementation and self-review',
  'Client call and follow-up notes',
  'Code review and feedback round',
  'Debugging the reported regression',
  'Refinement and estimates for the next sprint',
  'Documentation and handover notes',
  'Environment and deployment work',
  'Design review with the team',
  'Investigating the reported edge case',
]

const NONBILLABLE_NOTES = [
  'Internal team sync',
  'Knowledge sharing session',
  'Onboarding a new team member',
]

/** Names used by `seedStaffTeamExamples`, in the order the demo projects expect them. */
const PREFERRED_MEMBER_NAMES = [
  'Alex Chen',
  'Priya Nair',
  'Marta Lopez',
  'Samir Haddad',
  'Jordan Kim',
]

const WEEKS_OF_HISTORY = 10

/**
 * Deterministic LCG. The demo has to produce the same hours on every machine —
 * a screenshot of the portfolio should still be true after somebody re-seeds.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length) % values.length]
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function atMinutes(date: Date, minutesFromMidnight: number): Date {
  return new Date(date.getTime() + minutesFromMidnight * 60_000)
}

type ResolvedCustomer = { id: string | null; name: string }

/**
 * Customers are read softly. The projects are worth having even in a tenant that
 * never seeded the CRM examples, so a missing customer degrades to a snapshot
 * name with no id rather than skipping the project — the portfolio still renders,
 * and only the edit form asks for a customer to be picked.
 */
async function resolveCustomers(
  em: EntityManager,
  scope: StaffTimeTrackingSeedScope,
): Promise<ResolvedCustomer[]> {
  const fallback: ResolvedCustomer[] = [
    { id: null, name: 'Copperleaf Design Co.' },
    { id: null, name: 'Harborview Analytics' },
    { id: null, name: 'Northwind Retail Group' },
  ]
  try {
    const entities = await findWithDecryption(
      em,
      CustomerEntity,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'company', deletedAt: null },
      { limit: 25 },
      scope,
    )
    const named = entities
      .map((entity) => ({ id: entity.id, name: (entity.displayName ?? '').trim() }))
      .filter((entity) => entity.name.length > 0)
      .sort((left, right) => left.name.localeCompare(right.name))
    if (named.length === 0) return fallback
    return fallback.map((entry, index) => named[index % named.length] ?? entry)
  } catch {
    return fallback
  }
}

async function resolveMembers(
  em: EntityManager,
  scope: StaffTimeTrackingSeedScope,
): Promise<StaffTeamMember[]> {
  const members = await findWithDecryption(
    em,
    StaffTeamMember,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, isActive: true, deletedAt: null },
    { limit: 50 },
    scope,
  )
  if (members.length === 0) return []
  const byName = new Map(members.map((member) => [(member.displayName ?? '').trim(), member]))
  const preferred = PREFERRED_MEMBER_NAMES.map((name) => byName.get(name)).filter(
    (member): member is StaffTeamMember => Boolean(member),
  )
  const remaining = members.filter((member) => !preferred.includes(member))
  const ordered = [...preferred, ...remaining]
  // Every project seed indexes up to five members; a smaller team wraps around so
  // a two-person tenant still gets every project staffed.
  return ordered
}

function memberAt(members: StaffTeamMember[], index: number): StaffTeamMember {
  return members[index % members.length]
}

export async function seedStaffTimeTrackingExamples(
  em: EntityManager,
  scope: StaffTimeTrackingSeedScope,
): Promise<boolean> {
  const codes = DEMO_PROJECTS.map((project) => project.code)
  const existing = await em.find(StaffTimeProject, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    code: { $in: codes },
    deletedAt: null,
  })
  if (existing.length > 0) return false

  const members = await resolveMembers(em, scope)
  if (members.length === 0) return false

  const customers = await resolveCustomers(em, scope)
  const users = await findWithDecryption(
    em,
    User,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { limit: 10 },
    scope,
  )
  const actorUserId = [...users]
    .sort((left, right) => (left.email ?? '').localeCompare(right.email ?? ''))[0]?.id ?? null

  const random = createRandom(20260812)
  const now = new Date()
  const today = startOfUtcDay(now)

  const tagBySlug = new Map<string, StaffTimeTag>()
  for (const seed of DEMO_TAGS) {
    const tag = em.create(StaffTimeTag, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      slug: seed.slug,
      label: seed.label,
      color: seed.color,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(tag)
    tagBySlug.set(seed.slug, tag)
  }
  await em.flush()

  type ProjectContext = {
    seed: ProjectSeed
    project: StaffTimeProject
    statusBySlug: Map<string, StaffTimeTaskStatus>
    tasks: StaffTimeTask[]
    /** Tasks that can carry time, keyed by the staff member they are assigned to. */
    tasksByMemberId: Map<string, StaffTimeTask[]>
    memberIds: string[]
  }

  const contexts: ProjectContext[] = []

  for (const seed of DEMO_PROJECTS) {
    const customer = customers[seed.customerIndex] ?? customers[0]
    const startDate = addDays(today, -seed.startedDaysAgo)
    const project = em.create(StaffTimeProject, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: seed.name,
      code: seed.code,
      description: seed.description,
      projectType: seed.projectType,
      color: seed.color,
      status: seed.status,
      customerId: customer.id,
      customerSnapshot: { name: customer.name, kind: 'company' },
      ownerUserId: actorUserId,
      costCenter: seed.costCenter,
      startDate,
      hourlyRate: seed.hourlyRate.toFixed(4),
      currencyCode: seed.currencyCode,
      billableByDefault: seed.billableByDefault,
      budgetKind: seed.budgetKind,
      budgetValue: seed.budgetValue === null ? null : seed.budgetValue.toFixed(4),
      budgetWarnAtPercent: 80,
      budgetAlertedAtPercent: null,
      createdAt: startDate,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(project)
    await em.flush()

    const statuses = seedProjectTaskStatuses(
      em,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, timeProjectId: project.id },
      (_key, fallback) => fallback,
    )
    await em.flush()
    const statusBySlug = new Map(statuses.map((status) => [status.slug, status]))

    const memberIds: string[] = []
    seed.memberIndexes.forEach((memberIndex, position) => {
      const member = memberAt(members, memberIndex)
      if (memberIds.includes(member.id)) return
      memberIds.push(member.id)
      em.persist(
        em.create(StaffTimeProjectMember, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          timeProjectId: project.id,
          staffMemberId: member.id,
          role: seed.memberRoles[position] ?? 'Consultant',
          status: 'active',
          // The lead and the first collaborator are pinned into the weekly grid so
          // the grid has rows the moment it opens.
          showInGrid: position < 2,
          assignedStartDate: startDate,
          assignedEndDate: null,
          createdAt: startDate,
          updatedAt: now,
          deletedAt: null,
        }),
      )
    })
    await em.flush()

    const taskSeeds = DEMO_TASKS[seed.code] ?? []
    const tasks: StaffTimeTask[] = []
    const tasksByMemberId = new Map<string, StaffTimeTask[]>()
    let sequenceNumber = 0

    const registerTask = (task: StaffTimeTask, assigneeId: string | null) => {
      tasks.push(task)
      if (!assigneeId) return
      const bucket = tasksByMemberId.get(assigneeId) ?? []
      bucket.push(task)
      tasksByMemberId.set(assigneeId, bucket)
    }

    for (const taskSeed of taskSeeds) {
      const status = statusBySlug.get(taskSeed.statusSlug) ?? statuses[0]
      const assignee =
        taskSeed.assigneeIndex === null ? null : memberAt(members, seed.memberIndexes[taskSeed.assigneeIndex] ?? taskSeed.assigneeIndex)
      sequenceNumber += 1
      const createdAt = addDays(startDate, Math.floor(random() * 10))
      const parent = em.create(StaffTimeTask, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        timeProjectId: project.id,
        parentTaskId: null,
        taskStatusId: status.id,
        sequenceNumber,
        reference: formatTaskReference(seed.code, sequenceNumber),
        title: taskSeed.title,
        description: taskSeed.description,
        assigneeStaffMemberId: assignee?.id ?? null,
        position: sequenceNumber * 1000,
        createdByUserId: actorUserId,
        closedAt: status.isDone ? addDays(today, -Math.floor(random() * 20) - 1) : null,
        createdAt,
        updatedAt: now,
        deletedAt: null,
      })
      em.persist(parent)
      await em.flush()
      registerTask(parent, assignee?.id ?? null)

      for (const slug of taskSeed.tagSlugs) {
        const tag = tagBySlug.get(slug)
        if (!tag) continue
        em.persist(
          em.create(StaffTimeTaskTag, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            tagId: tag.id,
            taskId: parent.id,
            createdAt: now,
          }),
        )
      }

      for (const body of taskSeed.comments ?? []) {
        em.persist(
          em.create(StaffTimeTaskComment, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            taskId: parent.id,
            body,
            authorUserId: actorUserId,
            createdAt: addDays(createdAt, 2),
            updatedAt: addDays(createdAt, 2),
            deletedAt: null,
          }),
        )
      }

      for (const subtaskSeed of taskSeed.subtasks ?? []) {
        const subtaskStatus = statusBySlug.get(subtaskSeed.statusSlug) ?? statuses[0]
        const subtaskAssignee =
          subtaskSeed.assigneeIndex === null
            ? null
            : memberAt(members, seed.memberIndexes[subtaskSeed.assigneeIndex] ?? subtaskSeed.assigneeIndex)
        sequenceNumber += 1
        const subtask = em.create(StaffTimeTask, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          timeProjectId: project.id,
          parentTaskId: parent.id,
          taskStatusId: subtaskStatus.id,
          sequenceNumber,
          reference: formatTaskReference(seed.code, sequenceNumber),
          title: subtaskSeed.title,
          description: null,
          assigneeStaffMemberId: subtaskAssignee?.id ?? null,
          position: sequenceNumber * 1000,
          createdByUserId: actorUserId,
          closedAt: subtaskStatus.isDone ? addDays(today, -Math.floor(random() * 15) - 1) : null,
          createdAt: addDays(createdAt, 1),
          updatedAt: now,
          deletedAt: null,
        })
        em.persist(subtask)
        await em.flush()
        registerTask(subtask, subtaskAssignee?.id ?? null)
      }
      await em.flush()
    }

    contexts.push({ seed, project, statusBySlug, tasks, tasksByMemberId, memberIds })
  }

  // --- Logged time -------------------------------------------------------
  //
  // Ten weeks of weekdays. Each member works the projects they are assigned to,
  // chaining entries from 09:00 so a day never overlaps itself — the same
  // invariant the entry command enforces on the write path.

  // A paused project stopped accruing time when it was paused, but it did accrue
  // some before — a project on hold with no history at all reads as a data bug.
  const pausedAfter = addDays(today, -21)

  const projectsByMemberId = new Map<string, ProjectContext[]>()
  for (const context of contexts) {
    for (const memberId of context.memberIds) {
      const bucket = projectsByMemberId.get(memberId) ?? []
      bucket.push(context)
      projectsByMemberId.set(memberId, bucket)
    }
  }

  const entriesByProjectId = new Map<string, StaffTimeEntry[]>()
  const firstDay = addDays(today, -(WEEKS_OF_HISTORY * 7) + 1)

  for (let offset = 0; offset < WEEKS_OF_HISTORY * 7; offset += 1) {
    const day = addDays(firstDay, offset)
    if (isWeekend(day)) continue

    for (const [memberId, memberProjects] of projectsByMemberId) {
      // Not everybody logs every day — a demo with a perfect grid reads as fake
      // and hides the "missing time" states the week view is built to show.
      if (random() < 0.12) continue

      // Only projects that had actually started, and had not been paused, on this
      // day. Filtering up front keeps the day's total intact: picking first and
      // discarding after would quietly turn a full day into a half one.
      const eligible = memberProjects.filter((context) => {
        if (day < startOfUtcDay(context.project.startDate ?? day)) return false
        return !(context.seed.status === 'on_hold' && day > pausedAfter)
      })
      if (eligible.length === 0) continue

      // A worked day, then split across projects — 6.5 to 9 hours against the
      // 8-hour default target, so the week view shows over, under and on target.
      let remainingMinutes = (13 + Math.floor(random() * 6)) * 30
      const entryCount = random() < 0.5 ? 2 : 3
      let cursorMinutes = 9 * 60 + Math.floor(random() * 4) * 15

      for (let index = 0; index < entryCount; index += 1) {
        const context = eligible[Math.floor(random() * eligible.length) % eligible.length]

        const candidates = context.tasksByMemberId.get(memberId) ?? context.tasks
        const task = candidates.length > 0 ? pick(random, candidates) : null

        const isLast = index === entryCount - 1
        const share = Math.round(remainingMinutes / (entryCount - index) / 30) * 30
        const durationMinutes = Math.max(30, isLast ? remainingMinutes : share)
        remainingMinutes -= durationMinutes
        const isBillable = random() > 0.14
        const startedAt = atMinutes(day, cursorMinutes)
        const endedAt = atMinutes(day, cursorMinutes + durationMinutes)
        // A short break before the next block, so a day reads like a day.
        cursorMinutes += durationMinutes + 15 + Math.floor(random() * 3) * 15

        const entry = em.create(StaffTimeEntry, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          staffMemberId: memberId,
          date: day,
          durationMinutes,
          startedAt,
          endedAt,
          notes: isBillable ? pick(random, ENTRY_NOTES) : pick(random, NONBILLABLE_NOTES),
          timeProjectId: context.project.id,
          taskId: task?.id ?? null,
          customerId: context.project.customerId ?? null,
          dealId: null,
          orderId: null,
          isBillable,
          roundedMinutes: roundMinutes(durationMinutes, DEFAULT_ROUNDING_SETTINGS),
          rateOverrideAmount: null,
          rateCurrencyCode: context.project.currencyCode ?? null,
          lockedReportId: null,
          lockedAt: null,
          source: random() < 0.25 ? 'timer' : 'manual',
          createdAt: endedAt,
          updatedAt: endedAt,
          deletedAt: null,
        })
        em.persist(entry)

        const bucket = entriesByProjectId.get(context.project.id) ?? []
        bucket.push(entry)
        entriesByProjectId.set(context.project.id, bucket)

        if (random() < 0.35) {
          const tag = pick(random, DEMO_TAGS)
          const tagRow = tagBySlug.get(tag.slug)
          if (tagRow) {
            await em.flush()
            em.persist(
              em.create(StaffTimeEntryTag, {
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                tagId: tagRow.id,
                timeEntryId: entry.id,
                createdAt: endedAt,
              }),
            )
          }
        }
      }
    }
    await em.flush()
  }
  await em.flush()

  await seedDemoReports({ em, scope, contexts, entriesByProjectId, actorUserId, today, now })

  return true
}

type ReportSeedArgs = {
  em: EntityManager
  scope: StaffTimeTrackingSeedScope
  contexts: {
    seed: ProjectSeed
    project: StaffTimeProject
  }[]
  entriesByProjectId: Map<string, StaffTimeEntry[]>
  actorUserId: string | null
  today: Date
  now: Date
}

/**
 * Two reports: last month closed, this month still a draft.
 *
 * The closed one is written frozen — the same per-entry values
 * `staff.timesheets.reports.close` would have computed — and locks the entries it
 * covers. That is the state worth demoing: a report list with a locked period in
 * it shows why the lock exists, and the entries it froze render read-only in the
 * week grid without anybody having to close a report first.
 */
async function seedDemoReports(args: ReportSeedArgs): Promise<void> {
  const { em, scope, contexts, entriesByProjectId, actorUserId, today, now } = args

  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const previousMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  const previousMonthEnd = addDays(monthStart, -1)

  const existingReferences = await em.find(
    StaffTimeReport,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
    { fields: ['reference'] },
  )
  const year = today.getUTCFullYear()
  let sequence = highestReportSequenceNumber(
    existingReferences.map((report) => report.reference),
    year,
  )

  const byCustomer = new Map<string, typeof contexts>()
  for (const context of contexts) {
    const customerId = context.project.customerId
    if (!customerId) continue
    const bucket = byCustomer.get(customerId) ?? []
    bucket.push(context)
    byCustomer.set(customerId, bucket)
  }
  if (byCustomer.size === 0) return

  const customerGroups = [...byCustomer.entries()]

  const createReport = async (
    group: (typeof customerGroups)[number],
    options: {
      title: string
      periodFrom: Date
      periodTo: Date
      close: boolean
    },
  ): Promise<void> => {
    const [customerId, groupContexts] = group
    const first = groupContexts[0]
    sequence += 1
    const { reference } = allocateReportReference(year, sequence - 1)
    const currencyCode = first.project.currencyCode ?? 'USD'

    const report = em.create(StaffTimeReport, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customerId,
      customerSnapshot: first.project.customerSnapshot ?? null,
      reference,
      title: options.title,
      periodKind: 'month',
      periodFrom: options.periodFrom,
      periodTo: options.periodTo,
      currencyCode,
      grouping: 'project_task',
      nonbillableMode: 'separate',
      includeAlreadyReported: false,
      showRates: true,
      roundingUnitMinutes: DEFAULT_ROUNDING_SETTINGS.unitMinutes,
      roundingDirection: DEFAULT_ROUNDING_SETTINGS.direction,
      status: 'draft',
      totalBillableMinutes: null,
      totalNonbillableMinutes: null,
      totalAmount: null,
      closedAt: null,
      closedByUserId: null,
      createdByUserId: actorUserId,
      createdAt: options.periodTo,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(report)
    await em.flush()

    for (const context of groupContexts) {
      em.persist(
        em.create(StaffTimeReportProject, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reportId: report.id,
          timeProjectId: context.project.id,
          createdAt: now,
        }),
      )
    }
    await em.flush()

    if (!options.close) return

    const included = groupContexts.flatMap((context) => {
      const rate = Number(context.project.hourlyRate ?? 0)
      return (entriesByProjectId.get(context.project.id) ?? [])
        .filter((entry) => entry.date >= options.periodFrom && entry.date <= options.periodTo)
        .map((entry) => ({ entry, rate }))
    })
    if (included.length === 0) return

    const closedAt = addDays(options.periodTo, 2)
    const amounts: (number | null)[] = []
    let billableMinutes = 0
    let nonbillableMinutes = 0

    for (const { entry, rate } of included) {
      const minutes = entry.roundedMinutes ?? entry.durationMinutes
      const amount = entryAmount(
        { isBillable: entry.isBillable, roundedMinutes: minutes, rateOverrideAmount: null },
        { hourlyRate: rate },
      )
      amounts.push(amount)
      if (entry.isBillable) billableMinutes += minutes
      else nonbillableMinutes += minutes

      em.persist(
        em.create(StaffTimeReportEntry, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reportId: report.id,
          timeEntryId: entry.id,
          frozenRawMinutes: entry.durationMinutes,
          frozenRoundedMinutes: minutes,
          frozenRateAmount: entry.isBillable ? String(round2(rate)) : null,
          frozenCurrencyCode: currencyCode,
          frozenAmount: amount === null ? null : amount.toFixed(2),
          frozenIsBillable: entry.isBillable,
          createdAt: closedAt,
        }),
      )

      entry.lockedReportId = report.id
      entry.lockedAt = closedAt
      entry.updatedAt = closedAt
    }

    const totalAmount = sumAmounts(amounts)
    report.status = 'closed'
    report.closedAt = closedAt
    report.closedByUserId = actorUserId
    report.totalBillableMinutes = billableMinutes
    report.totalNonbillableMinutes = nonbillableMinutes
    report.totalAmount = totalAmount.toFixed(2)
    report.updatedAt = closedAt

    em.persist(
      em.create(StaffTimeReportEvent, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        reportId: report.id,
        eventType: 'closed',
        reason: null,
        actorUserId,
        metadata: {
          frozenEntryCount: included.length,
          lockedEntryCount: included.length,
          totalAmount,
          currencyCode,
          roundingUnitMinutes: DEFAULT_ROUNDING_SETTINGS.unitMinutes,
          roundingDirection: DEFAULT_ROUNDING_SETTINGS.direction,
        },
        createdAt: closedAt,
      }),
    )
    await em.flush()
  }

  const monthLabel = (date: Date) =>
    `${date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${date.getUTCFullYear()}`

  await createReport(customerGroups[0], {
    title: `${monthLabel(previousMonthStart)} — time and materials`,
    periodFrom: previousMonthStart,
    periodTo: previousMonthEnd,
    close: true,
  })

  const draftGroup = customerGroups[1] ?? customerGroups[0]
  await createReport(draftGroup, {
    title: `${monthLabel(monthStart)} — work in progress`,
    periodFrom: monthStart,
    periodTo: today,
    close: false,
  })
}
