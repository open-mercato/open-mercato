import { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '@open-mercato/events/types';

import { ExcelService } from './excel-parse.service';
import { LlmService } from './llm.service';
import { Shipment, ShipmentStatus, ShipmentContainer, ContainerType } from '../data/entities';


export interface ImportContext {
    email: string;
    actorOrgId: string;
    actorTenantId: string;
}

export interface ImportResult {
    shipmentsCreated: number;
    containersCreated: number;
    clientsCreated: number;
    fieldsDetected: string[];
    columnMappings: Array<{
        original: string;
        mapped: string | null;
        confidence?: number;
    }>;
    metadata: {
        totalRows: number;
        sheetName: string;
    };
}

interface ColumnAnalysis {
    originalName: string;
    mappedName: string | null;
    dataType: string;
    confidence?: number;
}

interface ContainerData {
    containerNumber: string;
    containerType?: ContainerType;
}

export class ShipmentImportService {
    private excelService: ExcelService;
    private llmService: LlmService;
    private em: EntityManager;
    private eventBus: EventBus;

    constructor(
        excelService: ExcelService,
        llmService: LlmService,
        em: EntityManager,
        eventBus: EventBus
    ) {
        this.excelService = excelService;
        this.llmService = llmService;
        this.em = em;
        this.eventBus = eventBus;
    }

    /**
     * Import shipments from Excel file
     */
    async importFromExcel(file: File, context: ImportContext): Promise<ImportResult> {
        // 1. Parse Excel file
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const parsed = await this.excelService.parseFile(buffer);

        // 2. Analyze table structure with LLM
        const analysis = await this.llmService.analyzeTableStructure({
            headers: parsed.headers,
            sampleRows: parsed.rows.slice(0, 20),
            sheetName: parsed.metadata.sheetName,
        });

        // 3. Extract unique values for carrier and status columns
        const { uniqueCarriers, uniqueStatuses } = this.extractUniqueValues(
            parsed.rows,
            analysis.columns
        );

        // 4. Parallel LLM calls for mappings (KEY OPTIMIZATION)
        const [carrierResult, statusResult] = await Promise.all([
            uniqueCarriers.size > 0
                ? this.llmService.detectCarrierMappings(Array.from(uniqueCarriers))
                : Promise.resolve({ mappings: {} }),
            uniqueStatuses.size > 0
                ? this.llmService.mapStatusToEnum(Array.from(uniqueStatuses))
                : Promise.resolve({ mappings: {} }),
        ]);

        const carrierMappings = carrierResult.mappings;
        const statusMappings = statusResult.mappings;

        // 5. Extract unique client names and create/find clients
        const clientNames = this.extractClientNames(parsed.rows, analysis.columns);
        const clientMap = await this.createOrFindClients(
            clientNames,
            context.actorTenantId,
            context.actorOrgId
        );

        const clientsCreated = Array.from(clientMap.values()).filter(
            (c: any) => !c.id
        ).length;

        // 6. Transform rows to shipments with all mappings
        const { shipments, containerDataMap } = this.transformRowsToShipments(
            parsed.rows,
            analysis.columns,
            carrierMappings,
            statusMappings,
            clientMap,
            context
        );

        // 7. Create ShipmentContainer entities
        const containers = this.createShipmentContainers(shipments, containerDataMap);

        // 8. Persist everything in one transaction
        await this.em.persistAndFlush([...shipments, ...containers]);

        // 9. Emit event for logging/webhooks (no subscriber needed)
        await this.eventBus.emitEvent('shipments.imported', {
            shipments,
            containers,
            creatorEmail: context.email,
            tenantId: context.actorTenantId,
            orgId: context.actorOrgId,
            clientsCreated,
        });

        return {
            shipmentsCreated: shipments.length,
            containersCreated: containers.length,
            clientsCreated,
            fieldsDetected: parsed.headers,
            columnMappings: analysis.columns.map((c: ColumnAnalysis) => ({
                original: c.originalName,
                mapped: c.mappedName,
                confidence: c.confidence,
            })),
            metadata: {
                totalRows: parsed.rows.length,
                sheetName: parsed.metadata.sheetName,
            },
        };
    }

    /**
     * Extract unique carrier and status values from rows
     */
    private extractUniqueValues(
        rows: any[][],
        columns: ColumnAnalysis[]
    ): {
        uniqueCarriers: Set<string>;
        uniqueStatuses: Set<string>;
    } {
        const carrierColumn = columns.find((c) => c.mappedName === 'carrier');
        const statusColumn = columns.find((c) => c.mappedName === 'status');

        const uniqueCarriers = new Set<string>();
        const uniqueStatuses = new Set<string>();

        if (carrierColumn) {
            const idx = columns.indexOf(carrierColumn);
            rows.forEach((row) => {
                const value = row[idx];
                if (value && typeof value === 'string') {
                    uniqueCarriers.add(value.trim());
                }
            });
        }

        if (statusColumn) {
            const idx = columns.indexOf(statusColumn);
            rows.forEach((row) => {
                const value = row[idx];
                if (value && typeof value === 'string') {
                    uniqueStatuses.add(value.trim());
                }
            });
        }

        return { uniqueCarriers, uniqueStatuses };
    }

    /**
     * Extract unique client names from rows
     */
    private extractClientNames(rows: any[][], columns: ColumnAnalysis[]): string[] {
        const clientColumn = columns.find((c) => c.mappedName === 'clientName');
        if (!clientColumn) return [];

        const idx = columns.indexOf(clientColumn);
        const clientNames = new Set<string>();

        rows.forEach((row) => {
            const value = row[idx];
            if (value && typeof value === 'string') {
                clientNames.add(value.trim());
            }
        });

        return Array.from(clientNames);
    }

    /**
     * Create new clients and find existing ones
     */
    private async createOrFindClients(
        clientNames: string[],
        tenantId: string,
        orgId: string
    ): Promise<Map<string, any>> {
        if (clientNames.length === 0) {
            return new Map();
        }

        // Batch fetch existing companies
        const companies = await this.em.find('CustomerEntity', {
            kind: 'company',
            displayName: { $in: clientNames },
            tenantId,
            organizationId: orgId,
        });

        const companyMap = new Map(
            companies.map((c: any) => [c.displayName.trim().toLowerCase(), c])
        );

        // Create missing companies
        for (const clientName of clientNames) {
            const key = clientName.toLowerCase();
            if (!companyMap.has(key)) {
                const newCompany = this.em.create('CustomerEntity', {
                    kind: 'company',
                    displayName: clientName,
                    tenantId,
                    organizationId: orgId,
                });
                companyMap.set(key, newCompany);
            }
        }

        return companyMap;
    }

    /**
     * Transform parsed rows to Shipment entities
     */
    private transformRowsToShipments(
        rows: any[][],
        columns: ColumnAnalysis[],
        carrierMappings: Record<string, string>,
        statusMappings: Record<string, string>,
        clientMap: Map<string, any>,
        context: ImportContext
    ): {
        shipments: Shipment[];
        containerDataMap: Map<Shipment, ContainerData[]>;
    } {
        const containerDataMap = new Map<Shipment, ContainerData[]>();

        const shipments = rows.map((row) => {
            const data: any = {
                tenantId: context.actorTenantId,
                organizationId: context.actorOrgId,
            };

            let containerNumbers: string[] = [];
            let containerType: ContainerType | undefined;

            columns.forEach((column, colIndex) => {
                const value = row[colIndex];
                if (value == null) return;

                let processedValue = value;

                // Extract container numbers (comma-separated)
                if (column.mappedName === 'containerNumber' && typeof value === 'string') {
                    containerNumbers = value.split(/[,;]/).map(c => c.trim()).filter(Boolean);
                    // Keep first container in shipment for backward compatibility
                    processedValue = containerNumbers[0] || value;
                }

                // Extract container type
                if (column.mappedName === 'containerType' && typeof value === 'string') {
                    containerType = value.trim() as ContainerType;
                }

                // Apply carrier mapping
                if (column.mappedName === 'carrier' && typeof value === 'string') {
                    processedValue = carrierMappings[value.trim()] || value;
                }

                // Apply status mapping
                if (column.mappedName === 'status' && typeof value === 'string') {
                    processedValue = statusMappings[value.trim()] || value;
                }

                // Parse dates
                if (column.dataType === 'date') {
                    if (value instanceof Date) {
                        processedValue = value;
                    } else if (typeof value === 'number') {
                        processedValue = new Date((value - 25569) * 86400 * 1000);
                    }
                }

                // Map to field
                if (column.mappedName) {
                    data[column.mappedName] = processedValue;
                }
            });

            // Default status if not provided
            if (!data.status) {
                data.status = ShipmentStatus.BOOKED;
            }

            // Assign client if available
            if (data.clientName) {
                const client = clientMap.get(data.clientName.trim().toLowerCase());
                if (client) {
                    data.client = client;
                }
            }

            const shipment = this.em.create(Shipment, data);

            // Store container data for this shipment
            if (containerNumbers.length > 0) {
                const containers = containerNumbers.map(num => ({
                    containerNumber: num,
                    containerType
                }));
                containerDataMap.set(shipment, containers);
            }

            return shipment;
        });

        return { shipments, containerDataMap };
    }

    /**
     * Create ShipmentContainer entities from extracted container data
     */
    private createShipmentContainers(
        shipments: Shipment[],
        containerDataMap: Map<Shipment, ContainerData[]>
    ): ShipmentContainer[] {
        const containers: ShipmentContainer[] = [];

        shipments.forEach((shipment) => {
            const containerData = containerDataMap.get(shipment);
            if (!containerData || containerData.length === 0) return;

            containerData.forEach((data) => {
                const container = this.em.create(ShipmentContainer, {
                    tenantId: shipment.tenantId,
                    organizationId: shipment.organizationId,
                    shipment,
                    containerNumber: data.containerNumber,
                    containerType: data.containerType,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                containers.push(container);
            });
        });

        return containers;
    }
}