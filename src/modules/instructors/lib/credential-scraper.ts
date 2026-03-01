export type CredentialMetadata = {
  title: string | null
  issuer: string | null
  badgeImageUrl: string | null
  issuedAt: Date | null
  expiresAt: Date | null
  description: string | null
  raw: Record<string, string>
}

const META_TAG_MAP: Record<string, keyof CredentialMetadata> = {
  'og:title': 'title',
  'og:description': 'description',
  'og:image': 'badgeImageUrl',
}

function extractMetaContent(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return match[1].trim()
  }

  return null
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match?.[1]?.trim() ?? null
}

function detectIssuer(url: string, html: string): string | null {
  if (url.includes('credential.unrealengine.com') || url.includes('epicgames.com')) {
    return 'Epic Games'
  }
  if (url.includes('credly.com')) {
    const issuerMeta = extractMetaContent(html, 'og:site_name')
    return issuerMeta ?? 'Credly'
  }
  return extractMetaContent(html, 'og:site_name')
}

function detectCredentialType(url: string): 'unreal_engine' | 'credly' | 'other' {
  if (url.includes('credential.unrealengine.com') || url.includes('unrealengine.com')) {
    return 'unreal_engine'
  }
  if (url.includes('credly.com')) {
    return 'credly'
  }
  return 'other'
}

export async function scrapeCredential(url: string): Promise<CredentialMetadata> {
  const result: CredentialMetadata = {
    title: null,
    issuer: null,
    badgeImageUrl: null,
    issuedAt: null,
    expiresAt: null,
    description: null,
    raw: {},
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KarianaBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return result
    }

    const html = await response.text()

    for (const [metaProperty, field] of Object.entries(META_TAG_MAP)) {
      const value = extractMetaContent(html, metaProperty)
      if (value) {
        result.raw[metaProperty] = value
        if (field === 'title' || field === 'description' || field === 'badgeImageUrl') {
          result[field] = value
        }
      }
    }

    if (!result.title) {
      result.title = extractTitle(html)
    }

    result.issuer = detectIssuer(url, html)

    const issuedDateStr = extractMetaContent(html, 'credential:issued_date')
      ?? extractMetaContent(html, 'article:published_time')
    if (issuedDateStr) {
      const parsed = new Date(issuedDateStr)
      if (!Number.isNaN(parsed.getTime())) {
        result.issuedAt = parsed
      }
    }

    const expiresDateStr = extractMetaContent(html, 'credential:expiry_date')
    if (expiresDateStr) {
      const parsed = new Date(expiresDateStr)
      if (!Number.isNaN(parsed.getTime())) {
        result.expiresAt = parsed
      }
    }
  } catch {
    // scraping failed silently; return partial result
  }

  return result
}

export { detectCredentialType }
