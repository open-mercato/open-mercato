//@ts-nocheck
// Simplified shipments API route for POC
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory';
import { Shipment } from '../data/entities';
import { E as ES } from '../../../../generated/entities.ids.generated';

import * as FS from '../../../../generated/entities/shipment';
import {
    createShipmentSchema,
    updateShipmentSchema,
    queryShipmentSchema
} from '../data/validators';
import { EntityManager } from '@mikro-orm/core';

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
    metadata: {
        GET: { requireAuth: true, requireFeatures: ['shipments.shipments.view'] },
        POST: { requireAuth: true, requireFeatures: ['shipments.shipments.create'] },
        PUT: { requireAuth: true, requireFeatures: ['shipments.shipments.edit'] },
        DELETE: { requireAuth: true, requireFeatures: ['shipments.shipments.delete'] },
    },

    orm: {
        entity: Shipment,
        idField: 'id',
        tenantField: 'tenantId',
        orgField: 'organizationId',
        softDeleteField: null
    },

    list: {
        schema: queryShipmentSchema,
        entityId: ES.shipments.shipment,
        fields: [],
        sortFieldMap: {
            createdAt: FS.created_at,
            updatedAt: FS.updated_at,
            eta: FS.eta,
            etd: FS.etd,
            ata: FS.ata,
            atd: FS.atd
        },
        buildFilters: (query) => {
            const filters: any[] = [];

            if (query.status) {
                filters.push({ field: FS.status, op: 'eq', value: query.status });
            }

            if (query.containerType) {
                filters.push({ field: FS.container_type, op: 'eq', value: query.containerType });
            }

            if (query.clientId) {
                filters.push({ field: FS.client, op: 'eq', value: query.clientId });
            }

            if (query.assignedToId) {
                filters.push({ field: FS.assigned_to, op: 'eq', value: query.assignedToId });
            }

            if (query.search) {
                filters.push({
                    op: 'or',
                    filters: [
                        { field: FS.internal_reference, op: 'ilike', value: `%${query.search}%` },
                        { field: FS.booking_number, op: 'ilike', value: `%${query.search}%` },
                        { field: FS.container_number, op: 'ilike', value: `%${query.search}%` }
                    ]
                });
            }

            return filters;
        }
    },

    hooks: {
        afterList: async (payload, ctx) => {
            const items = Array.isArray(payload.items) ? payload.items : []
            if (!items.length) return

            const em = ctx.container.resolve('em') as EntityManager

            // Collect unique IDs
            const companyIds = new Set<string>()
            const userIds = new Set<string>()

            items.forEach((item: any) => {
                if (item.client_id) companyIds.add(item.client_id)
                if (item.created_by_id) userIds.add(item.created_by_id)
                if (item.assigned_to_id) userIds.add(item.assigned_to_id)
            })

            // Batch fetch
            const [companies, users] = await Promise.all([
                companyIds.size ? em.find('CustomerEntity', { id: { $in: Array.from(companyIds) } }) : [],
                userIds.size ? em.find('User', { id: { $in: Array.from(userIds) } }) : [],
            ])

            // Build maps
            const companyMap = new Map(companies.map((c: any) => [c.id, c]))
            const userMap = new Map(users.map((u: any) => [u.id, u]))

            // Enhance items
            payload.items = items.map((item: any) => {
                const client = item.client_id ? companyMap.get(item.client_id) : null
                const createdBy = item.created_by_id ? userMap.get(item.created_by_id) : null
                const assignedTo = item.assigned_to_id ? userMap.get(item.assigned_to_id) : null

                return {
                    ...item,
                    bookingNumber: item.booking_number,
                    containerNumber: item.container_number,
                    internalReference: item.internal_reference,
                    client: client ? {
                        id: client.id,
                        display_name: client.displayName,
                        primary_email: client.primaryEmail,
                    } : null,
                    createdBy: createdBy ? {
                        id: createdBy.id,
                        email: createdBy.email,
                        display_name: createdBy.displayName,
                    } : null,
                    assignedTo: assignedTo ? {
                        id: assignedTo.id,
                        email: assignedTo.email,
                        display_name: assignedTo.displayName,
                    } : null,
                }
            })
        },
        beforeCreate: async (input, ctx) => {
            input.tenantId = ctx!.auth!.actorTenantId as string;
            input.organizationId = ctx!.auth!.actorOrgId as string;

            return input;
        }
    },

    create: {
        schema: createShipmentSchema,
        mapToEntity: (input) => {
            const { clientId, createdById, assignedToId, ...rest } = input;
            return {
                ...rest,
                client: clientId,
                createdBy: createdById,
                assignedTo: assignedToId
            };
        }
    },

    update: {
        schema: updateShipmentSchema,
        applyToEntity: (entity, input) => {
            const { clientId, assignedToId, ...rest } = input;
            console.log('Updating shipment entity with input:', input);
            Object.assign(entity, rest);

            if (clientId !== undefined) {
                entity.client = clientId as any;
            }

            if (assignedToId !== undefined) {
                entity.assignedTo = assignedToId as any;
            }

            entity.updatedAt = new Date();
        }
    },

    del: {
        softDelete: false
    },

    events: {
        module: 'shipments',
        entity: 'shipment',
        persistent: true
    }
});