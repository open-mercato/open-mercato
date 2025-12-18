// Extended shipments validators based on config
import { z } from 'zod';
import { ContainerType, ShipmentStatus, Incoterms, ShipmentMode, ContainerStatus } from './entities';

// Container number validation (ISO 6346: 4 letters + 7 digits)
const containerNumberSchema = z.string().regex(/^[A-Z]{4}[0-9]{7}$/, 'Must be 4 letters + 7 digits (ISO 6346)').nullable().optional();

export const createShipmentSchema = z.object({
    // // Multi-tenancy (required)
    // tenantId: z.string().uuid(),
    // organizationId: z.string().uuid(),

    // Relationships
    clientId: z.string().uuid().nullable().optional(),
    createdById: z.string().uuid().nullable().optional(),
    assignedToId: z.string().uuid().nullable().optional(),

    // Core reference fields
    containerNumber: containerNumberSchema,
    internalReference: z.string().nullable().optional(),
    clientReference: z.string().nullable().optional(),
    order: z.string().nullable().optional(),
    bookingNumber: z.string().nullable().optional(),
    bolNumber: z.string().nullable().optional(),

    // Carrier
    carrier: z.string().nullable().optional(),

    // Location fields
    originPort: z.string().nullable().optional(),
    originLocation: z.string().nullable().optional(),
    destinationPort: z.string().nullable().optional(),
    destinationLocation: z.string().nullable().optional(),

    // Time fields
    etd: z.coerce.date().nullable().optional(),
    atd: z.coerce.date().nullable().optional(),
    eta: z.coerce.date().nullable().optional(),
    ata: z.coerce.date().nullable().optional(),
    requestDate: z.coerce.date().nullable().optional(),

    // Parties
    shipperId: z.string().nullable().optional(),
    consigneeId: z.string().nullable().optional(),
    contactPersonId: z.string().nullable().optional(),

    // Cargo details
    weight: z.number().min(0).max(35000).nullable().optional(),
    volume: z.number().min(0).max(100).nullable().optional(),
    containerType: z.nativeEnum(ContainerType).nullable().optional(),
    totalPieces: z.number().int().min(0).nullable().optional(),
    totalActualWeight: z.number().min(0).nullable().optional(),
    totalChargeableWeight: z.number().min(0).nullable().optional(),
    totalVolume: z.number().min(0).nullable().optional(),
    actualWeightPerKilo: z.number().min(0).nullable().optional(),
    amount: z.number().nullable().optional(),

    // Shipment mode
    mode: z.nativeEnum(ShipmentMode).nullable().optional(),

    // Vessel details
    vesselName: z.string().nullable().optional(),
    vesselImo: z.string().nullable().optional(),
    voyageNumber: z.string().nullable().optional(),

    // Status and terms
    status: z.nativeEnum(ShipmentStatus).default(ShipmentStatus.BOOKED),
    incoterms: z.nativeEnum(Incoterms).nullable().optional(),
});

export const updateShipmentSchema = z.object({
    // Core reference fields
    containerNumber: containerNumberSchema,
    internalReference: z.string().nullable().optional(),
    clientReference: z.string().nullable().optional(),
    order: z.string().nullable().optional(),
    bookingNumber: z.string().nullable().optional(),
    bolNumber: z.string().nullable().optional(),

    // Carrier
    carrier: z.string().nullable().optional(),

    // Location fields
    originPort: z.string().nullable().optional(),
    originLocation: z.string().nullable().optional(),
    destinationPort: z.string().nullable().optional(),
    destinationLocation: z.string().nullable().optional(),

    // Time fields
    etd: z.coerce.date().nullable().optional(),
    atd: z.coerce.date().nullable().optional(),
    eta: z.coerce.date().nullable().optional(),
    ata: z.coerce.date().nullable().optional(),
    requestDate: z.coerce.date().nullable().optional(),

    // Cargo details
    weight: z.number().min(0).max(35000).nullable().optional(),
    volume: z.number().min(0).max(100).nullable().optional(),
    containerType: z.nativeEnum(ContainerType).nullable().optional(),
    totalPieces: z.number().int().min(0).nullable().optional(),
    totalActualWeight: z.number().min(0).nullable().optional(),
    totalChargeableWeight: z.number().min(0).nullable().optional(),
    totalVolume: z.number().min(0).nullable().optional(),
    actualWeightPerKilo: z.number().min(0).nullable().optional(),
    amount: z.number().nullable().optional(),

    // Shipment mode
    mode: z.nativeEnum(ShipmentMode).nullable().optional(),

    // Vessel details
    vesselName: z.string().nullable().optional(),
    vesselImo: z.string().nullable().optional(),
    voyageNumber: z.string().nullable().optional(),

    // Status and terms
    status: z.nativeEnum(ShipmentStatus).nullable().optional(),
    incoterms: z.nativeEnum(Incoterms).nullable().optional(),

    // Relationships
    clientId: z.string().uuid().nullable().optional(),
    assignedToId: z.string().uuid().nullable().optional(),
    shipperId: z.string().nullable().optional(),
    consigneeId: z.string().nullable().optional(),
    contactPersonId: z.string().nullable().optional(),
}).partial();

