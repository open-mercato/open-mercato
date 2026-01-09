import { z } from 'zod'

/**
 * Quadrant enum validator
 */
export const quadrantSchema = z.enum(['NE', 'NW', 'SE', 'SW'])

/**
 * Location type enum validator
 */
export const locationTypeSchema = z.enum(['port', 'terminal'])

// ========================================
// Base Location Schema (shared fields for STI)
// ========================================

const baseLocationSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
  code: z
    .string()
    .min(1, 'Code is required')
    .max(50)
    .regex(/^[A-Z0-9_-]+$/i, 'Code must contain only letters, numbers, underscores, and hyphens'),
  name: z.string().min(1, 'Name is required').max(255),
  quadrant: quadrantSchema,
  createdBy: z.uuid().optional().nullable(),
})

// ========================================
// FmsPort Validators
// ========================================

export const createPortSchema = baseLocationSchema.extend({
  locode: z.string().min(1, 'LOCODE is required').max(10),
})

export const updatePortSchema = createPortSchema
  .partial()
  .omit({ organizationId: true, tenantId: true })
  .extend({
    updatedBy: z.uuid().optional().nullable(),
  })

export type CreatePortDto = z.infer<typeof createPortSchema>
export type UpdatePortDto = z.infer<typeof updatePortSchema>

// ========================================
// FmsTerminal Validators
// ========================================

export const createTerminalSchema = baseLocationSchema.extend({
  portId: z.uuid(),
})

export const updateTerminalSchema = createTerminalSchema
  .partial()
  .omit({ organizationId: true, tenantId: true, portId: true })
  .extend({
    updatedBy: z.uuid().optional().nullable(),
  })

export type CreateTerminalDto = z.infer<typeof createTerminalSchema>
export type UpdateTerminalDto = z.infer<typeof updateTerminalSchema>

// ========================================
// Query/Filter Validators
// ========================================

export const portFilterSchema = z.object({
  quadrant: quadrantSchema.optional(),
  includeDeleted: z.boolean().optional(),
  search: z.string().optional(),
})

export const terminalFilterSchema = z.object({
  portId: z.uuid().optional(),
  quadrant: quadrantSchema.optional(),
  includeDeleted: z.boolean().optional(),
  search: z.string().optional(),
})

export type PortFilter = z.infer<typeof portFilterSchema>
export type TerminalFilter = z.infer<typeof terminalFilterSchema>

// ========================================
// Bulk Import Validators
// ========================================

export const importLocationSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  quadrant: quadrantSchema,
  type: locationTypeSchema,
  portId: z.uuid().optional().nullable(),
})

export type ImportLocationDto = z.infer<typeof importLocationSchema>
