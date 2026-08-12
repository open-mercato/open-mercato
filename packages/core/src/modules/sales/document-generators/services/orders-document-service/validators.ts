import { z } from 'zod'

/** Trusted request input for rendering a built-in order document. */
export const orderDocumentInputSchema = z.object({
  id: z.string().uuid(),
})

export type OrderDocumentInput = z.infer<typeof orderDocumentInputSchema>
