import type { CrudFormSectionAddress } from './form-section-facts'

function escapeScopeSegment(segment: string): string {
  return segment.replaceAll('%', '%25').replaceAll('/', '%2F')
}

export function crudFormSectionScope(
  address: Pick<CrudFormSectionAddress, 'hostId' | 'formVariant' | 'formOperation'>,
): string {
  const host = escapeScopeSegment(address.hostId)
  const variant = escapeScopeSegment(address.formVariant)
  return `${host}/${variant}/${address.formOperation}`
}
