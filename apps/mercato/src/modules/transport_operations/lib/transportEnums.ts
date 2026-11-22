/**
 * Client-safe status values for transport records. Kept out of `data/entities.ts`
 * so list screens and spreadsheet parsers can use them without pulling the
 * MikroORM decorators into the browser bundle.
 */
export const DRIVER_STATUS_VALUES = ['available', 'on_trip', 'on_leave', 'suspended'] as const
export type DriverStatusValue = (typeof DRIVER_STATUS_VALUES)[number]

export const VEHICLE_STATUS_VALUES = ['active', 'maintenance', 'out_of_service'] as const
export type VehicleStatusValue = (typeof VEHICLE_STATUS_VALUES)[number]
