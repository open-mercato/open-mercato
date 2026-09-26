import { z } from 'zod'
import { SAUDI_STANDARD_VAT_RATE, SAUDI_VAT_NUMBER_PATTERN } from '../lib/saudi/vat'

/**
 * The ZATCA QR TLV carries one byte of length per value, so a seller name has to
 * fit in 255 UTF-8 bytes — which is 255 Latin characters but only 127 Arabic
 * ones. Validating bytes here means an unencodable name is rejected at the
 * settings screen instead of failing invoice generation months later.
 */
export const SAUDI_SELLER_NAME_MAX_BYTES = 255

const sellerNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => new TextEncoder().encode(value).length <= SAUDI_SELLER_NAME_MAX_BYTES, {
    message: `Must fit in ${SAUDI_SELLER_NAME_MAX_BYTES} UTF-8 bytes (the ZATCA QR limit)`,
  })

/** What the settings screen sends: a full replacement of the record. */
export const saudiVatSettingsInputSchema = z.object({
  sellerName: sellerNameSchema,
  vatRegistrationNumber: z
    .string()
    .trim()
    .regex(SAUDI_VAT_NUMBER_PATTERN, 'Must be 15 digits starting and ending with 3'),
  commercialRegistrationNumber: z
    .union([z.string().trim().min(1).max(20), z.null()])
    .optional()
    .transform((value) => value ?? null),
  vatRate: z.number().min(0).max(1).default(SAUDI_STANDARD_VAT_RATE),
  invoiceQrEnabled: z.boolean().default(true),
})

export type SaudiVatSettingsInput = z.infer<typeof saudiVatSettingsInputSchema>

/**
 * What is read back out of `module_configs`. Types only, no patterns: a value
 * stored by an older version must still be readable, and the VAT number is
 * validated where it is used (the QR builder re-checks it and fails loudly).
 */
export const saudiVatSettingsStoredSchema = z.object({
  sellerName: z.string().optional(),
  vatRegistrationNumber: z.string().optional(),
  commercialRegistrationNumber: z.string().nullish(),
  vatRate: z.number().min(0).max(1).optional(),
  invoiceQrEnabled: z.boolean().optional(),
})

export type SaudiVatSettingsStored = z.infer<typeof saudiVatSettingsStoredSchema>
