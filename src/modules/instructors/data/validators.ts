import { z } from 'zod'

const uuid = () => z.string().uuid()

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens')

const specializationValues = [
  'blueprints',
  'niagara',
  'pcg',
  'materials',
  'animation',
  'metahumans',
  'lighting',
  'level_design',
  'cinematics',
  'audio',
  'networking',
  'ai',
  'ui',
  'physics',
  'optimization',
  'general',
] as const

const credentialTypeValues = ['unreal_engine', 'credly', 'other'] as const
const verificationStatusValues = ['pending', 'verified', 'failed', 'expired'] as const

export const instructorCreateSchema = z.object({
  userId: uuid(),
  displayName: z.string().trim().min(1).max(200),
  slug: slugSchema,
  bio: z.string().trim().max(10000).optional(),
  headline: z.string().trim().max(300).optional(),
  avatarUrl: z.string().trim().url().max(2000).optional(),
  specializations: z.array(z.string().trim().max(100)).max(20).optional(),
  experienceYears: z.coerce.number().int().min(0).max(50).optional(),
  hourlyRate: z.string().trim().max(20).optional(),
  currency: z.string().trim().length(3).default('USD'),
  isAvailable: z.boolean().optional(),
  websiteUrl: z.string().trim().url().max(500).optional().nullable(),
  githubUrl: z.string().trim().url().max(500).optional().nullable(),
  linkedinUrl: z.string().trim().url().max(500).optional().nullable(),
})

export const instructorUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  slug: slugSchema.optional(),
  bio: z.string().trim().max(10000).optional().nullable(),
  headline: z.string().trim().max(300).optional().nullable(),
  avatarUrl: z.string().trim().url().max(2000).optional().nullable(),
  specializations: z.array(z.string().trim().max(100)).max(20).optional().nullable(),
  experienceYears: z.coerce.number().int().min(0).max(50).optional().nullable(),
  hourlyRate: z.string().trim().max(20).optional().nullable(),
  currency: z.string().trim().length(3).optional(),
  isAvailable: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  isActive: z.boolean().optional(),
  websiteUrl: z.string().trim().url().max(500).optional().nullable(),
  githubUrl: z.string().trim().url().max(500).optional().nullable(),
  linkedinUrl: z.string().trim().url().max(500).optional().nullable(),
})

export const credentialCreateSchema = z.object({
  instructorId: uuid(),
  credentialUrl: z.string().trim().url().max(2000),
  credentialType: z.enum(credentialTypeValues).default('unreal_engine'),
  title: z.string().trim().max(500).optional(),
  issuer: z.string().trim().max(300).optional(),
  badgeImageUrl: z.string().trim().url().max(2000).optional(),
  issuedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
})

export const credentialUpdateSchema = z.object({
  credentialUrl: z.string().trim().url().max(2000).optional(),
  credentialType: z.enum(credentialTypeValues).optional(),
  title: z.string().trim().max(500).optional().nullable(),
  issuer: z.string().trim().max(300).optional().nullable(),
  badgeImageUrl: z.string().trim().url().max(2000).optional().nullable(),
  issuedAt: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  verificationStatus: z.enum(verificationStatusValues).optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
})

export const instructorListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  specialization: z.string().optional(),
  isAvailable: z.string().optional(),
  isVerified: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export const credentialListSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  instructorId: uuid().optional(),
  verificationStatus: z.enum(verificationStatusValues).optional(),
  credentialType: z.enum(credentialTypeValues).optional(),
})

export type InstructorCreateInput = z.infer<typeof instructorCreateSchema>
export type InstructorUpdateInput = z.infer<typeof instructorUpdateSchema>
export type CredentialCreateInput = z.infer<typeof credentialCreateSchema>
export type CredentialUpdateInput = z.infer<typeof credentialUpdateSchema>
