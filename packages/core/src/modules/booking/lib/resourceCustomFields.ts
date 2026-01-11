import type { FieldSetInput } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { defineFields, cf } from '@/modules/dsl'

export const BOOKING_RESOURCE_FIELDSET_DEFAULT = 'booking_resource_general'
export const BOOKING_RESOURCE_FIELDSET_ROOM = 'booking_resource_room'
export const BOOKING_RESOURCE_FIELDSET_LAPTOP = 'booking_resource_laptop'
export const BOOKING_RESOURCE_FIELDSET_SEAT = 'booking_resource_seat'
export const BOOKING_RESOURCE_FIELDSET_HAIR_KIT = 'booking_resource_hair_kit'
export const BOOKING_RESOURCE_FIELDSET_DENTAL_CHAIR = 'booking_resource_dental_chair'

export const BOOKING_RESOURCE_FIELDSETS = [
  {
    code: BOOKING_RESOURCE_FIELDSET_DEFAULT,
    label: 'General',
    description: 'Shared operational details for any resource.',
    groups: [
      { code: 'identity', title: 'Identity' },
      { code: 'ownership', title: 'Ownership' },
      { code: 'notes', title: 'Notes' },
    ],
  },
  {
    code: BOOKING_RESOURCE_FIELDSET_ROOM,
    label: 'Rooms',
    description: 'Space configuration, equipment, and access notes.',
    groups: [
      { code: 'location', title: 'Location' },
      { code: 'equipment', title: 'Equipment' },
      { code: 'access', title: 'Access' },
    ],
  },
  {
    code: BOOKING_RESOURCE_FIELDSET_LAPTOP,
    label: 'Laptops',
    description: 'Hardware specifications and assigned software.',
    groups: [
      { code: 'hardware', title: 'Hardware' },
      { code: 'software', title: 'Software' },
      { code: 'accessories', title: 'Accessories' },
    ],
  },
  {
    code: BOOKING_RESOURCE_FIELDSET_SEAT,
    label: 'Client seats',
    description: 'Comfort settings and service positioning details.',
    groups: [
      { code: 'comfort', title: 'Comfort' },
      { code: 'service', title: 'Service setup' },
    ],
  },
  {
    code: BOOKING_RESOURCE_FIELDSET_HAIR_KIT,
    label: 'Hair kits',
    description: 'Inventory, maintenance, and restocking data.',
    groups: [
      { code: 'inventory', title: 'Inventory' },
      { code: 'maintenance', title: 'Maintenance' },
    ],
  },
  {
    code: BOOKING_RESOURCE_FIELDSET_DENTAL_CHAIR,
    label: 'Dental chairs',
    description: 'Chair configuration, hygiene, and inspections.',
    groups: [
      { code: 'chair', title: 'Chair settings' },
      { code: 'hygiene', title: 'Hygiene' },
      { code: 'maintenance', title: 'Maintenance' },
    ],
  },
] as const

