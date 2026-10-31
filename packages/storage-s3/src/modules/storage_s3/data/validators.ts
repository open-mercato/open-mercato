import { z } from 'zod'

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
