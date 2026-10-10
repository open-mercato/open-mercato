import { z } from 'zod'

export const mailjetCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1),
  secretKey: z.string().trim().min(1),
  fromAddress: z.string().email(),
})

export type MailjetCredentials = z.infer<typeof mailjetCredentialsSchema>
