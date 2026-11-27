import { z } from 'zod'

export const fixtureCreate = z.object({
  name: z.string().trim().min(1),
  privateCode: z.string().trim().min(1),
}).strict()

export const fixtureUpdate = fixtureCreate