export const queryShipmentSchema = z.object({
    // Pagination
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),

    // Filters
    status: z.nativeEnum(ShipmentStatus).nullable().optional(),
    containerType: z.nativeEnum(ContainerType).nullable().optional(),
    incoterms: z.nativeEnum(Incoterms).nullable().optional(),
    mode: z.nativeEnum(ShipmentMode).nullable().optional(),

    // Relationship filters
    clientId: z.string().uuid().nullable().optional(),
    assignedToId: z.string().uuid().nullable().optional(),

    // Text search
    search: z.string().nullable().optional(),

    // Reference filters
    containerNumber: z.string().nullable().optional(),
    bookingNumber: z.string().nullable().optional(),
    bolNumber: z.string().nullable().optional(),
    carrier: z.string().nullable().optional(),

    // Location filters
    originPort: z.string().nullable().optional(),
    destinationPort: z.string().nullable().optional(),

    // Date range filters
    etdFrom: z.coerce.date().nullable().optional(),
    etdTo: z.coerce.date().nullable().optional(),
    etaFrom: z.coerce.date().nullable().optional(),
    etaTo: z.coerce.date().nullable().optional(),
    requestDateFrom: z.coerce.date().nullable().optional(),
    requestDateTo: z.coerce.date().nullable().optional(),
});

export type CreateShipmentDto = z.infer<typeof createShipmentSchema>;
export type UpdateShipmentDto = z.infer<typeof updateShipmentSchema>;
export type QueryShipmentDto = z.infer<typeof queryShipmentSchema>;



export const createShipmentContainerSchema = z.object({
    shipmentId: z.string().uuid(),
    containerNumber: containerNumberSchema.optional(),
    containerType: z.nativeEnum(ContainerType),
    cargoDescription: z.string().nullable().optional(),
    status: z.nativeEnum(ContainerStatus).optional(),
    currentLocation: z.string().nullable().optional(),
    gateInDate: z.coerce.date().nullable().optional(),
    loadedOnVesselDate: z.coerce.date().nullable().optional(),
    dischargedDate: z.coerce.date().nullable().optional(),
    gateOutDate: z.coerce.date().nullable().optional(),
    emptyReturnDate: z.coerce.date().nullable().optional(),
});

export const updateShipmentContainerSchema = z.object({
    containerNumber: containerNumberSchema.optional(),
    containerType: z.nativeEnum(ContainerType).optional(),
    cargoDescription: z.string().nullable().optional(),
    status: z.nativeEnum(ContainerStatus).optional(),
    currentLocation: z.string().nullable().optional(),
    gateInDate: z.coerce.date().nullable().optional(),
    loadedOnVesselDate: z.coerce.date().nullable().optional(),
    dischargedDate: z.coerce.date().nullable().optional(),
    gateOutDate: z.coerce.date().nullable().optional(),
    emptyReturnDate: z.coerce.date().nullable().optional(),
}).partial();

export const queryShipmentContainerSchema = z.object({
    // Pagination
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),

    // Filters
    shipmentId: z.string().uuid().nullable().optional(),
    status: z.nativeEnum(ContainerStatus).nullable().optional(),
    containerType: z.nativeEnum(ContainerType).nullable().optional(),
    containerNumber: z.string().nullable().optional(),
    currentLocation: z.string().nullable().optional(),

    // Date range filters
    gateInDateFrom: z.coerce.date().nullable().optional(),
    gateInDateTo: z.coerce.date().nullable().optional(),
    loadedOnVesselDateFrom: z.coerce.date().nullable().optional(),
    loadedOnVesselDateTo: z.coerce.date().nullable().optional(),
    dischargedDateFrom: z.coerce.date().nullable().optional(),
    dischargedDateTo: z.coerce.date().nullable().optional(),
    gateOutDateFrom: z.coerce.date().nullable().optional(),
    gateOutDateTo: z.coerce.date().nullable().optional(),
    emptyReturnDateFrom: z.coerce.date().nullable().optional(),
    emptyReturnDateTo: z.coerce.date().nullable().optional(),

    // Text search
    search: z.string().nullable().optional(),
});

export type CreateShipmentContainerDto = z.infer<typeof createShipmentContainerSchema>;
export type UpdateShipmentContainerDto = z.infer<typeof updateShipmentContainerSchema>;
export type QueryShipmentContainerDto = z.infer<typeof queryShipmentContainerSchema>;
