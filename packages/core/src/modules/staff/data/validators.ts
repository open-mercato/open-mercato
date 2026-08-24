import { z } from 'zod'
import { PROJECT_COLOR_KEYS } from '../lib/timesheets-ui/colors'
import { hasTimeEntrySource, timeEntrySourceIds } from '../lib/time-tracking/timeEntrySources'
import { hasReportGrouping, reportGroupingIds } from '../lib/timesheets-reports/reportGroupings'

const projectColorSchema = z
  .string()
  .refine(
    (value) => (PROJECT_COLOR_KEYS as readonly string[]).includes(value),
    { message: 'Invalid project color key.' },
  )

const tagsSchema = z.array(z.string().min(1)).optional().default([])

export const optimisticUpdatedAtSchema = z.string().refine(
  (value) => !Number.isNaN(new Date(value).getTime()),
  { message: 'Invalid datetime' },
)

const scopedCreateFields = {
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
}

const scopedUpdateFields = {
  id: z.string().uuid(),
}

export const staffTeamCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const staffTeamUpdateSchema = z.object({
  ...scopedUpdateFields,
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const staffTeamRoleCreateSchema = z.object({
  ...scopedCreateFields,
  teamId: z.string().uuid().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
})

export const staffTeamRoleUpdateSchema = z.object({
  ...scopedUpdateFields,
  teamId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
})

export const staffTeamMemberCreateSchema = z.object({
  ...scopedCreateFields,
  teamId: z.string().uuid().optional().nullable(),
  displayName: z.string().min(1),
  description: z.string().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  roleIds: z.array(z.string().uuid()).optional().default([]),
  tags: tagsSchema,
  availabilityRuleSetId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const staffTeamMemberUpdateSchema = z.object({
  ...scopedUpdateFields,
  teamId: z.string().uuid().optional().nullable(),
  displayName: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  roleIds: z.array(z.string().uuid()).optional(),
  tags: z.array(z.string().min(1)).optional(),
  availabilityRuleSetId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const staffTeamMemberActivityCreateSchema = z.object({
  ...scopedCreateFields,
  entityId: z.string().uuid(),
  activityType: z.string().min(1).max(100),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
  occurredAt: z.coerce.date().optional(),
  authorUserId: z.string().uuid().optional(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
})

export const staffTeamMemberActivityUpdateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .merge(staffTeamMemberActivityCreateSchema.partial())

export const staffTeamMemberJobHistoryCreateSchema = z.object({
  ...scopedCreateFields,
  entityId: z.string().uuid(),
  name: z.string().min(1).max(200),
  companyName: z.string().max(200).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
})

export const staffTeamMemberJobHistoryUpdateSchema = z
  .object({
    id: z.string().uuid(),
    updatedAt: optimisticUpdatedAtSchema.optional(),
  })
  .merge(staffTeamMemberJobHistoryCreateSchema.partial())

export const staffTeamMemberCommentCreateSchema = z.object({
  ...scopedCreateFields,
  entityId: z.string().uuid(),
  body: z.string().min(1).max(8000),
  authorUserId: z.string().uuid().optional(),
  appearanceIcon: z.string().trim().max(100).optional().nullable(),
  appearanceColor: z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{6})$/)
    .optional()
    .nullable(),
})

export const staffTeamMemberCommentUpdateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .merge(staffTeamMemberCommentCreateSchema.partial())

export const staffTeamMemberAddressCreateSchema = z.object({
  ...scopedCreateFields,
  entityId: z.string().uuid(),
  name: z.string().max(150).optional(),
  purpose: z.string().max(150).optional(),
  companyName: z.string().max(200).optional(),
  addressLine1: z.string().min(1).max(300),
  addressLine2: z.string().max(300).optional(),
  buildingNumber: z.string().max(50).optional(),
  flatNumber: z.string().max(50).optional(),
  city: z.string().max(150).optional(),
  region: z.string().max(150).optional(),
  postalCode: z.string().max(30).optional(),
  country: z.string().max(150).optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  isPrimary: z.boolean().optional(),
})

export const staffTeamMemberAddressUpdateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .merge(staffTeamMemberAddressCreateSchema.partial())

export const staffTeamMemberTagAssignmentSchema = z.object({
  ...scopedCreateFields,
  memberId: z.string().uuid(),
  tag: z.string().min(1),
})

const staffLeaveRequestStatusSchema = z.enum(['pending', 'approved', 'rejected'])

const validateStaffLeaveRequestDateRange = (
  value: { startDate?: Date; endDate?: Date },
  ctx: z.RefinementCtx,
) => {
  if (!value.startDate || !value.endDate) return
  if (value.endDate < value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'End date must be after start date.',
      path: ['endDate'],
    })
  }
}

export const staffLeaveRequestCreateSchema = z
  .object({
    ...scopedCreateFields,
    memberId: z.string().uuid(),
    timezone: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    unavailabilityReasonEntryId: z.string().uuid().optional().nullable(),
    unavailabilityReasonValue: z.string().trim().min(1).max(150).optional().nullable(),
    note: z.string().max(2000).optional().nullable(),
    submittedByUserId: z.string().uuid().optional().nullable(),
  })
  .superRefine(validateStaffLeaveRequestDateRange)

export const staffLeaveRequestUpdateSchema = z
  .object({
    ...scopedUpdateFields,
    timezone: z.string().min(1).optional(),
    memberId: z.string().uuid().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    unavailabilityReasonEntryId: z.string().uuid().optional().nullable(),
    unavailabilityReasonValue: z.string().trim().min(1).max(150).optional().nullable(),
    note: z.string().max(2000).optional().nullable(),
  })
  .superRefine(validateStaffLeaveRequestDateRange)

export const staffLeaveRequestDecisionSchema = z.object({
  id: z.string().uuid(),
  decisionComment: z.string().max(2000).optional().nullable(),
  decidedByUserId: z.string().uuid().optional().nullable(),
})

export const staffTeamMemberSelfCreateSchema = z.object({
  ...scopedCreateFields,
  displayName: z.string().min(1),
  description: z.string().max(2000).optional().nullable(),
})

export type StaffTeamCreateInput = z.infer<typeof staffTeamCreateSchema>
export type StaffTeamUpdateInput = z.infer<typeof staffTeamUpdateSchema>
export type StaffTeamRoleCreateInput = z.infer<typeof staffTeamRoleCreateSchema>
export type StaffTeamRoleUpdateInput = z.infer<typeof staffTeamRoleUpdateSchema>
export type StaffTeamMemberCreateInput = z.infer<typeof staffTeamMemberCreateSchema>
export type StaffTeamMemberUpdateInput = z.infer<typeof staffTeamMemberUpdateSchema>
export type StaffTeamMemberTagAssignmentInput = z.infer<typeof staffTeamMemberTagAssignmentSchema>
export type StaffTeamMemberActivityCreateInput = z.infer<typeof staffTeamMemberActivityCreateSchema>
export type StaffTeamMemberActivityUpdateInput = z.infer<typeof staffTeamMemberActivityUpdateSchema>
export type StaffTeamMemberJobHistoryCreateInput = z.infer<typeof staffTeamMemberJobHistoryCreateSchema>
export type StaffTeamMemberJobHistoryUpdateInput = z.infer<typeof staffTeamMemberJobHistoryUpdateSchema>
export type StaffTeamMemberCommentCreateInput = z.infer<typeof staffTeamMemberCommentCreateSchema>
export type StaffTeamMemberCommentUpdateInput = z.infer<typeof staffTeamMemberCommentUpdateSchema>
export type StaffTeamMemberAddressCreateInput = z.infer<typeof staffTeamMemberAddressCreateSchema>
export type StaffTeamMemberAddressUpdateInput = z.infer<typeof staffTeamMemberAddressUpdateSchema>
export type StaffLeaveRequestStatus = z.infer<typeof staffLeaveRequestStatusSchema>
export type StaffLeaveRequestCreateInput = z.infer<typeof staffLeaveRequestCreateSchema>
export type StaffLeaveRequestUpdateInput = z.infer<typeof staffLeaveRequestUpdateSchema>
export type StaffLeaveRequestDecisionInput = z.infer<typeof staffLeaveRequestDecisionSchema>
export type StaffTeamMemberSelfCreateInput = z.infer<typeof staffTeamMemberSelfCreateSchema>

// --- Timesheets validators (Phase 1) ---

/**
 * EP-37: validated against the time-entry source registry rather than a literal
 * enum, so a contributed source is accepted on write the moment its module is
 * enabled. `superRefine` rather than `z.enum(...)` because the accepted set is
 * only known at call time.
 */
const timeEntrySourceSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (hasTimeEntrySource(value)) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `[internal] unknown time entry source: ${value}`,
      params: { accepted: timeEntrySourceIds() },
    })
  })
