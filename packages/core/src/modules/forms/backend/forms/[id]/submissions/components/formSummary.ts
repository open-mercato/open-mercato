export type FormSummaryVersion = {
  id: string
  status: string
  versionNumber: number
  roles?: string[]
}

export type FormSummaryResponse = {
  id: string
  name: string
  currentPublishedVersionId: string | null
  versions?: FormSummaryVersion[]
}

export function resolvePublishedVersionRoles(summary: FormSummaryResponse | null | undefined): string[] {
  if (!summary?.versions || !summary.currentPublishedVersionId) return []
  const published = summary.versions.find((version) => version.id === summary.currentPublishedVersionId)
  return Array.isArray(published?.roles) ? published.roles : []
}
