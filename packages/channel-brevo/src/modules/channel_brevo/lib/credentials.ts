import { z } from 'zod'

export const brevoCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1),
  fromAddress: z.string().email(),
})

export type BrevoCredentials = z.infer<typeof brevoCredentialsSchema>