export const BOOKING_RESOURCE_CUSTOM_FIELD_SETS: FieldSetInput[] = [
  defineFields(E.booking.booking_resource, [
    cf.text('asset_tag', {
      label: 'Asset tag',
      description: 'Internal tracking tag or code.',
      filterable: true,
      fieldset: BOOKING_RESOURCE_FIELDSET_DEFAULT,
      group: { code: 'identity' },
    }),
    cf.text('owner', {
      label: 'Owner',
      fieldset: BOOKING_RESOURCE_FIELDSET_DEFAULT,
      group: { code: 'ownership' },
    }),
    cf.text('warranty_expires', {
      label: 'Warranty expires',
      description: 'YYYY-MM-DD',
      fieldset: BOOKING_RESOURCE_FIELDSET_DEFAULT,
      group: { code: 'ownership' },
    }),
    cf.multiline('ops_notes', {
      label: 'Operational notes',
      editor: 'markdown',
      fieldset: BOOKING_RESOURCE_FIELDSET_DEFAULT,
      group: { code: 'notes' },
    }),
  ]),
  defineFields(E.booking.booking_resource, [
    cf.text('room_floor', {
      label: 'Floor',
      fieldset: BOOKING_RESOURCE_FIELDSET_ROOM,
      group: { code: 'location' },
    }),
    cf.text('room_zone', {
      label: 'Zone',
      fieldset: BOOKING_RESOURCE_FIELDSET_ROOM,
      group: { code: 'location' },
    }),
    cf.boolean('room_projector', {
      label: 'Projector available',
      fieldset: BOOKING_RESOURCE_FIELDSET_ROOM,
      group: { code: 'equipment' },
    }),
    cf.boolean('room_whiteboard', {
      label: 'Whiteboard available',
      fieldset: BOOKING_RESOURCE_FIELDSET_ROOM,
      group: { code: 'equipment' },
    }),
    cf.multiline('room_access_notes', {
      label: 'Access notes',
      editor: 'markdown',
      fieldset: BOOKING_RESOURCE_FIELDSET_ROOM,
      group: { code: 'access' },
    }),
  ]),
  defineFields(E.booking.booking_resource, [
    cf.text('laptop_serial', {
      label: 'Serial number',
      fieldset: BOOKING_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'hardware' },
      filterable: true,
    }),
    cf.text('laptop_cpu', {
      label: 'CPU model',
      fieldset: BOOKING_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'hardware' },
    }),
    cf.integer('laptop_ram_gb', {
      label: 'RAM (GB)',
      fieldset: BOOKING_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'hardware' },
    }),
    cf.integer('laptop_storage_gb', {
      label: 'Storage (GB)',
      fieldset: BOOKING_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'hardware' },
    }),
    cf.select('laptop_os', ['windows', 'macos', 'linux', 'chrome_os'], {
      label: 'Operating system',
      fieldset: BOOKING_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'software' },
    }),
    cf.multiline('laptop_accessories', {
      label: 'Accessories',
      editor: 'markdown',
      fieldset: BOOKING_RESOURCE_FIELDSET_LAPTOP,
      group: { code: 'accessories' },
    }),
  ]),
  defineFields(E.booking.booking_resource, [
    cf.select('seat_style', ['standard', 'reclining', 'barber', 'massage'], {
      label: 'Seat style',
      fieldset: BOOKING_RESOURCE_FIELDSET_SEAT,
      group: { code: 'comfort' },
    }),
    cf.boolean('seat_heated', {
      label: 'Heated seat',
      fieldset: BOOKING_RESOURCE_FIELDSET_SEAT,
      group: { code: 'comfort' },
    }),
    cf.text('seat_positioning', {
      label: 'Positioning notes',
      fieldset: BOOKING_RESOURCE_FIELDSET_SEAT,
      group: { code: 'service' },
    }),
  ]),
  defineFields(E.booking.booking_resource, [
    cf.text('kit_inventory', {
      label: 'Inventory list',
      fieldset: BOOKING_RESOURCE_FIELDSET_HAIR_KIT,
      group: { code: 'inventory' },
    }),
    cf.text('kit_restock_cycle', {
      label: 'Restock cycle',
      fieldset: BOOKING_RESOURCE_FIELDSET_HAIR_KIT,
      group: { code: 'inventory' },
    }),
    cf.multiline('kit_maintenance', {
      label: 'Maintenance notes',
      editor: 'markdown',
      fieldset: BOOKING_RESOURCE_FIELDSET_HAIR_KIT,
      group: { code: 'maintenance' },
    }),
  ]),
  defineFields(E.booking.booking_resource, [
    cf.text('chair_model', {
      label: 'Model',
      fieldset: BOOKING_RESOURCE_FIELDSET_DENTAL_CHAIR,
      group: { code: 'chair' },
    }),
    cf.boolean('chair_ultrasonic', {
      label: 'Ultrasonic scaler',
      fieldset: BOOKING_RESOURCE_FIELDSET_DENTAL_CHAIR,
      group: { code: 'chair' },
    }),
    cf.text('chair_last_disinfected', {
      label: 'Last disinfected',
      fieldset: BOOKING_RESOURCE_FIELDSET_DENTAL_CHAIR,
      group: { code: 'hygiene' },
    }),
    cf.multiline('chair_inspection_notes', {
      label: 'Inspection notes',
      editor: 'markdown',
      fieldset: BOOKING_RESOURCE_FIELDSET_DENTAL_CHAIR,
      group: { code: 'maintenance' },
    }),
  ]),
]

function normalizeName(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

export function resolveBookingResourceFieldsetCode(name?: string | null): string {
  const normalized = normalizeName(name)
  if (!normalized) return BOOKING_RESOURCE_FIELDSET_DEFAULT
  if (normalized.includes('laptop')) return BOOKING_RESOURCE_FIELDSET_LAPTOP
  if (normalized.includes('room')) return BOOKING_RESOURCE_FIELDSET_ROOM
  if (normalized.includes('seat')) return BOOKING_RESOURCE_FIELDSET_SEAT
  if (normalized.includes('hair')) return BOOKING_RESOURCE_FIELDSET_HAIR_KIT
  if (normalized.includes('dental')) return BOOKING_RESOURCE_FIELDSET_DENTAL_CHAIR
  return BOOKING_RESOURCE_FIELDSET_DEFAULT
}
