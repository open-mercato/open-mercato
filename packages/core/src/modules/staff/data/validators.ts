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

export const staffTeamMemberTagAssignmentSchema = z.object({
  ...scopedCreateFields,
  memberId: z.string().uuid(),
  tag: z.string().min(1),
})

export type StaffTeamCreateInput = z.infer<typeof staffTeamCreateSchema>
export type StaffTeamUpdateInput = z.infer<typeof staffTeamUpdateSchema>
export type StaffTeamRoleCreateInput = z.infer<typeof staffTeamRoleCreateSchema>
export type StaffTeamRoleUpdateInput = z.infer<typeof staffTeamRoleUpdateSchema>
export type StaffTeamMemberCreateInput = z.infer<typeof staffTeamMemberCreateSchema>
export type StaffTeamMemberUpdateInput = z.infer<typeof staffTeamMemberUpdateSchema>
export type StaffTeamMemberTagAssignmentInput = z.infer<typeof staffTeamMemberTagAssignmentSchema>
