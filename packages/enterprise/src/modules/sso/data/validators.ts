import { z } from 'zod'

const uuid = () => z.string().uuid()

// --- SSO Config schema (for internal use / seeding) ---

export const ssoConfigCreateSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid().optional(),
  protocol: z.enum(['oidc', 'saml']),
  issuer: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).default([]),
  jitEnabled: z.boolean().default(true),
  autoLinkByEmail: z.boolean().default(true),
  isActive: z.boolean().default(false),
  ssoRequired: z.boolean().default(false),
  defaultRoleId: uuid().nullable().optional(),
})

export const ssoConfigUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(ssoConfigCreateSchema.partial().omit({ organizationId: true, tenantId: true }))

// --- API request schemas ---

export const hrdRequestSchema = z.object({
  email: z.string().email(),
})

export const ssoInitiateSchema = z.object({
  configId: uuid(),
  returnUrl: z.string().max(2048).optional(),
})

export const oidcCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

// --- Type exports ---

export type SsoConfigCreateInput = z.infer<typeof ssoConfigCreateSchema>
export type SsoConfigUpdateInput = z.infer<typeof ssoConfigUpdateSchema>
export type HrdRequestInput = z.infer<typeof hrdRequestSchema>
export type SsoInitiateInput = z.infer<typeof ssoInitiateSchema>
export type OidcCallbackInput = z.infer<typeof oidcCallbackSchema>