const timeProjectStatusSchema = z.enum(['active', 'on_hold', 'completed'])
const timeProjectMemberStatusSchema = z.enum(['active', 'inactive'])
const timeEntrySegmentTypeSchema = z.enum(['work', 'break'])
const projectCodeSchema = z.string().min(1).max(50).regex(/^[a-zA-Z0-9-]+$/)
const moneyAmountSchema = z.number().min(0).max(99_999_999)
const timeProjectBudgetKindSchema = z.enum(['none', 'hours', 'amount'])

// Upper-cased at the boundary so every writer stores canonical ISO 4217. The report
// single-currency assertion compares codes case-sensitively, so `pln` and `PLN` would
// otherwise read as two currencies and wrongly block a customer report.
const currencyCodeSchema = z.string().trim().length(3).transform((value) => value.toUpperCase())

// numeric(14,4): ten integer digits, four decimals, never negative.
const numericAmountPattern = /^\d{1,10}(?:\.\d{1,4})?$/

/**
 * `numeric(14,4)` columns are surfaced by MikroORM as strings, and the project
 * form posts a typed decimal string, so the canonical representation for a stored
 * amount is a STRING end to end — a JSON number would push a 14-significant-digit
 * amount through a float on the way in. Plain numbers stay accepted for API
 * callers and are normalized to the same decimal string. (Entry-level money keeps
 * `moneyAmountSchema` above: `rate_override_amount` is consumed by the cost
 * calculator as a number, not written straight onto a numeric column.)
 */
