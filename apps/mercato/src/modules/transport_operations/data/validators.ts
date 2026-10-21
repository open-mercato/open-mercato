import { z } from 'zod'
import { VEHICLE_STATUSES, DRIVER_STATUSES } from './entities'

export const createVehicleSchema = z.object({
  plateNumber: z.string().min(1),
  // The fleet register never captured a VIN; migrated vehicles keep it empty. New
  // transport vehicles can still provide one, and the unique index ignores nulls.
  vin: z.string().trim().min(1).max(32).optional().nullable(),
  sequenceNumber: z.string().trim().min(1).optional().nullable(),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.coerce.number().int().min(1900).max(new Date().getFullYear() + 1),
  capacity: z.coerce.number().int().min(0).optional().default(0),
  color: z.string().trim().min(1).optional().nullable(),
  vehicleType: z.string().trim().min(1).optional().nullable(),
  currentOdometer: z.coerce.number().int().min(0).optional(),
  status: z.enum(VEHICLE_STATUSES).optional(),
  telematicsDeviceId: z.string().trim().min(1).optional().nullable(),
  notes: z.string().trim().min(1).optional().nullable(),
})

export const updateVehicleSchema = createVehicleSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>

export const createDriverSchema = z.object({
  employeeId: z.string().uuid().optional().nullable(),
  fullName: z.string().min(1),
  nationalId: z.string().min(1),
  licenseNumber: z.string().min(1),
  licenseExpiry: z.string().min(1).or(z.date()),
  phone: z.string().min(1),
  status: z.enum(DRIVER_STATUSES).optional(),
})

export const updateDriverSchema = createDriverSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateDriverInput = z.infer<typeof createDriverSchema>
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>

export const createRouteSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  startLocation: z.string().min(1),
  endLocation: z.string().min(1),
  estimatedDurationMinutes: z.coerce.number().int().min(1),
})

export const updateRouteSchema = createRouteSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateRouteInput = z.infer<typeof createRouteSchema>
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>

export const createTripScheduleSchema = z
  .object({
    routeId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    driverId: z.string().uuid(),
    scheduledStartTime: z.string().datetime().or(z.date()),
    scheduledEndTime: z.string().datetime().or(z.date()),
  })
  .refine((data) => new Date(data.scheduledEndTime) > new Date(data.scheduledStartTime), {
    message: 'scheduledEndTime must be after scheduledStartTime',
    path: ['scheduledEndTime'],
  })

export const updateTripScheduleSchema = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  scheduledStartTime: z.string().datetime().or(z.date()).optional(),
  scheduledEndTime: z.string().datetime().or(z.date()).optional(),
})

export type CreateTripScheduleInput = z.infer<typeof createTripScheduleSchema>
export type UpdateTripScheduleInput = z.infer<typeof updateTripScheduleSchema>
