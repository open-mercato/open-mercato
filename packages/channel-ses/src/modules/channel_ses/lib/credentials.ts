import { z } from 'zod'

export const sesCredentialsSchema = z.object({
  region: z.string().min(1).optional(),
  fromAddress: z.string().email(),
  configurationSetName: z.string().min(1).optional(),
})

export type SesCredentials = z.infer<typeof sesCredentialsSchema>
