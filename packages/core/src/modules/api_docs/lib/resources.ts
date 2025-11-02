export type ApiDocResource = {
  label: string
  description: string
  href: string
  external?: boolean
  actionLabel?: string
}

export function getApiDocsResources(): ApiDocResource[] {
  return [
    {
      label: 'OpenAPI Explorer',
      description: 'Interactive HTML viewer with endpoint details, payload schemas, and sample requests.',
      href: '/docs/api',
      actionLabel: 'Open explorer',
    },
    {
      label: 'Official documentation',
      description: 'Guides and tutorials covering setup, modules, and customization.',
      href: 'https://docs.openmercato.com/',
      external: true,
      actionLabel: 'Open docs',
    },
    {
      label: 'OpenAPI JSON',
      description: 'Machine-readable OpenAPI 3.1 document for integrating with the platform.',
      href: '/api/docs/openapi',
      actionLabel: 'Download JSON',
    },
    {
      label: 'OpenAPI Markdown',
      description: 'Human-friendly Markdown rendering of the current OpenAPI document.',
      href: '/api/docs/markdown',
      actionLabel: 'Download Markdown',
    },
  ]
}

function appendApiSegment(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    const normalizedPath = url.pathname.replace(/\/+$/, '')
    if (!normalizedPath || normalizedPath === '/') {
      url.pathname = '/api'
    } else if (!normalizedPath.endsWith('/api')) {
      url.pathname = `${normalizedPath}/api`
    } else {
      url.pathname = normalizedPath
    }
    return url.toString()
  } catch {
    const normalized = baseUrl.replace(/\/+$/, '')
    return normalized.endsWith('/api') ? normalized : `${normalized}/api`
  }
}

export function resolveApiDocsBaseUrl(): string {
  const apiOverride = process.env.NEXT_PUBLIC_API_BASE_URL
  if (apiOverride) {
    return apiOverride
  }

  const appBase =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'

  return appendApiSegment(appBase)
}
