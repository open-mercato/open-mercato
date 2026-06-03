import { z } from 'zod'

export const resendCredentialsSchema = z.object({
  apiKey: z.string().min(1),
  fromAddress: z.string().email(),
})

export type ResendCredentials = z.infer<typeof resendCredentialsSchema>
