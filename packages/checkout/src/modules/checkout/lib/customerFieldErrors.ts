export function readCustomerFieldsSectionError(errors: Record<string, string>): string | undefined {
  const directError = errors.customerFieldsSchema
  if (!directError) return undefined
  const hasNestedFieldErrors = Object.keys(errors).some((key) => key.startsWith('customerFieldsSchema.'))
  return hasNestedFieldErrors ? undefined : directError
}
