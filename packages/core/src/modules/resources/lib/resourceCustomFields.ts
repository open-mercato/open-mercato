import type { FieldSetInput } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { E } from '#generated/entities.ids.generated'
import { defineFields, cf } from '@open-mercato/shared/modules/dsl'

export const RESOURCES_RESOURCE_FIELDSET_DEFAULT = 'resources_resource_general'
export const RESOURCES_RESOURCE_FIELDSET_ROOM = 'resources_resource_room'
export const RESOURCES_RESOURCE_FIELDSET_LAPTOP = 'resources_resource_laptop'
export const RESOURCES_RESOURCE_FIELDSET_SEAT = 'resources_resource_seat'
export const RESOURCES_RESOURCE_FIELDSET_HAIR_KIT = 'resources_resource_hair_kit'
export const RESOURCES_RESOURCE_FIELDSET_DENTAL_CHAIR = 'resources_resource_dental_chair'

export const RESOURCES_RESOURCE_FIELDSETS = [
  {
    code: RESOURCES_RESOURCE_FIELDSET_DEFAULT,
    label: 'General',
    description: 'Shared operational details for any resource.',
    groups: [
      { code: 'identity', title: 'Identity' },
      { code: 'ownership', title: 'Ownership' },
      { code: 'notes', title: 'Notes' },
    ],
  },
  {
    code: RESOURCES_RESOURCE_FIELDSET_ROOM,
    label: 'Rooms',
    description: 'Space configuration, equipment, and access notes.',
    groups: [
      { code: 'location', title: 'Location' },
      { code: 'equipment', title: 'Equipment' },
      { code: 'access', title: 'Access' },
    ],
  },
  {
    code: RESOURCES_RESOURCE_FIELDSET_LAPTOP,
    label: 'Laptops',
    description: 'Hardware specifications and assigned software.',
    groups: [
      { code: 'hardware', title: 'Hardware' },
      { code: 'software', title: 'Software' },
      { code: 'accessories', title: 'Accessories' },
    ],
  },
  {
    code: RESOURCES_RESOURCE_FIELDSET_SEAT,
    label: 'Client seats',
    description: 'Comfort settings and service positioning details.',
    groups: [
      { code: 'comfort', title: 'Comfort' },
      { code: 'service', title: 'Service setup' },
    ],
  },
  {
    code: RESOURCES_RESOURCE_FIELDSET_HAIR_KIT,
    label: 'Hair kits',
    description: 'Inventory, maintenance, and restocking data.',
    groups: [
      { code: 'inventory', title: 'Inventory' },
      { code: 'maintenance', title: 'Maintenance' },
    ],
  },
  {
    code: RESOURCES_RESOURCE_FIELDSET_DENTAL_CHAIR,
    label: 'Dental chairs',
    description: 'Chair configuration, hygiene, and inspections.',
    groups: [
      { code: 'chair', title: 'Chair settings' },
      { code: 'hygiene', title: 'Hygiene' },
      { code: 'maintenance', title: 'Maintenance' },
    ],
  },
] as const

