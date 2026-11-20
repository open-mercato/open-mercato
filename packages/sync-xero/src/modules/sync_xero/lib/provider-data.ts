import { z } from 'zod'

export const xeroProviderDataSchema = z.object({
  xeroOrganisationId: z.guid(),
  xeroConnectionId: z.guid(),
  xeroOrganisationName: z.string().min(1).max(255),
})

export type XeroProviderData = z.infer<typeof xeroProviderDataSchema>

export function parseXeroProviderData(value: unknown): XeroProviderData | null {
  const parsed = xeroProviderDataSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
