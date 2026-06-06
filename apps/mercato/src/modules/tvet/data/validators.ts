import { z } from 'zod'

export const traineeCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  admissionNumber: z.string().min(1),
  upiNumber: z.string().optional().nullable(),
  kcseIndex: z.string().optional().nullable(),
  courseId: z.string().uuid().optional().nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

export const traineeUpdateSchema = traineeCreateSchema.partial().extend({
  id: z.string().uuid(),
})

export const courseCreateSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  level: z.string().min(1),
  durationMonths: z.number().int().min(1),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

export const courseUpdateSchema = courseCreateSchema.partial().extend({
  id: z.string().uuid(),
})
