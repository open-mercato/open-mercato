// Extended shipments data model based on config
import { Entity, Property, PrimaryKey, Enum, ManyToOne } from '@mikro-orm/core';
import { User } from '@open-mercato/core/modules/auth/data/entities';
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities';

export enum ShipmentStatus {
    ORDERED = 'ORDERED',
    BOOKED = 'BOOKED',
    LOADING = 'LOADING',
    DEPARTED = 'DEPARTED',
    TRANSSHIPMENT = 'TRANSSHIPMENT',
    PRE_ARRIVAL = 'PRE_ARRIVAL',
    IN_PORT = 'IN_PORT',
    DELIVERED = 'DELIVERED'
}

export enum ContainerType {
    TWENTY_GP = '20GP',
    FORTY_GP = '40GP',
    FORTY_HC = '40HC',
    FORTY_FIVE_HC = '45HC',
    TWENTY_RF = '20RF',
    FORTY_RF = '40RF',
    TWENTY_OT = '20OT',
    FORTY_OT = '40OT'
}

export enum ContainerStatus {
    EMPTY = 'EMPTY',
    STUFFED = 'STUFFED',
    GATE_IN = 'GATE_IN',
    LOADED = 'LOADED',
    IN_TRANSIT = 'IN_TRANSIT',
    DISCHARGED = 'DISCHARGED',
    GATE_OUT = 'GATE_OUT',
    DELIVERED = 'DELIVERED',
    RETURNED = 'RETURNED'
}


export enum Incoterms {
    EXW = 'EXW',
    FCA = 'FCA',
    CPT = 'CPT',
    CIP = 'CIP',
    DAP = 'DAP',
    DPU = 'DPU',
    DDP = 'DDP',
    FAS = 'FAS',
    FOB = 'FOB',
    CFR = 'CFR',
    CIF = 'CIF'
}

export enum ShipmentMode {
    AIR = 'AIR',
    RAIL = 'RAIL',
    SEA = 'SEA',
    MIXED = 'MIXED'
}

export enum TaskStatus {
    TODO = 'TODO',
    IN_PROGRESS = 'IN_PROGRESS',
    DONE = 'DONE'
}

@Entity({ tableName: 'shipments' })
export class Shipment {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string;

    // Multi-tenancy fields
    @Property({ type: 'uuid', name: 'tenant_id' })
    tenantId!: string;

    @Property({ type: 'uuid', name: 'organization_id' })
    organizationId!: string;

    // Relationships
    @ManyToOne(() => CustomerEntity, { fieldName: 'client_id', nullable: true })
    client?: CustomerEntity;

    @ManyToOne(() => User, { fieldName: 'created_by_id', nullable: true })
    createdBy?: User;

    @ManyToOne(() => User, { fieldName: 'assigned_to_id', nullable: true })
    assignedTo?: User;

    // Core reference fields
    @Property({ type: 'varchar', nullable: true, name: 'container_number' })
    containerNumber?: string;

    @Property({ type: 'varchar', nullable: true, name: 'internal_reference' })
    internalReference?: string;

    @Property({ type: 'varchar', nullable: true, name: 'client_reference' })
    clientReference?: string;

    @Property({ type: 'varchar', nullable: true, name: 'booking_number' })
    bookingNumber?: string;

    @Property({ type: 'varchar', nullable: true, name: 'bol_number' })
    bolNumber?: string;

    // Carrier
    @Property({ type: 'varchar', nullable: true })
    carrier?: string;

    // Location fields - Ports
    @Property({ type: 'varchar', nullable: true, name: 'origin_port' })
    originPort?: string;

    @Property({ type: 'varchar', nullable: true, name: 'origin_location' })
    originLocation?: string;

    @Property({ type: 'varchar', nullable: true, name: 'destination_port' })
    destinationPort?: string;

    @Property({ type: 'varchar', nullable: true, name: 'destination_location' })
    destinationLocation?: string;

    // Time fields
    @Property({ type: 'timestamptz', nullable: true })
    etd?: Date;

    @Property({ type: 'timestamptz', nullable: true })
    atd?: Date;

    @Property({ type: 'timestamptz', nullable: true })
    eta?: Date;

    @Property({ type: 'timestamptz', nullable: true })
    ata?: Date;

    // Parties
    @ManyToOne(() => CustomerEntity, { nullable: true, name: 'shipper_id' })
    shipper?: CustomerEntity;

    // Parties
    @ManyToOne(() => CustomerEntity, { nullable: true, name: 'consignee_id' })
    consignee?: CustomerEntity;

    // Parties
    @ManyToOne(() => CustomerEntity, { nullable: true, name: 'contact_person_id' })
    contactPerson?: CustomerEntity;

    // Cargo details
    @Property({ type: 'numeric', nullable: true })
    weight?: number;

    @Property({ type: 'numeric', nullable: true })
    volume?: number;

    @Property({ type: 'varchar', nullable: true, name: 'container_type' })
    containerType?: ContainerType;

    @Property({ type: 'integer', nullable: true, name: 'total_pieces' })
    totalPieces?: number;

    @Property({ type: 'numeric', nullable: true, name: 'total_actual_weight' })
    totalActualWeight?: number;

