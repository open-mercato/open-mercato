import { z } from 'zod'

const uuid = () => z.string().uuid()

export const incomingShipmentStatusSchema = z.enum(['draft', 'registered'])
export type IncomingShipmentStatusInput = z.infer<typeof incomingShipmentStatusSchema>

export const incomingShipmentDeliveryMethodSchema = z.enum(['paper', 'epuap', 'email'])
export type IncomingShipmentDeliveryMethodInput = z.infer<typeof incomingShipmentDeliveryMethodSchema>

export const accessLevelSchema = z.enum(['public', 'restricted', 'private'])
export type AccessLevelInput = z.infer<typeof accessLevelSchema>

export const mappingCoverageSchema = z.enum(['none', 'partial', 'full'])
export type MappingCoverageInput = z.infer<typeof mappingCoverageSchema>

export const incomingShipmentCreateSchema = z
  .object({
    receivingOrgUnitId: uuid(),
    receivingOrgUnitSymbol: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(/^[A-Za-z0-9_\-]+$/, 'receivingOrgUnitSymbol must contain only letters, digits, _ or -'),
    subject: z.string().trim().min(1).max(2000),
    senderId: uuid().optional(),
    senderDisplayName: z.string().trim().min(1).max(400).optional(),
    senderAnonymous: z.boolean().optional(),
    receivedAt: z.coerce.date().optional(),
    deliveryMethod: incomingShipmentDeliveryMethodSchema,
    attachmentIds: z.array(uuid()).optional(),
    postedAt: z.coerce.date().optional(),
    senderReference: z.string().trim().max(200).optional(),
    remarks: z.string().trim().max(4000).optional(),
    documentDate: z.coerce.date().optional(),
    noDocumentDate: z.boolean().optional(),
    documentSign: z.string().trim().max(200).optional(),
    noDocumentSign: z.boolean().optional(),
    accessLevel: accessLevelSchema.optional(),
    hasChronologicalRegistration: z.boolean().optional(),
    mappingCoverage: mappingCoverageSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((payload, ctx) => {
    const senderAnonymous = payload.senderAnonymous === true
    const hasSenderId = typeof payload.senderId === 'string' && payload.senderId.length > 0
    const hasDisplayName = typeof payload.senderDisplayName === 'string' && payload.senderDisplayName.trim().length > 0
    if (senderAnonymous) {
      if (!hasDisplayName) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'senderDisplayName is required when senderAnonymous=true', path: ['senderDisplayName'] })
      }
      return
    }
    if (!hasSenderId && !hasDisplayName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide senderId or senderDisplayName', path: ['senderId'] })
    }
  })

export const incomingShipmentUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(incomingShipmentCreateSchema.partial())

export const jrwaClassCreateSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(500),
  parentId: uuid().nullable().optional(),
  retentionYears: z.coerce.number().int().min(0).max(200).nullable().optional(),
  retentionCategory: z.string().trim().max(20).nullable().optional(),
  version: z.coerce.number().int().min(1).max(10_000).optional(),
  isActive: z.boolean().optional(),
})

export const jrwaClassUpdateSchema = z
  .object({
    id: uuid(),
  })
  .merge(jrwaClassCreateSchema.partial())
