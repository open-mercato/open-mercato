import { z } from 'zod'

export const exampleItemCreateSchema = z.object({
  title: z.string().min(1).max(200),
})

export type ExampleItemCreateInput = z.infer<typeof exampleItemCreateSchema>
