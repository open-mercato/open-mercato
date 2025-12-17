import { uuid, z } from 'zod'


const scoped = z.object({
  organizationId: uuid(),
  tenantId: uuid(),
})

export const settingsUpsertSchema = scoped.extend({
  apiKey: z.string().min(1).max(100),
  apiBaseUrl: z.string().min(1).max(100),
})

export type SettingsUpsertInput = z.infer<typeof settingsUpsertSchema>

// Geolocation schema
const geolocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
})

// Location schema
const locationSchema = z.object({
  name: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  unlocode: z.string(),
  firms_cd: z.string().nullable(),
  bic_cd: z.string().nullable(),
  smdg_cd: z.string().nullable(),
  facility: z.string().nullable(),
  geolocation: geolocationSchema,
})

const journeyEventSchema = z.object({
  journey_type: z.string(),
  event_classifier: z.string(),
  event_type: z.string(),
  empty_indicator: z.string().optional(),
  transport_mode: z.string().optional(),
  facility_type: z.string().nullable().optional(),
  document_type: z.string().nullable().optional(),
})

const shipmentLocationSchema = z.object({
  type_code: z.string().nullable(),
})

const milestoneSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  location: locationSchema,
  description: z.string(),
  raw_description: z.string(),
  journey_event: journeyEventSchema,
  shipment_location: shipmentLocationSchema,
  vessel: z.string().nullable(),
  vessel_imo: z.string().nullable(),
  vessel_mmsi: z.string().nullable(),
  voyage: z.string().nullable(),
  planned: z.boolean(),
  mode: z.string().nullable(),
  source: z.string(),
})

const payloadSchema = z.object({
  reference_id: z.string(),
  bill_of_lading: z.string().nullable(),
  carrier_scac: z.string(),
  container_id: z.string(),
  container_iso: z.string(),
  milestones: z.array(milestoneSchema),
  inland_origin: locationSchema,
  origin_port: locationSchema,
  destination_port: locationSchema,
  inland_destination: locationSchema,
})

export const webhookSchema = z.object({
  id: z.string(),
  reference_id: z.string(),
  parent_reference_id: z.string().nullable(),
  status: z.string(),
  organization_id: z.string(),
  payload: payloadSchema,
  created_at: z.string(),
  updated_at: z.string(),
})

export const scopedWebhookSchema = scoped.extend({
  data: webhookSchema
})

export type ScopedWebhookInput = z.infer<typeof scopedWebhookSchema>