    @Property({ type: 'numeric', nullable: true, name: 'total_chargeable_weight' })
    totalChargeableWeight?: number;

    @Property({ type: 'numeric', nullable: true, name: 'total_volume' })
    totalVolume?: number;

    @Property({ type: 'numeric', nullable: true, name: 'actual_weight_per_kilo' })
    actualWeightPerKilo?: number;

    @Property({ type: 'numeric', nullable: true })
    amount?: number;

    // Shipment mode
    @Property({ type: 'varchar', nullable: true })
    mode?: ShipmentMode;

    // Vessel details
    @Property({ type: 'varchar', nullable: true, name: 'vessel_name' })
    vesselName?: string;

    @Property({ type: 'numeric', nullable: true, name: 'vessel_imo' })
    vesselImo?: string;

    @Property({ type: 'varchar', nullable: true, name: 'voyage_number' })
    voyageNumber?: string;

    // Status and terms
    @Enum(() => ShipmentStatus)
    status: ShipmentStatus = ShipmentStatus.BOOKED;

    @Property({ type: 'varchar', nullable: true })
    incoterms?: Incoterms;

    // Timestamps
    @Property({ type: 'timestamptz', name: 'request_date', nullable: true })
    requestDate?: Date;

    @Property({ type: 'timestamptz', name: 'created_at' })
    createdAt: Date = new Date();

    @Property({ type: 'timestamptz', name: 'updated_at' })
    updatedAt: Date = new Date();
}



@Entity({ tableName: 'shipment_containers' })
export class ShipmentContainer {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string;

    // Multi-tenancy fields
    @Property({ type: 'uuid', name: 'tenant_id' })
    tenantId!: string;

    @Property({ type: 'uuid', name: 'organization_id' })
    organizationId!: string;

    // Relationship
    @ManyToOne(() => Shipment, { fieldName: 'shipment_id' })
    shipment!: Shipment;

    // Container details
    @Property({ type: 'varchar', nullable: true, name: 'container_number' })
    containerNumber?: string;

    @Enum({ items: () => ContainerType, nullable: true })
    containerType?: ContainerType;

    @Property({ type: 'text', nullable: true, name: 'cargo_description' })
    cargoDescription?: string;

    // Status and location
    @Enum({ items: () => ContainerStatus, nullable: true })
    status?: ContainerStatus;

    @Property({ type: 'varchar', nullable: true, name: 'current_location' })
    currentLocation?: string;

    // Tracking timestamps
    @Property({ type: 'timestamptz', nullable: true, name: 'gate_in_date' })
    gateInDate?: Date;

    @Property({ type: 'timestamptz', nullable: true, name: 'loaded_on_vessel_date' })
    loadedOnVesselDate?: Date;

    @Property({ type: 'timestamptz', nullable: true, name: 'discharged_date' })
    dischargedDate?: Date;

    @Property({ type: 'timestamptz', nullable: true, name: 'gate_out_date' })
    gateOutDate?: Date;

    @Property({ type: 'timestamptz', nullable: true, name: 'empty_return_date' })
    emptyReturnDate?: Date;

    // Timestamps
    @Property({ type: 'timestamptz', name: 'created_at' })
    createdAt: Date = new Date();

    @Property({ type: 'timestamptz', name: 'updated_at' })
    updatedAt: Date = new Date();
}


@Entity({ tableName: 'shipment_documents' })
export class ShipmentDocument {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string;

    // Multi-tenancy fields
    @Property({ type: 'uuid', name: 'tenant_id' })
    tenantId!: string;

    @Property({ type: 'uuid', name: 'organization_id' })
    organizationId!: string;

    // Relationships
    @Property({ type: 'uuid', name: 'shipment_id' })
    shipmentId!: string;

    @Property({ type: 'uuid', name: 'attachment_id' })
    attachmentId!: string;

    // Extraction data
    @Property({ type: 'jsonb', nullable: true, name: 'extracted_data' })
    extractedData?: Record<string, any>;

    @Property({ type: 'timestamptz', nullable: true, name: 'processed_at' })
    processedAt?: Date;

    // Timestamps
    @Property({ type: 'timestamptz', name: 'created_at' })
    createdAt: Date = new Date();

    @Property({ type: 'timestamptz', name: 'updated_at' })
    updatedAt: Date = new Date();
}




@Entity({ tableName: 'shipment_tasks' })
export class ShipmentTask {
    @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
    id!: string;

    @Property({ type: 'uuid', name: 'tenant_id' })
    tenantId!: string;

    @Property({ type: 'uuid', name: 'organization_id' })
    organizationId!: string;

    @Property({ type: 'uuid', name: 'shipment_id' })
    shipmentId!: string;

    @Property({ type: 'text' })
    title?: string;

    @Property({ type: 'text', nullable: true })
    description?: string;

    @Enum({ items: () => TaskStatus, default: TaskStatus.TODO })
    status: TaskStatus = TaskStatus.TODO;

    @ManyToOne(() => User, { fieldName: 'assigned_to_id', nullable: true })
    assignedTo?: User;

    @Property({ type: 'timestamptz', name: 'created_at' })
    createdAt: Date = new Date();

    @Property({ type: 'timestamptz', name: 'updated_at' })
    updatedAt: Date = new Date();
}