const numericAmountSchema = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const raw = typeof value === 'number' ? String(value) : value.trim().replace(',', '.')
    if (raw.length === 0) return null
    if (!numericAmountPattern.test(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected a non-negative amount with at most 10 digits and 4 decimals.',
      })
      return z.NEVER
    }
    return raw
  })

export const staffTimeEntryCreateSchema = z.object({
  ...scopedCreateFields,
  staffMemberId: z.string().uuid(),
  date: z.coerce.date(),
  durationMinutes: z.number().int().min(0).max(1440),
  startedAt: z.coerce.date().optional().nullable(),
  endedAt: z.coerce.date().optional().nullable(),
  timeProjectId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  source: timeEntrySourceSchema.optional().default('manual'),
  taskId: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  isBillable: z.boolean().optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
  rateOverrideAmount: moneyAmountSchema.optional().nullable(),
})

/**
 * `startedAt` / `endedAt` mirror the create schema key for key: without them zod
 * strips the two clocks the entry form sends on every save, so correcting a start
 * or an end reported success and changed nothing. Nullable because clearing a
 * clock is a real edit, optional because omitting one must leave it alone — the
 * update command reads `undefined` as "not part of this write" and `null` as
 * "clear it". US-D3 keeps the three time fields consistent in the command, not
 * here: a request may legitimately carry all three and let the clocks win.
 */
export const staffTimeEntryUpdateSchema = z.object({
  ...scopedUpdateFields,
  date: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(0).max(1440).optional(),
  startedAt: z.coerce.date().optional().nullable(),
  endedAt: z.coerce.date().optional().nullable(),
  timeProjectId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  taskId: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  isBillable: z.boolean().optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
  rateOverrideAmount: moneyAmountSchema.optional().nullable(),
})

/**
 * `taskId` is what makes starting a timer from a board card or the task drawer a
 * single write. Without it the surface has to start a project-level timer and
 * then PATCH the task onto it, and a failure between the two leaves a running
 * timer filed against the wrong thing.
 */
