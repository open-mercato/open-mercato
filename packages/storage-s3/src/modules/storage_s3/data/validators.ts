import { z } from 'zod'

const explicitS3KeySchema = z.string().refine((value) => value.trim().length > 0)

export const tenantS3CredentialsSchema = z.object({
  authMode: z.literal('access_keys').optional(),
  accessKeyId: explicitS3KeySchema,
  secretAccessKey: explicitS3KeySchema,
  sessionToken: explicitS3KeySchema.optional(),
  bucket: z.string().trim().min(1),
  region: z.string().trim().min(1),
  endpoint: z.string().optional(),
  forcePathStyle: z.boolean().optional(),
}).strict()

export const tenantS3AuthenticationSchema = tenantS3CredentialsSchema.pick({
  authMode: true,
  accessKeyId: true,
  secretAccessKey: true,
  sessionToken: true,
}).strip()

export const s3StorageConfigurationSchema = z.object({
  bucket: z.string().trim().min(1).optional(),
  region: z.string().trim().min(1).optional(),
  endpoint: z.string().trim().min(1).optional(),
  pathPrefix: z.string().optional(),
  forcePathStyle: z.boolean().optional(),
  authMode: z.enum(['access_keys', 'ambient']).optional(),
  credentialsEnvPrefix: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  accessKeyId: z.string().min(1).optional(),
  secretAccessKey: z.string().min(1).optional(),
  sessionToken: z.string().min(1).optional(),
  organizationId: z.string().nullable().optional(),
  tenantId: z.string().nullable().optional(),
}).passthrough()
