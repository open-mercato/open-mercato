export const REPOSITORY_URL = 'https://github.com/open-mercato/open-mercato'
export const REPOSITORY_BLOB_URL = `${REPOSITORY_URL}/blob/main`

export function githubFileUrl(repoRelativePath: string): string {
  return `${REPOSITORY_BLOB_URL}/${repoRelativePath.replace(/^\/+/, '')}`
}

export function issuesUrl(title: string): string {
  const query = new URLSearchParams({ q: `is:issue is:open ${title}` })
  return `${REPOSITORY_URL}/issues?${query.toString()}`
}

export function publicSourceUrl(repoRelativePath: string): string {
  return `/r/source/${repoRelativePath}.txt`
}

export function entryHref(group: string, entryId: string): string {
  return `/${group}/${entryId}/`
}

export type PreviewMode = 'light' | 'dark'

export function previewHref(entryId: string, variantId: string, mode: PreviewMode): string {
  const query = new URLSearchParams({ mode })
  return `/preview/${entryId}/${variantId}/?${query.toString()}`
}