export const staffTimeEntryStartTimerSchema = z.object({
  ...scopedCreateFields,
  staffMemberId: z.string().uuid(),
  date: z.coerce.date(),
  timeProjectId: z.string().uuid().optional().nullable(),
  taskId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

export const staffTimeEntryBulkItemSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  date: z.coerce.date(),
  // Optional only because a task carries its project: a row naming a `taskId`
  // inherits the project from it, exactly as the single-entry path does. The
  // route refuses a row that names neither with `staff.timesheets.errors.projectRequired`,
  // so every stored row still lands on a project — the (project, date) cell the
  // lock gate addresses is never blank.
  timeProjectId: z.string().uuid().optional().nullable(),
  durationMinutes: z.number().int().min(0).max(1440),
  notes: z.string().max(2000).optional().nullable(),
  taskId: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  isBillable: z.boolean().optional(),
  // Accepted by the schema and REFUSED by the route with 422: assigning tags
  // means dispatching the tag commands, which fork their own EntityManager and
  // cannot participate in this route's per-row transaction. Kept in the schema
  // so the refusal is explicit — dropping the key would let zod strip it and
  // restore the silent no-op.
  tagIds: z.array(z.string().uuid()).max(50).optional(),
  rateOverrideAmount: moneyAmountSchema.optional().nullable(),
})

export const staffTimeEntryBulkSaveSchema = z.object({
  entries: z.array(staffTimeEntryBulkItemSchema).min(1).max(200),
})

