// src/modules/shipments/acl.ts
// src/modules/shipments/acl.ts
export const features = [
    { id: 'shipments.shipments.view', label: 'View Shipments' },
    { id: 'shipments.shipments.create', label: 'Create Shipments' },
    { id: 'shipments.shipments.edit', label: 'Edit Shipments' },
    { id: 'shipments.shipments.delete', label: 'Delete Shipments' },
    { id: 'shipments.import', label: 'Import Shipments from Excel' },
] as const;

export const roles = [
    {
        id: 'shipments_operator',
        label: 'Shipments Operator',
        features: [
            'shipments.shipments.view',
            'shipments.shipments.create',
            'shipments.shipments.edit',
            'shipments.import'
        ]
    },
    {
        id: 'shipments_manager',
        label: 'Shipments Manager',
        features: [
            'shipments.shipments.view',
            'shipments.shipments.create',
            'shipments.shipments.edit',
            'shipments.shipments.delete',
            'shipments.import'
        ]
    }
];

export default features