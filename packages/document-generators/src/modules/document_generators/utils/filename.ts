export function buildDocumentFilename(
  data: Record<string, unknown>,
  prefix: string,
  extension: string,
): string {
  const number = (data.document as { number?: string } | undefined)?.number
  return number ? `${prefix}-${number}.${extension}` : `${prefix}.${extension}`
}
