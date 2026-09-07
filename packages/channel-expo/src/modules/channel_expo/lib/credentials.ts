import { z } from 'zod'

/**
 * Tenant-level Expo credentials persisted on `IntegrationCredentials` for provider
 * `channel_expo`. The access token is optional (only required when Expo "enhanced
 * push security" is enabled for the project); stored encrypted at rest.
 */
export const expoCredentialsSchema = z
  .object({
    accessToken: z.string().optional(),
  })
  .passthrough()

export type ExpoCredentials = z.infer<typeof expoCredentialsSchema>
