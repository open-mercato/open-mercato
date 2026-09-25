import { z } from 'zod'
import {
  FLEET_VEHICLE_STATUSES,
  FLEET_VEHICLE_DOCUMENT_TYPES,
  FLEET_ASSIGNMENT_STATUSES,
} from './entities'

const dateInput = z.string().min(1).or(z.date())
const dateTimeInput = z.string().datetime().or(z.date())

export const createVehicleSchema = z.object({
  plateNumber: z.string().min(1),
  sequenceNumber: z.string().trim().min(1).optional().nullable(),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(new Date().getFullYear() + 1),
  color: z.string().trim().min(1).optional().nullable(),
  vehicleType: z.string().trim().min(1).optional().nullable(),
  status: z.enum(FLEET_VEHICLE_STATUSES).optional(),
  currentOdometer: z.coerce.number().int().min(0).optional(),
  assignedEmployeeId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().min(1).optional().nullable(),
})

export const updateVehicleSchema = createVehicleSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>

export const createVehicleDocumentSchema = z.object({
  vehicleId: z.string().uuid(),
  documentType: z.enum(FLEET_VEHICLE_DOCUMENT_TYPES),
  documentNumber: z.string().trim().min(1).optional().nullable(),
  issueDate: dateInput.optional().nullable(),
  expiryDate: dateInput.optional().nullable(),
  fileAttachmentId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().min(1).optional().nullable(),
})

export const updateVehicleDocumentSchema = createVehicleDocumentSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateVehicleDocumentInput = z.infer<typeof createVehicleDocumentSchema>
export type UpdateVehicleDocumentInput = z.infer<typeof updateVehicleDocumentSchema>

export const createVehicleAssignmentSchema = z.object({
  vehicleId: z.string().uuid(),
  employeeId: z.string().uuid(),
  dueReturnAt: dateTimeInput.optional().nullable(),
  handoverOdometer: z.coerce.number().int().min(0).optional().nullable(),
  custodyNotes: z.string().trim().min(1).optional().nullable(),
})

export const updateVehicleAssignmentSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(FLEET_ASSIGNMENT_STATUSES).optional(),
  approvalRequestId: z.string().uuid().optional().nullable(),
  assignedAt: dateTimeInput.optional().nullable(),
  dueReturnAt: dateTimeInput.optional().nullable(),
  returnedAt: dateTimeInput.optional().nullable(),
  handoverOdometer: z.coerce.number().int().min(0).optional().nullable(),
  returnOdometer: z.coerce.number().int().min(0).optional().nullable(),
  custodyNotes: z.string().trim().min(1).optional().nullable(),
})

export const returnVehicleAssignmentSchema = z.object({
  id: z.string().uuid(),
  returnOdometer: z.coerce.number().int().min(0),
  returnedAt: dateTimeInput.optional().nullable(),
  custodyNotes: z.string().trim().min(1).optional().nullable(),
})

export type CreateVehicleAssignmentInput = z.infer<typeof createVehicleAssignmentSchema>
export type UpdateVehicleAssignmentInput = z.infer<typeof updateVehicleAssignmentSchema>
export type ReturnVehicleAssignmentInput = z.infer<typeof returnVehicleAssignmentSchema>

export const createOdometerLogSchema = z.object({
  vehicleId: z.string().uuid(),
  reading: z.coerce.number().int().min(0),
  recordedAt: dateTimeInput.optional().nullable(),
  source: z.string().trim().min(1).optional().nullable(),
  assignmentId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().min(1).optional().nullable(),
})

export type CreateOdometerLogInput = z.infer<typeof createOdometerLogSchema>