export const RESOURCES_RESOURCE_CUSTOM_FIELD_SETS: FieldSetInput[] = [
  defineFields(E.resources.resources_resource, [
    cf.text('asset_tag', {
      label: 'Asset tag',
      description: 'Internal tracking tag or code.',
      filterable: true,
      fieldset: RESOURCES_RESOURCE_FIELDSET_DEFAULT,
      group: { code: 'identity' },
    }),
    cf.text('owner', {
      label: 'Owner',
      fieldset: RESOURCES_RESOURCE_FIELDSET_DEFAULT,
      group: { code: 'ownership' },
    }),
    cf.text('warranty_expires', {
      label: 'Warranty expires',
      description: 'YYYY-MM-DD',
      fieldset: RESOURCES_RESOURCE_FIELDSET_DEFAULT,
      group: { code: 'ownership' },
    }),
    cf.multiline('ops_notes', {
      label: 'Operational notes',
      editor: 'markdown',
      fieldset: RESOURCES_RESOURCE_FIELDSET_DEFAULT,
      group: { code: 'notes' },
    }),
  ]),
  defineFields(E.resources.resources_resource, [
    cf.text('room_floor', {
      label: 'Floor',
      fieldset: RESOURCES_RESOURCE_FIELDSET_ROOM,
      group: { code: 'location' },
    }),
    cf.text('room_zone', {
      label: 'Zone',
      fieldset: RESOURCES_RESOURCE_FIELDSET_ROOM,
      group: { code: 'location' },
    }),
    cf.boolean('room_projector', {
      label: 'Projector available',
      fieldset: RESOURCES_RESOURCE_FIELDSET_ROOM,
      group: { code: 'equipment' },
    }),
    cf.boolean('room_whiteboard', {
      label: 'Whiteboard available',
      fieldset: RESOURCES_RESOURCE_FIELDSET_ROOM,
      group: { code: 'equipment' },
    }),
    cf.multiline('room_access_notes', {
      label: 'Access notes',
      editor: 'markdown',
      fieldset: RESOURCES_RESOURCE_FIELDSET_ROOM,
      group: { code: 'access' },
    }),
  ]),
  defineFields(E.resources.resources_resource, [
    cf.text('laptop_serial', {
      label: 'Serial number',
      fieldset: RESOURCES_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'hardware' },
      filterable: true,
    }),
    cf.text('laptop_cpu', {
      label: 'CPU model',
      fieldset: RESOURCES_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'hardware' },
    }),
    cf.integer('laptop_ram_gb', {
      label: 'RAM (GB)',
      fieldset: RESOURCES_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'hardware' },
    }),
    cf.integer('laptop_storage_gb', {
      label: 'Storage (GB)',
      fieldset: RESOURCES_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'hardware' },
    }),
    cf.select('laptop_os', ['windows', 'macos', 'linux', 'chrome_os'], {
      label: 'Operating system',
      fieldset: RESOURCES_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'software' },
    }),
    cf.multiline('laptop_accessories', {
      label: 'Accessories',
      editor: 'markdown',
      fieldset: RESOURCES_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'accessories' },
    }),
  ]),
  defineFields(E.resources.resources_resource, [
    cf.select('seat_style', ['standard', 'reclining', 'barber', 'massage'], {
      label: 'Seat style',
      fieldset: RESOURCES_RESOURCE_FIELDSET_SEAT,
      group: { code: 'comfort' },
    }),
    cf.boolean('seat_heated', {
      label: 'Heated seat',
      fieldset: RESOURCES_RESOURCE_FIELDSET_SEAT,
      group: { code: 'comfort' },
    }),
    cf.text('seat_positioning', {
      label: 'Positioning notes',
      fieldset: RESOURCES_RESOURCE_FIELDSET_SEAT,
      group: { code: 'service' },
    }),
  ]),
  defineFields(E.resources.resources_resource, [
    cf.text('kit_inventory', {
      label: 'Inventory list',
      fieldset: RESOURCES_RESOURCE_FIELDSET_HAIR_KIT,
      group: { code: 'inventory' },
    }),
    cf.text('kit_restock_cycle', {
      label: 'Restock cycle',
      fieldset: RESOURCES_RESOURCE_FIELDSET_HAIR_KIT,
      group: { code: 'inventory' },
    }),
    cf.multiline('kit_maintenance', {
      label: 'Maintenance notes',
      editor: 'markdown',
      fieldset: RESOURCES_RESOURCE_FIELDSET_HAIR_KIT,
      group: { code: 'maintenance' },
    }),
  ]),
  defineFields(E.resources.resources_resource, [
    cf.text('chair_model', {
      label: 'Model',
      fieldset: RESOURCES_RESOURCE_FIELDSET_DENTAL_CHAIR,
      group: { code: 'chair' },
    }),
    cf.boolean('chair_ultrasonic', {
      label: 'Ultrasonic scaler',
      fieldset: RESOURCES_RESOURCE_FIELDSET_DENTAL_CHAIR,
      group: { code: 'chair' },
    }),
    cf.text('chair_last_disinfected', {
      label: 'Last disinfected',
      fieldset: RESOURCES_RESOURCE_FIELDSET_DENTAL_CHAIR,
      group: { code: 'hygiene' },
    }),
    cf.multiline('chair_inspection_notes', {
      label: 'Inspection notes',
      editor: 'markdown',
      fieldset: RESOURCES_RESOURCE_FIELDSET_DENTAL_CHAIR,
      group: { code: 'maintenance' },
    }),
  ]),
]

function normalizeName(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

export function resolveResourcesResourceFieldsetCode(name?: string | null): string {
  const normalized = normalizeName(name)
  if (!normalized) return RESOURCES_RESOURCE_FIELDSET_DEFAULT
  if (normalized.includes('laptop')) return RESOURCES_RESOURCE_FIELDSET_LAPTOP
  if (normalized.includes('room')) return RESOURCES_RESOURCE_FIELDSET_ROOM
  if (normalized.includes('seat')) return RESOURCES_RESOURCE_FIELDSET_SEAT
  if (normalized.includes('hair')) return RESOURCES_RESOURCE_FIELDSET_HAIR_KIT
  if (normalized.includes('dental')) return RESOURCES_RESOURCE_FIELDSET_DENTAL_CHAIR
  return RESOURCES_RESOURCE_FIELDSET_DEFAULT
}
