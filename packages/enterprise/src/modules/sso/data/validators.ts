import { z } from 'zod'
import { validateDomain } from '../lib/domains'

const uuid = () => z.string().uuid()

const domainString = () =>
  z.string().trim().min(1).max(253).refine(
    (val) => validateDomain(val).valid,
    { message: 'Invalid domain format — only valid DNS hostnames with at least one dot are accepted' },
  )

// --- SSO Config schema (for internal use / seeding) ---

export const ssoConfigCreateSchema = z.object({
  organizationId: uuid(),
  tenantId: uuid().optional(),
  protocol: z.enum(['oidc', 'saml']),
  issuer: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  allowedDomains: z.array(domainString()).default([]),
  jitEnabled: z.boolean().default(true),
  autoLinkByEmail: z.boolean().default(true),
  isActive: z.boolean().default(false),
  ssoRequired: z.boolean().default(false),
  appRoleMappings: z.record(z.string().min(1).max(255), z.string().min(1).max(255)).default({}),
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
  returnUrl: z.string().max(2048).refine(
    (val) => val.startsWith('/') && !val.startsWith('//'),
    { message: 'returnUrl must be a relative path starting with / and must not start with //' },
  ).optional(),
})

export const oidcCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

// --- Admin API schemas ---

export const ssoConfigAdminCreateSchema = z.object({
  name: z.string().min(1).max(255),
  organizationId: uuid().optional(),
  tenantId: uuid().optional(),
  protocol: z.enum(['oidc', 'saml']),
  issuer: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  allowedDomains: z.array(domainString()).default([]),
  jitEnabled: z.boolean().default(true),
  autoLinkByEmail: z.boolean().default(true),
  appRoleMappings: z.record(z.string().min(1).max(255), z.string().min(1).max(255)).default({}),
})

export const ssoConfigAdminUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  protocol: z.enum(['oidc', 'saml']).optional(),
  issuer: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  jitEnabled: z.boolean().optional(),
  autoLinkByEmail: z.boolean().optional(),
  appRoleMappings: z.record(z.string().min(1).max(255), z.string().min(1).max(255)).optional(),
})

export const ssoConfigListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  organizationId: uuid().optional(),
  tenantId: uuid().optional(),
})

export const ssoDomainAddSchema = z.object({
  domain: domainString(),
})

export const ssoActivateSchema = z.object({
  active: z.boolean(),
})

// --- SCIM User payload schema ---

export const scimUserPayloadSchema = z.object({
  schemas: z.array(z.string()).optional(),
  userName: z.string().min(1).max(255),
  externalId: z.string().max(255).optional(),
  displayName: z.string().max(255).optional(),
  active: z.union([z.boolean(), z.string()]).optional(),
  name: z.object({
    givenName: z.string().max(255).optional(),
    familyName: z.string().max(255).optional(),
    formatted: z.string().max(512).optional(),
  }).optional(),
  emails: z.array(z.object({
    value: z.string().email(),
    primary: z.boolean().optional(),
    type: z.string().optional(),
  })).optional(),
}).passthrough()

// --- SCIM Token schemas ---

export const createScimTokenSchema = z.object({
  ssoConfigId: uuid(),
  name: z.string().min(1).max(100),
})

export const scimTokenListSchema = z.object({
  ssoConfigId: uuid(),
})

// --- Type exports ---

export type SsoConfigCreateInput = z.infer<typeof ssoConfigCreateSchema>
export type SsoConfigUpdateInput = z.infer<typeof ssoConfigUpdateSchema>
export type SsoConfigAdminCreateInput = z.infer<typeof ssoConfigAdminCreateSchema>
export type SsoConfigAdminUpdateInput = z.infer<typeof ssoConfigAdminUpdateSchema>
export type SsoConfigListQuery = z.infer<typeof ssoConfigListQuerySchema>
export type HrdRequestInput = z.infer<typeof hrdRequestSchema>
export type SsoInitiateInput = z.infer<typeof ssoInitiateSchema>
export type OidcCallbackInput = z.infer<typeof oidcCallbackSchema>
export type ScimUserPayloadInput = z.infer<typeof scimUserPayloadSchema>
export type CreateScimTokenInput = z.infer<typeof createScimTokenSchema>
export type ScimTokenListInput = z.infer<typeof scimTokenListSchema>
