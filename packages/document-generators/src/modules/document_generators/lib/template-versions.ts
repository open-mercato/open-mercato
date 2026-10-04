import { DEFAULT_TEMPLATE_VERSION, type DocumentTemplateSource, type TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { UnknownTemplateVersionError } from './template-errors'

export function currentVersion(entry: TemplateEntry): string {
  return entry.version ?? DEFAULT_TEMPLATE_VERSION
}

export function availableVersions(entry: TemplateEntry): string[] {
  return [currentVersion(entry), ...(entry.archivedVersions ?? []).map((source) => source.version)]
}

export function assertDistinctVersions(entry: TemplateEntry): void {
  const versions = availableVersions(entry)
  if (new Set(versions).size !== versions.length || versions.some((version) => !version.trim())) {
    throw new Error(`[internal] Document template ${entry.id} declares duplicate or empty versions`)
  }
}

export function resolveVersionSource(entry: TemplateEntry, version: string | undefined): { version: string; load: () => Promise<DocumentTemplateSource> } {
  const current = currentVersion(entry)
  if (version === undefined || version === current) return { version: current, load: entry.load }
  const archived = entry.archivedVersions?.find((source) => source.version === version)
  if (!archived) throw new UnknownTemplateVersionError(entry.id, version)
  return archived
}
