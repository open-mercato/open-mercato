import { z } from 'zod'

/** Trusted request input for rendering a built-in quote document. */
export const quoteDocumentInputSchema = z.object({
  id: z.string().uuid(),
})

export type QuoteDocumentInput = z.infer<typeof quoteDocumentInputSchema>