export const staffTimeEntrySegmentCreateSchema = z.object({
  ...scopedCreateFields,
  timeEntryId: z.string().uuid(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional().nullable(),
  segmentType: timeEntrySegmentTypeSchema.optional().default('work'),
})

export const staffTimeEntrySegmentUpdateSchema = z.object({
  ...scopedUpdateFields,
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().optional().nullable(),
  segmentType: timeEntrySegmentTypeSchema.optional(),
})

export const staffTimeProjectCreateSchema = z.object({
  ...scopedCreateFields,
  name: z.string().min(1).max(255),
  // D-9 / US-B1: time is organised per customer, so a new project always names one.
  // Rows created before this change keep their null customer and stay editable
  // (see the update schema below), which is why only create is constrained.
  customerId: z.string().uuid(),
  customerSnapshot: z.record(z.string(), z.unknown()).optional().nullable(),
  code: projectCodeSchema,
  description: z.string().max(2000).optional().nullable(),
  projectType: z.string().max(100).optional().nullable(),
  color: projectColorSchema.optional().nullable(),
  status: timeProjectStatusSchema.optional().default('active'),
  ownerUserId: z.string().uuid().optional().nullable(),
  costCenter: z.string().max(100).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  hourlyRate: numericAmountSchema.optional().nullable(),
  // D-3: the currency may be chosen once, at creation. Every later change goes
  // through `POST .../change-currency`, which carries the non-conversion
  // acknowledgement and refuses while entries sit frozen in a closed report.
  currencyCode: currencyCodeSchema.optional().nullable(),
  billableByDefault: z.boolean().optional(),
  budgetKind: timeProjectBudgetKindSchema.optional().default('none'),
  budgetValue: numericAmountSchema.optional().nullable(),
  budgetWarnAtPercent: z.number().int().min(1).max(100).optional(),
})

/**
 * Deliberately has NO `currencyCode`: D-3 routes every post-creation currency
 * change through the dedicated change-currency action, so a plain PUT that
 * carries the key has it stripped here rather than relabelling the project
 * behind the acknowledgement and the locked-entry check.
 */
export const staffTimeProjectUpdateSchema = z.object({
  ...scopedUpdateFields,
  name: z.string().min(1).max(255).optional(),
  customerId: z.string().uuid().optional().nullable(),
  customerSnapshot: z.record(z.string(), z.unknown()).optional().nullable(),
  code: projectCodeSchema.optional(),
  description: z.string().max(2000).optional().nullable(),
  projectType: z.string().max(100).optional().nullable(),
  color: projectColorSchema.optional().nullable(),
  status: timeProjectStatusSchema.optional(),
  ownerUserId: z.string().uuid().optional().nullable(),
  costCenter: z.string().max(100).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  hourlyRate: numericAmountSchema.optional().nullable(),
  billableByDefault: z.boolean().optional(),
  budgetKind: timeProjectBudgetKindSchema.optional(),
  budgetValue: numericAmountSchema.optional().nullable(),
  budgetWarnAtPercent: z.number().int().min(1).max(100).optional(),
})

export const staffTimeProjectMemberAssignSchema = z.object({
  ...scopedCreateFields,
  timeProjectId: z.string().uuid(),
  staffMemberId: z.string().uuid(),
  role: z.string().max(100).optional().nullable(),
  status: timeProjectMemberStatusSchema.optional().default('active'),
  assignedStartDate: z.coerce.date(),
  assignedEndDate: z.coerce.date().optional().nullable(),
})

export const staffTimeProjectMemberUpdateSchema = z.object({
  ...scopedUpdateFields,
  role: z.string().max(100).optional().nullable(),
  status: timeProjectMemberStatusSchema.optional(),
  assignedEndDate: z.coerce.date().optional().nullable(),
})

export const staffMyProjectVisibilityUpdateSchema = z.object({
  showInGrid: z.boolean(),
})

export type StaffTimeEntryCreateInput = z.infer<typeof staffTimeEntryCreateSchema>
export type StaffTimeEntryUpdateInput = z.infer<typeof staffTimeEntryUpdateSchema>
export type StaffTimeEntryStartTimerInput = z.infer<typeof staffTimeEntryStartTimerSchema>
export type StaffTimeEntryBulkSaveInput = z.infer<typeof staffTimeEntryBulkSaveSchema>
export type StaffTimeEntrySegmentCreateInput = z.infer<typeof staffTimeEntrySegmentCreateSchema>
export type StaffTimeEntrySegmentUpdateInput = z.infer<typeof staffTimeEntrySegmentUpdateSchema>
export type StaffTimeProjectCreateInput = z.infer<typeof staffTimeProjectCreateSchema>
export type StaffTimeProjectUpdateInput = z.infer<typeof staffTimeProjectUpdateSchema>
export type StaffTimeProjectMemberAssignInput = z.infer<typeof staffTimeProjectMemberAssignSchema>
export type StaffTimeProjectMemberUpdateInput = z.infer<typeof staffTimeProjectMemberUpdateSchema>
export type StaffMyProjectVisibilityUpdateInput = z.infer<typeof staffMyProjectVisibilityUpdateSchema>

// --- Time tracking consulting suite validators (tasks, tags, reports, settings) ---

const timeSlugSchema = z.string().trim().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const timeReportPeriodKindSchema = z.enum(['week', 'month', 'year', 'custom'])
/** EP-36: validated against the report grouping registry, not a literal enum. */
const timeReportGroupingSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (hasReportGrouping(value)) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `[internal] unknown report grouping: ${value}`,
      params: { accepted: reportGroupingIds() },
    })
  })
const timeReportNonbillableModeSchema = z.enum(['separate', 'exclude'])
const timeRoundingDirectionSchema = z.enum(['up', 'nearest'])
const timeRoundingUnitMinutesSchema = z.union([
  z.literal(0),
  z.literal(5),
  z.literal(10),
  z.literal(15),
])
const positionSchema = z.number().int().min(0).max(1_000_000)

export const staffTimeTaskStatusCreateSchema = z.object({
  ...scopedCreateFields,
  timeProjectId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  slug: timeSlugSchema.optional(),
  color: projectColorSchema.optional().nullable(),
  position: positionSchema.optional(),
  isDefault: z.boolean().optional(),
  isDone: z.boolean().optional(),
})

export const staffTimeTaskStatusUpdateSchema = z.object({
  ...scopedUpdateFields,
  name: z.string().trim().min(1).max(100).optional(),
  color: projectColorSchema.optional().nullable(),
  position: positionSchema.optional(),
  isDefault: z.boolean().optional(),
  isDone: z.boolean().optional(),
})

