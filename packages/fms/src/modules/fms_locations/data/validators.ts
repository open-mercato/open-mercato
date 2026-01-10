import { z } from 'zod'

/**
 * Location type enum validator
 */
export const locationTypeSchema = z.enum(['port', 'terminal'])

// ========================================
// Unified Location Schema
// ========================================

export const createLocationSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  code: z
    .string()
    .min(1, 'Code is required')
    .max(50)
    .regex(/^[A-Z0-9_-]+$/i, 'Code must contain only letters, numbers, underscores, and hyphens'),
  name: z.string().min(1, 'Name is required').max(255),
  type: locationTypeSchema,
  locode: z.string().max(10).optional().nullable(),
  portId: z.string().uuid().optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  city: z.string().max(255).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  createdBy: z.string().uuid().optional().nullable(),
})

export const updateLocationSchema = createLocationSchema
  .partial()
  .omit({ organizationId: true, tenantId: true, type: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateLocationDto = z.infer<typeof createLocationSchema>
export type UpdateLocationDto = z.infer<typeof updateLocationSchema>

// ========================================
// Backward Compatible Port/Terminal Schemas
// ========================================

export const createPortSchema = createLocationSchema.extend({
  type: z.literal('port').default('port'),
  locode: z.string().min(1, 'LOCODE is required').max(10),
})

export const updatePortSchema = createPortSchema
  .partial()
  .omit({ organizationId: true, tenantId: true, type: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreatePortDto = z.infer<typeof createPortSchema>
export type UpdatePortDto = z.infer<typeof updatePortSchema>

export const createTerminalSchema = createLocationSchema.extend({
  type: z.literal('terminal').default('terminal'),
  portId: z.string().uuid().optional().nullable(),
})

export const updateTerminalSchema = createTerminalSchema
  .partial()
  .omit({ organizationId: true, tenantId: true, type: true })
  .extend({
    updatedBy: z.string().uuid().optional().nullable(),
  })

export type CreateTerminalDto = z.infer<typeof createTerminalSchema>
export type UpdateTerminalDto = z.infer<typeof updateTerminalSchema>

// ========================================
// Query/Filter Validators
// ========================================

export const locationFilterSchema = z.object({
  type: locationTypeSchema.optional(),
  portId: z.string().uuid().optional(),
  includeDeleted: z.boolean().optional(),
  search: z.string().optional(),
})

export const portFilterSchema = z.object({
  includeDeleted: z.boolean().optional(),
  search: z.string().optional(),
})

export const terminalFilterSchema = z.object({
  portId: z.string().uuid().optional(),
  includeDeleted: z.boolean().optional(),
  search: z.string().optional(),
})

export type LocationFilter = z.infer<typeof locationFilterSchema>
export type PortFilter = z.infer<typeof portFilterSchema>
export type TerminalFilter = z.infer<typeof terminalFilterSchema>

// ========================================
// CSV Import Validators
// ========================================

export const csvImportRowSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  type: locationTypeSchema,
  lat: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().min(-90).max(90).nullable().optional()
  ),
  lng: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().min(-180).max(180).nullable().optional()
  ),
  locode: z.string().optional().nullable(),
  port_code: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
})

export type CsvImportRow = z.infer<typeof csvImportRowSchema>
