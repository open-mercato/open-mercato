export function invoiceFilename(data: Record<string, unknown>, extension: 'pdf' | 'md'): string {
  const number = (data.document as { number?: string } | undefined)?.number
  return number ? `invoice-${number}.${extension}` : `invoice.${extension}`
}