export const staffTimeTaskStatusReorderSchema = z.object({
  statuses: z
    .array(
      z.object({
        id: z.string().uuid(),
        position: positionSchema,
      }),
    )
    .min(1)
    .max(100),
})

export const staffTimeTaskCreateSchema = z.object({
  ...scopedCreateFields,
  timeProjectId: z.string().uuid(),
  parentTaskId: z.string().uuid().optional().nullable(),
  taskStatusId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(255),
  description: z.string().max(8000).optional().nullable(),
  assigneeStaffMemberId: z.string().uuid().optional().nullable(),
  position: positionSchema.optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
})

export const staffTimeTaskUpdateSchema = z.object({
  ...scopedUpdateFields,
  parentTaskId: z.string().uuid().optional().nullable(),
  taskStatusId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(8000).optional().nullable(),
  assigneeStaffMemberId: z.string().uuid().optional().nullable(),
  position: positionSchema.optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
})

export const staffTimeTaskStatusChangeSchema = z.object({
  taskStatusId: z.string().uuid(),
  position: positionSchema.optional(),
})

export const staffTimeTaskCommentCreateSchema = z.object({
  ...scopedCreateFields,
  taskId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
  authorUserId: z.string().uuid().optional().nullable(),
})

export const staffTimeTaskCommentUpdateSchema = z.object({
  ...scopedUpdateFields,
  body: z.string().trim().min(1).max(5000),
})

export const staffTimeTagCreateSchema = z.object({
  ...scopedCreateFields,
  slug: timeSlugSchema,
  label: z.string().trim().min(1).max(100),
  color: projectColorSchema.optional().nullable(),
})

export const staffTimeTaskTagAssignmentSchema = z.object({
  ...scopedCreateFields,
  taskId: z.string().uuid(),
  tagIds: z.array(z.string().uuid()).max(50),
})

export const staffTimeEntryTagAssignmentSchema = z.object({
  ...scopedCreateFields,
  timeEntryId: z.string().uuid(),
  tagIds: z.array(z.string().uuid()).max(50),
})

const validateStaffTimeReportPeriod = (
  value: { periodFrom?: Date; periodTo?: Date },
  ctx: z.RefinementCtx,
) => {
  if (!value.periodFrom || !value.periodTo) return
  if (value.periodTo < value.periodFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Period end must be after period start.',
      path: ['periodTo'],
    })
  }
}

