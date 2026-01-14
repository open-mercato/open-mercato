import type { BrandConfig } from './types'

// Brand configurations
const openMercatoBrand: BrandConfig = {
  id: 'openmercato',
  name: 'Open Mercato',
  productName: 'Open Mercato',
  logo: {
    src: '/open-mercato.svg',
    width: 32,
    height: 32,
    alt: 'Open Mercato',
  },
  domains: ['localhost', '127.0.0.1'],
}

const freighttechBrand: BrandConfig = {
  id: 'freighttech',
  name: 'FreightTech',
  productName: 'FreightTech',
  logo: {
    src: '/fms/freighttech-logo.png',
    width: 32,
    height: 32,
    alt: 'FreightTech',
  },
  domains: ['freighttech.org', 'freighttech.localhost', 'openmercato.freighttech.org'],
}

const infBrand: BrandConfig = {
  id: 'inf',
  name: 'INF Shipping Solutions',
  productName: 'INF',
  logo: {
    src: '/fms/inf-logo.svg',
    width: 100,
    height: 40,
    alt: 'INF Shipping Solutions',
  },
  domains: ['inf.localhost', 'inf.freighttech.org'],
}

// Register all brands here
export const brands: BrandConfig[] = [
  openMercatoBrand,
  freighttechBrand,
  infBrand,
]

// Default brand when no domain matches
export const defaultBrand = openMercatoBrand

// Build domain -> brand lookup map
const domainToBrand = new Map<string, BrandConfig>()
for (const brand of brands) {
  for (const domain of brand.domains) {
    domainToBrand.set(domain.toLowerCase(), brand)
  }
}

// Build id -> brand lookup map
const idToBrand = new Map<string, BrandConfig>()
for (const brand of brands) {
  idToBrand.set(brand.id, brand)
}

/**
 * Get brand config by domain
 */
export function getBrandByDomain(domain: string): BrandConfig {
  const normalizedDomain = domain.toLowerCase().split(':')[0] // Remove port
  return domainToBrand.get(normalizedDomain) ?? defaultBrand
}

/**
 * Get brand config by id
 */
export function getBrandById(id: string): BrandConfig {
  return idToBrand.get(id) ?? defaultBrand
}

/**
 * Extract domain from URL or host header
 */
export function extractDomain(urlOrHost: string): string {
  try {
    // If it looks like a full URL, parse it
    if (urlOrHost.startsWith('http://') || urlOrHost.startsWith('https://')) {
      const url = new URL(urlOrHost)
      return url.hostname
    }
    // Otherwise treat as host header (hostname:port)
    return urlOrHost.split(':')[0]
  } catch {
    return urlOrHost.split(':')[0]
  }
}
