import { z } from 'zod'

export const lineRevenueAccountInputSchema = z.object({
  salesInvoiceLineId: z.uuid(),
  accountId: z.uuid(),
})

/**
 * Input shape of `postSalesInvoiceToLedger`. Only the shape is checked here:
 * an empty or duplicated assignment list, a line outside the invoice and an
 * account outside the posting's organization are business rejections the
 * command answers with 422 (`INVALID_LINE_ACCOUNTS`, `ACCOUNT_OUT_OF_SCOPE`),
 * because they need the invoice and the organization's chart to decide.
 */
export const postSalesInvoiceToLedgerSchema = z.object({
  salesInvoiceId: z.uuid(),
  lineAccounts: z.array(lineRevenueAccountInputSchema),
  contractorId: z.uuid().optional(),
})

export type LineRevenueAccountInput = z.infer<typeof lineRevenueAccountInputSchema>
export type PostSalesInvoiceToLedgerInput = z.infer<typeof postSalesInvoiceToLedgerSchema>