export const staffTimeReportCreateSchema = z
  .object({
    ...scopedCreateFields,
    customerId: z.string().uuid(),
    title: z.string().trim().min(1).max(255),
    periodKind: timeReportPeriodKindSchema,
    periodFrom: z.coerce.date(),
    periodTo: z.coerce.date(),
    grouping: timeReportGroupingSchema.optional().default('project_task'),
    nonbillableMode: timeReportNonbillableModeSchema.optional().default('separate'),
    includeAlreadyReported: z.boolean().optional().default(false),
    showRates: z.boolean().optional().default(true),
    timeProjectIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .superRefine(validateStaffTimeReportPeriod)

export const staffTimeReportUpdateSchema = z
  .object({
    ...scopedUpdateFields,
    customerId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(255).optional(),
    periodKind: timeReportPeriodKindSchema.optional(),
    periodFrom: z.coerce.date().optional(),
    periodTo: z.coerce.date().optional(),
    grouping: timeReportGroupingSchema.optional(),
    nonbillableMode: timeReportNonbillableModeSchema.optional(),
    includeAlreadyReported: z.boolean().optional(),
    showRates: z.boolean().optional(),
    timeProjectIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  })
  .superRefine(validateStaffTimeReportPeriod)

export const staffTimeReportPreviewSchema = z
  .object({
    customerId: z.string().uuid().optional().nullable(),
    periodKind: timeReportPeriodKindSchema.optional().default('custom'),
    periodFrom: z.coerce.date(),
    periodTo: z.coerce.date(),
    grouping: timeReportGroupingSchema.optional().default('project_task'),
    nonbillableMode: timeReportNonbillableModeSchema.optional().default('separate'),
    includeAlreadyReported: z.boolean().optional().default(false),
    showRates: z.boolean().optional().default(true),
    timeProjectIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .superRefine(validateStaffTimeReportPeriod)

export const staffTimeReportCloseSchema = z.object({
  id: z.string().uuid(),
})

export const staffTimeReportUnlockSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
})

export const staffTimeProjectChangeCurrencySchema = z.object({
  currencyCode: currencyCodeSchema,
  acknowledged: z.literal(true),
})

export const staffTimeTrackingSettingsSchema = z.object({
  rounding: z
    .object({
      unitMinutes: timeRoundingUnitMinutesSchema.optional().default(0),
      direction: timeRoundingDirectionSchema.optional().default('up'),
    })
    .optional()
    .default({ unitMinutes: 0, direction: 'up' }),
  defaults: z
    .object({
      billable: z.boolean().optional().default(true),
      chainStartFromPreviousEnd: z.boolean().optional().default(true),
    })
    .optional()
    .default({ billable: true, chainStartFromPreviousEnd: true }),
  targets: z
    .object({
      dailyHours: z.number().min(0).max(24).nullable().optional().default(8),
    })
    .optional()
    .default({ dailyHours: 8 }),
  warnings: z
    .object({
      overlap: z.boolean().optional().default(true),
      runningTimer: z.boolean().optional().default(true),
    })
    .optional()
    .default({ overlap: true, runningTimer: true }),
  access: z
    .object({
      assignmentGraceDays: z.number().int().min(0).max(365).optional().default(14),
    })
    .optional()
    .default({ assignmentGraceDays: 14 }),
})

export type StaffTimeReportPeriodKind = z.infer<typeof timeReportPeriodKindSchema>
export type StaffTimeReportGrouping = z.infer<typeof timeReportGroupingSchema>
export type StaffTimeReportNonbillableMode = z.infer<typeof timeReportNonbillableModeSchema>
export type StaffTimeRoundingDirection = z.infer<typeof timeRoundingDirectionSchema>
export type StaffTimeRoundingUnitMinutes = z.infer<typeof timeRoundingUnitMinutesSchema>
export type StaffTimeTaskStatusCreateInput = z.infer<typeof staffTimeTaskStatusCreateSchema>
export type StaffTimeTaskStatusUpdateInput = z.infer<typeof staffTimeTaskStatusUpdateSchema>
export type StaffTimeTaskStatusReorderInput = z.infer<typeof staffTimeTaskStatusReorderSchema>
export type StaffTimeTaskCreateInput = z.infer<typeof staffTimeTaskCreateSchema>
export type StaffTimeTaskUpdateInput = z.infer<typeof staffTimeTaskUpdateSchema>
export type StaffTimeTaskStatusChangeInput = z.infer<typeof staffTimeTaskStatusChangeSchema>
export type StaffTimeTaskCommentCreateInput = z.infer<typeof staffTimeTaskCommentCreateSchema>
export type StaffTimeTaskCommentUpdateInput = z.infer<typeof staffTimeTaskCommentUpdateSchema>
export type StaffTimeTagCreateInput = z.infer<typeof staffTimeTagCreateSchema>
export type StaffTimeTaskTagAssignmentInput = z.infer<typeof staffTimeTaskTagAssignmentSchema>
export type StaffTimeEntryTagAssignmentInput = z.infer<typeof staffTimeEntryTagAssignmentSchema>
export type StaffTimeReportCreateInput = z.infer<typeof staffTimeReportCreateSchema>
export type StaffTimeReportUpdateInput = z.infer<typeof staffTimeReportUpdateSchema>
export type StaffTimeReportPreviewInput = z.infer<typeof staffTimeReportPreviewSchema>
export type StaffTimeReportCloseInput = z.infer<typeof staffTimeReportCloseSchema>
export type StaffTimeReportUnlockInput = z.infer<typeof staffTimeReportUnlockSchema>
export type StaffTimeProjectChangeCurrencyInput = z.infer<typeof staffTimeProjectChangeCurrencySchema>
export type StaffTimeTrackingSettingsInput = z.infer<typeof staffTimeTrackingSettingsSchema>
