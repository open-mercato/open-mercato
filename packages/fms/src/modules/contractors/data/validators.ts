import { z } from 'zod'

const scoped = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

export const contractorAddressPurposes = ['office', 'warehouse', 'billing', 'shipping', 'other'] as const
export const contractorRoleCategories = ['trading', 'carrier', 'intermediary', 'facility'] as const
export const paymentMethods = ['bank_transfer', 'card', 'cash'] as const

export const contractorCreateSchema = z.object({
  name: z.string().min(1).max(255),
  shortName: z.string().max(50).optional().nullable(),
  code: z.string().max(50).optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
  taxId: z.string().max(50).optional().nullable(),
  legalName: z.string().max(255).optional().nullable(),
  registrationNumber: z.string().max(100).optional().nullable(),
  isActive: z.boolean().optional().default(true),
})
export type ContractorCreateInput = z.infer<typeof contractorCreateSchema>

export const contractorUpdateSchema = contractorCreateSchema.partial()
export type ContractorUpdateInput = z.infer<typeof contractorUpdateSchema>

export const scopedContractorCreateSchema = scoped.extend({
  data: contractorCreateSchema,
})
export type ScopedContractorCreateInput = z.infer<typeof scopedContractorCreateSchema>

export const contractorAddressCreateSchema = z.object({
  purpose: z.enum(contractorAddressPurposes),
  label: z.string().max(100).optional().nullable(),
  addressLine1: z.string().min(1).max(255),
  addressLine2: z.string().max(255).optional().nullable(),
  city: z.string().min(1).max(100),
  state: z.string().max(100).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  countryCode: z.string().length(2),
  isPrimary: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
})
export type ContractorAddressCreateInput = z.infer<typeof contractorAddressCreateSchema>

export const contractorAddressUpdateSchema = contractorAddressCreateSchema.partial()
export type ContractorAddressUpdateInput = z.infer<typeof contractorAddressUpdateSchema>

export const contractorContactCreateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  jobTitle: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  mobile: z.string().max(50).optional().nullable(),
  isPrimary: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  notes: z.string().max(1000).optional().nullable(),
})
export type ContractorContactCreateInput = z.infer<typeof contractorContactCreateSchema>

export const contractorContactUpdateSchema = contractorContactCreateSchema.partial()
export type ContractorContactUpdateInput = z.infer<typeof contractorContactUpdateSchema>

export const contractorRoleTypeCreateSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  category: z.enum(contractorRoleCategories),
  description: z.string().max(500).optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  icon: z.string().max(50).optional().nullable(),
  hasCustomFields: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(0),
  isSystem: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
})
export type ContractorRoleTypeCreateInput = z.infer<typeof contractorRoleTypeCreateSchema>

export const contractorRoleTypeUpdateSchema = contractorRoleTypeCreateSchema.partial().omit({ code: true })
export type ContractorRoleTypeUpdateInput = z.infer<typeof contractorRoleTypeUpdateSchema>

export const contractorRoleAssignSchema = z.object({
  roleTypeId: z.string().uuid(),
  settings: z.record(z.unknown()).optional().nullable(),
  isActive: z.boolean().optional().default(true),
  effectiveFrom: z.coerce.date().optional().nullable(),
  effectiveTo: z.coerce.date().optional().nullable(),
})
export type ContractorRoleAssignInput = z.infer<typeof contractorRoleAssignSchema>

export const contractorRoleUpdateSchema = contractorRoleAssignSchema.partial().omit({ roleTypeId: true })
export type ContractorRoleUpdateInput = z.infer<typeof contractorRoleUpdateSchema>

export const contractorPaymentTermsUpsertSchema = z.object({
  paymentDays: z.number().int().min(0).max(365).optional().default(30),
  paymentMethod: z.enum(paymentMethods).optional().nullable(),
  currencyCode: z.string().length(3).optional().default('USD'),
  bankName: z.string().max(255).optional().nullable(),
  bankAccountNumber: z.string().max(50).optional().nullable(),
  bankRoutingNumber: z.string().max(50).optional().nullable(),
  iban: z.string().max(50).optional().nullable(),
  swiftBic: z.string().max(20).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})
export type ContractorPaymentTermsUpsertInput = z.infer<typeof contractorPaymentTermsUpsertSchema>

export const contractorCreditLimitUpsertSchema = z.object({
  creditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currencyCode: z.string().length(3).optional().default('USD'),
  isUnlimited: z.boolean().optional().default(false),
  requiresApprovalAbove: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})
export type ContractorCreditLimitUpsertInput = z.infer<typeof contractorCreditLimitUpsertSchema>

export const contractorListQuerySchema = z.object({
  search: z.string().optional(),
  roleCategory: z.enum(contractorRoleCategories).optional(),
  roleTypeId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  country: z.string().length(2).optional(),
  hasParent: z.coerce.boolean().optional(),
  creditExceeded: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  sortBy: z.string().optional().default('name'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
})
export type ContractorListQueryInput = z.infer<typeof contractorListQuerySchema>
