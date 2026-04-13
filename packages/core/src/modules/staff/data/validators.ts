import { z } from 'zod'

const tagsSchema = z.array(z.string().min(1)).optional().default([])

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

const timeEntrySourceSchema = z.enum(['manual', 'timer', 'kiosk', 'mobile'])
const timeProjectStatusSchema = z.enum(['active', 'on_hold', 'completed'])
const timeProjectMemberStatusSchema = z.enum(['active', 'inactive'])
const timeEntrySegmentTypeSchema = z.enum(['work', 'break'])
const projectCodeSchema = z.string().min(1).max(50).regex(/^[a-zA-Z0-9-]+$/)

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
})

export const staffTimeEntryUpdateSchema = z.object({
  ...scopedUpdateFields,
  date: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(0).max(1440).optional(),
  timeProjectId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  dealId: z.string().uuid().optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

export const staffTimeEntryBulkItemSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  date: z.coerce.date(),
  timeProjectId: z.string().uuid(),
  durationMinutes: z.number().int().min(0).max(1440),
  notes: z.string().max(2000).optional().nullable(),
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
  customerId: z.string().uuid().optional().nullable(),
  code: projectCodeSchema,
  description: z.string().max(2000).optional().nullable(),
  projectType: z.string().max(100).optional().nullable(),
  status: timeProjectStatusSchema.optional().default('active'),
  ownerUserId: z.string().uuid().optional().nullable(),
  costCenter: z.string().max(100).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
})

export const staffTimeProjectUpdateSchema = z.object({
  ...scopedUpdateFields,
  name: z.string().min(1).max(255).optional(),
  customerId: z.string().uuid().optional().nullable(),
  code: projectCodeSchema.optional(),
  description: z.string().max(2000).optional().nullable(),
  projectType: z.string().max(100).optional().nullable(),
  status: timeProjectStatusSchema.optional(),
  ownerUserId: z.string().uuid().optional().nullable(),
  costCenter: z.string().max(100).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
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
export type StaffTimeEntryBulkSaveInput = z.infer<typeof staffTimeEntryBulkSaveSchema>
export type StaffTimeEntrySegmentCreateInput = z.infer<typeof staffTimeEntrySegmentCreateSchema>
export type StaffTimeEntrySegmentUpdateInput = z.infer<typeof staffTimeEntrySegmentUpdateSchema>
export type StaffTimeProjectCreateInput = z.infer<typeof staffTimeProjectCreateSchema>
export type StaffTimeProjectUpdateInput = z.infer<typeof staffTimeProjectUpdateSchema>
export type StaffTimeProjectMemberAssignInput = z.infer<typeof staffTimeProjectMemberAssignSchema>
export type StaffTimeProjectMemberUpdateInput = z.infer<typeof staffTimeProjectMemberUpdateSchema>
export type StaffMyProjectVisibilityUpdateInput = z.infer<typeof staffMyProjectVisibilityUpdateSchema>
