import { z } from 'zod'

const emailField = z.string().email().max(255)
const passwordField = z.string().min(8).max(128)
const displayNameField = z.string().min(1).max(255)

export const signupSchema = z.object({
  email: emailField,
  password: passwordField,
  displayName: displayNameField,
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
})

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(128),
  tenantId: z.string().uuid().optional(),
})

export const emailVerifySchema = z.object({
  token: z.string().min(1).max(512),
})

export const passwordResetRequestSchema = z.object({
  email: emailField,
  tenantId: z.string().uuid().optional(),
})

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1).max(512),
  password: passwordField,
})

export const magicLinkRequestSchema = z.object({
  email: emailField,
  tenantId: z.string().uuid().optional(),
})

export const magicLinkVerifySchema = z.object({
  token: z.string().min(1).max(512),
})

export const invitationAcceptSchema = z.object({
  token: z.string().min(1).max(512),
  password: passwordField,
  displayName: displayNameField,
})

export const profileUpdateSchema = z.object({
  displayName: displayNameField.optional(),
})

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordField,
})

export const createRoleSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9_-]+$/),
  description: z.string().max(1000).optional(),
  isDefault: z.boolean().optional(),
  customerAssignable: z.boolean().optional(),
})

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  isDefault: z.boolean().optional(),
  customerAssignable: z.boolean().optional(),
})

export const updateRoleAclSchema = z.object({
  features: z.array(z.string().min(1).max(255)),
  isPortalAdmin: z.boolean().optional(),
})

export const inviteUserSchema = z.object({
  email: emailField,
  customerEntityId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).min(1),
  displayName: displayNameField.optional(),
})

export const assignRolesSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1),
})

export const adminCreateUserSchema = z.object({
  email: emailField,
  password: passwordField,
  displayName: displayNameField,
  roleIds: z.array(z.string().uuid()).optional(),
  customerEntityId: z.string().uuid().optional(),
})

export const adminUpdateUserSchema = z.object({
  displayName: displayNameField.optional(),
  isActive: z.boolean().optional(),
  lockedUntil: z.string().datetime().nullable().optional(),
  personEntityId: z.string().uuid().nullable().optional(),
  customerEntityId: z.string().uuid().nullable().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
})

export const adminResetPasswordSchema = z.object({
  newPassword: passwordField,
})

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type EmailVerifyInput = z.infer<typeof emailVerifySchema>
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>
export type MagicLinkVerifyInput = z.infer<typeof magicLinkVerifySchema>
export type InvitationAcceptInput = z.infer<typeof invitationAcceptSchema>
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>
export type CreateRoleInput = z.infer<typeof createRoleSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>
export type UpdateRoleAclInput = z.infer<typeof updateRoleAclSchema>
export type InviteUserInput = z.infer<typeof inviteUserSchema>
export type AssignRolesInput = z.infer<typeof assignRolesSchema>
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>
