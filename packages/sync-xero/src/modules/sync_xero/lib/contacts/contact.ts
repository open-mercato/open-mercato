import { z } from 'zod'

const optionalText = z.string().nullable().optional()

const xeroPhoneSchema = z
  .object({
    PhoneType: optionalText,
    PhoneNumber: optionalText,
    PhoneAreaCode: optionalText,
    PhoneCountryCode: optionalText,
  })
  .passthrough()

const xeroAddressSchema = z
  .object({
    AddressType: optionalText,
    AddressLine1: optionalText,
    AddressLine2: optionalText,
    AddressLine3: optionalText,
    AddressLine4: optionalText,
    City: optionalText,
    Region: optionalText,
    PostalCode: optionalText,
    Country: optionalText,
  })
  .passthrough()

/** The Contact fields the Contacts run reads (Xero's OpenAPI `Contact`); everything else passes through untouched. */
export const xeroContactSchema = z
  .object({
    ContactID: z.string().min(1),
    Name: optionalText,
    EmailAddress: optionalText,
    Website: optionalText,
    TaxNumber: optionalText,
    CompanyNumber: optionalText,
    ContactStatus: optionalText,
    MergedToContactID: optionalText,
    IsCustomer: z.boolean().nullable().optional(),
    IsSupplier: z.boolean().nullable().optional(),
    Phones: z.array(xeroPhoneSchema).nullable().optional(),
    Addresses: z.array(xeroAddressSchema).nullable().optional(),
  })
  .passthrough()

export type XeroContact = z.infer<typeof xeroContactSchema>
export type XeroPhone = z.infer<typeof xeroPhoneSchema>
export type XeroAddress = z.infer<typeof xeroAddressSchema>

export function parseXeroContact(record: unknown): XeroContact | null {
  const parsed = xeroContactSchema.safeParse(record)
  return parsed.success ? parsed.data : null
}

export function nonBlank(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
