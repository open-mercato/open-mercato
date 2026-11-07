import { z } from 'zod'
import { SALES_RECURRENCE_FREQUENCIES, isAnchorDayValid, isIsoDate } from './recurrence'

export const SALES_RECURRENCE_MAX_PERIOD_COUNT = 1200

export const recurrenceInputSchema = z
  .object({
    frequency: z.enum(SALES_RECURRENCE_FREQUENCIES),
    startsOn: z.string().trim().refine(isIsoDate, { message: 'sales.recurring.errors.invalidStartsOn' }),
    anchorDay: z.coerce.number().int().min(1).max(31).nullable().optional(),
    periodCount: z.coerce
      .number()
      .int({ message: 'sales.recurring.errors.invalidPeriodCount' })
      .min(1, { message: 'sales.recurring.errors.invalidPeriodCount' })
      .max(SALES_RECURRENCE_MAX_PERIOD_COUNT, { message: 'sales.recurring.errors.invalidPeriodCount' })
      .nullable()
      .optional(),
  })
  .refine((value) => !isIsoDate(value.startsOn) || isAnchorDayValid(value), {
    message: 'sales.recurring.errors.invalidAnchorDay',
    path: ['anchorDay'],
  })

export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>
