type DocumentMetadata = Record<string, unknown> | null | undefined

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function sameEmail(left: string | null, right: string | null): boolean {
  return (left ?? '').toLowerCase() === (right ?? '').toLowerCase()
}

/** The document's own "Send to" address, or null when it has none. */
export function readDocumentEmail(metadata: DocumentMetadata): string | null {
  return normalizedEmail(metadata?.customerEmail)
}

function withDocumentEmail(metadata: DocumentMetadata, email: string | null): Record<string, unknown> | null {
  const rest = Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => key !== 'customerEmail'))
  if (email) return { ...rest, customerEmail: email }
  return Object.keys(rest).length ? rest : null
}

/**
 * The create form copies the customer's e-mail into `metadata.customerEmail`, and that field
 * outranks the snapshot when a document is sent (#8459). A copy still equal to the old snapshot
 * e-mail therefore has to follow an edit, or the edited address would never be used. A different
 * value is an explicit "Send to" and stays. Returns undefined when the metadata needs no change.
 */
export function syncDocumentEmailWithSnapshot(
  metadata: DocumentMetadata,
  previousSnapshotEmail: string | null | undefined,
  nextSnapshotEmail: string | null | undefined,
): Record<string, unknown> | null | undefined {
  const documentEmail = readDocumentEmail(metadata)
  const previous = normalizedEmail(previousSnapshotEmail)
  const next = normalizedEmail(nextSnapshotEmail)
  if (!documentEmail || !previous || sameEmail(previous, next)) return undefined
  if (!sameEmail(documentEmail, previous)) return undefined
  return withDocumentEmail(metadata, next)
}

/**
 * Metadata for a document moving to another customer. A given e-mail becomes the new "Send to";
 * without one the previous customer's address must go, or the document would keep sending to it.
 * Returns undefined when the metadata needs no change.
 */
export function documentEmailForCustomerChange(
  metadata: DocumentMetadata,
  email: string | null | undefined,
  customerChanged: boolean,
): Record<string, unknown> | null | undefined {
  const nextEmail = normalizedEmail(email)
  if (nextEmail) return withDocumentEmail(metadata, nextEmail)
  if (customerChanged && readDocumentEmail(metadata)) return withDocumentEmail(metadata, null)
  return undefined
}

/**
 * The recipient after saving a document. The server's `contactEmail` is authoritative, including
 * an explicit null once the address is gone; `fallback` only covers a response without the field.
 */
export function resolveSavedContactEmail(
  response: Record<string, unknown> | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (response && Object.prototype.hasOwnProperty.call(response, 'contactEmail')) {
    return normalizedEmail(response.contactEmail)
  }
  return normalizedEmail(fallback)
}
