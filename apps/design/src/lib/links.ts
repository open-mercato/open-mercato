export const REPOSITORY_URL = 'https://github.com/open-mercato/open-mercato'
export const REPOSITORY_BLOB_URL = `${REPOSITORY_URL}/blob/main`

export function githubFileUrl(repoRelativePath: string): string {
  return `${REPOSITORY_BLOB_URL}/${repoRelativePath.replace(/^\/+/, '')}`
}

export function publicSourceUrl(repoRelativePath: string): string {
  return `/r/source/${repoRelativePath}.txt`
}

export function entryHref(group: string, entryId: string): string {
  return `/${group}/${entryId}/`
}

export type PreviewTheme = 'admin' | 'storefront'
export type PreviewMode = 'light' | 'dark'

export function previewHref(entryId: string, variantId: string, theme: PreviewTheme, mode: PreviewMode): string {
  const query = new URLSearchParams({ theme, mode })
  return `/preview/${entryId}/${variantId}/?${query.toString()}`
}
