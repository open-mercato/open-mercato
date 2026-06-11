import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'

function isPlainOperation(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stripAclDescriptionLines(description: string): string | undefined {
  const parts = description
    .split('\n\n')
    .filter((part) => !part.startsWith('Requires features:') && !part.startsWith('Requires roles:'))
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

export function redactOpenApiSecurityMetadata<T extends OpenApiDocument>(doc: T): T {
  const redacted = structuredClone(doc) as T

  for (const pathItem of Object.values(redacted.paths ?? {})) {
    if (!isPlainOperation(pathItem)) continue
    for (const operation of Object.values(pathItem)) {
      if (!isPlainOperation(operation)) continue
      delete operation['x-require-features']
      delete operation['x-require-roles']
      delete operation['x-require-auth']
      if (typeof operation.description === 'string') {
        operation.description = stripAclDescriptionLines(operation.description)
      }
    }
  }

  return redacted
}
