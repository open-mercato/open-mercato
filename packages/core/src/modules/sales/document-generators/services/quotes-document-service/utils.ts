export function offerFilename(data: Record<string, unknown>): string {
  const number = (data.document as { number?: string } | undefined)?.number
  return number ? `offer-${number}.pdf` : 'offer.pdf'
}
