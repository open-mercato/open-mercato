import { z } from 'zod'
import {
  FUEL_TYPES,
  INSURANCE_COVERAGE_TYPES,
  INSURANCE_POLICY_STATUSES,
  MAINTENANCE_INTERVAL_TYPES,
  VIOLATION_STATUSES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPES,
} from './entities'

const dateInput = z.union([z.string().min(1), z.date()])
const dateTimeInput = z.union([z.string().min(1), z.date()])
const moneyInput = z.coerce.number().min(0)

export const createMaintenanceScheduleSchema = z.object({
  vehicleId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional().nullable(),
  intervalType: z.enum(MAINTENANCE_INTERVAL_TYPES).optional(),
  intervalOdometer: z.coerce.number().int().min(1).optional().nullable(),
  intervalDays: z.coerce.number().int().min(1).optional().nullable(),
  lastServiceOdometer: z.coerce.number().int().min(0).optional().nullable(),
  lastServiceAt: dateTimeInput.optional().nullable(),
  nextDueOdometer: z.coerce.number().int().min(0).optional().nullable(),
  nextDueAt: dateTimeInput.optional().nullable(),
  isActive: z.boolean().optional(),
})

export const updateMaintenanceScheduleSchema = createMaintenanceScheduleSchema.partial().extend({
  id: z.string().uuid(),
})

export const createWorkOrderSchema = z.object({
  vehicleId: z.string().uuid(),
  scheduleId: z.string().uuid().optional().nullable(),
  workOrderNumber: z.string().trim().min(1).max(60).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(8000).optional().nullable(),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
  type: z.enum(WORK_ORDER_TYPES).optional(),
  odometer: z.coerce.number().int().min(0).optional().nullable(),
  vendorName: z.string().trim().max(200).optional().nullable(),
  openedAt: dateTimeInput.optional().nullable(),
  startedAt: dateTimeInput.optional().nullable(),
  completedAt: dateTimeInput.optional().nullable(),
  downtimeMinutes: z.coerce.number().int().min(0).optional().nullable(),
  laborCost: moneyInput.optional(),
  partsCost: moneyInput.optional(),
  totalCost: moneyInput.optional(),
  currencyCode: z.string().trim().length(3).optional(),
  notes: z.string().trim().max(8000).optional().nullable(),
})

export const updateWorkOrderSchema = createWorkOrderSchema.partial().extend({
  id: z.string().uuid(),
})

export const completeWorkOrderSchema = z.object({
  id: z.string().uuid(),
  completedAt: dateTimeInput.optional().nullable(),
  odometer: z.coerce.number().int().min(0).optional().nullable(),
  downtimeMinutes: z.coerce.number().int().min(0).optional().nullable(),
  notes: z.string().trim().max(8000).optional().nullable(),
})

export const createWorkOrderPartSchema = z.object({
  workOrderId: z.string().uuid(),
  description: z.string().trim().min(1).max(500),
  partNumber: z.string().trim().max(120).optional().nullable(),
  quantity: moneyInput.optional(),
  unitCost: moneyInput.optional(),
})

export const updateWorkOrderPartSchema = createWorkOrderPartSchema.partial().extend({
  id: z.string().uuid(),
})

export const createWorkOrderLaborSchema = z.object({
  workOrderId: z.string().uuid(),
  description: z.string().trim().min(1).max(500),
  hours: moneyInput.optional(),
  rate: moneyInput.optional(),
})

export const updateWorkOrderLaborSchema = createWorkOrderLaborSchema.partial().extend({
  id: z.string().uuid(),
})

export const createFuelLogSchema = z.object({
  vehicleId: z.string().uuid(),
  loggedAt: dateTimeInput,
  odometer: z.coerce.number().int().min(0).optional().nullable(),
  liters: moneyInput,
  unitPrice: moneyInput,
  totalCost: moneyInput.optional(),
  fuelType: z.enum(FUEL_TYPES).optional(),
  stationName: z.string().trim().max(200).optional().nullable(),
  fullTank: z.boolean().optional(),
  driverEmployeeId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

export const updateFuelLogSchema = createFuelLogSchema.partial().extend({
  id: z.string().uuid(),
})

export const createInsurancePolicySchema = z.object({
  vehicleId: z.string().uuid(),
  policyNumber: z.string().trim().min(1).max(120),
  insurerName: z.string().trim().min(1).max(200),
  coverageType: z.enum(INSURANCE_COVERAGE_TYPES).optional(),
  startDate: dateInput,
  endDate: dateInput,
  premiumAmount: moneyInput.optional(),
  currencyCode: z.string().trim().length(3).optional(),
  status: z.enum(INSURANCE_POLICY_STATUSES).optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

export const updateInsurancePolicySchema = createInsurancePolicySchema.partial().extend({
  id: z.string().uuid(),
})

export const createTrafficViolationSchema = z.object({
  vehicleId: z.string().uuid(),
  driverEmployeeId: z.string().uuid().optional().nullable(),
  violationNumber: z.string().trim().min(1).max(120),
  occurredAt: dateTimeInput,
  location: z.string().trim().max(300).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  fineAmount: moneyInput.optional(),
  currencyCode: z.string().trim().length(3).optional(),
  status: z.enum(VIOLATION_STATUSES).optional(),
  paidAt: dateTimeInput.optional().nullable(),
  payrollDeductionRequested: z.boolean().optional(),
  notes: z.string().trim().max(4000).optional().nullable(),
})

export const updateTrafficViolationSchema = createTrafficViolationSchema.partial().extend({
  id: z.string().uuid(),
})

export type CreateMaintenanceScheduleInput = z.infer<typeof createMaintenanceScheduleSchema>
export type UpdateMaintenanceScheduleInput = z.infer<typeof updateMaintenanceScheduleSchema>
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>
export type CompleteWorkOrderInput = z.infer<typeof completeWorkOrderSchema>
export type CreateWorkOrderPartInput = z.infer<typeof createWorkOrderPartSchema>
export type UpdateWorkOrderPartInput = z.infer<typeof updateWorkOrderPartSchema>
export type CreateWorkOrderLaborInput = z.infer<typeof createWorkOrderLaborSchema>
export type UpdateWorkOrderLaborInput = z.infer<typeof updateWorkOrderLaborSchema>
export type CreateFuelLogInput = z.infer<typeof createFuelLogSchema>
export type UpdateFuelLogInput = z.infer<typeof updateFuelLogSchema>
export type CreateInsurancePolicyInput = z.infer<typeof createInsurancePolicySchema>
export type UpdateInsurancePolicyInput = z.infer<typeof updateInsurancePolicySchema>
export type CreateTrafficViolationInput = z.infer<typeof createTrafficViolationSchema>
export type UpdateTrafficViolationInput = z.infer<typeof updateTrafficViolationSchema>
