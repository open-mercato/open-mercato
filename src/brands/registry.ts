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
  theme: {
    colors: {
      // Blue-tinted theme for FreightTech
      primary: 'oklch(0.45 0.15 250)',
      primaryForeground: 'oklch(0.98 0 0)',
      accent: 'oklch(0.94 0.03 250)',
      accentForeground: 'oklch(0.25 0.05 250)',
      // Sidebar with subtle blue tint
      sidebar: 'oklch(0.97 0.01 250)',
      sidebarForeground: 'oklch(0.20 0.02 250)',
      sidebarPrimary: 'oklch(0.45 0.15 250)',
      sidebarPrimaryForeground: 'oklch(0.98 0 0)',
      sidebarAccent: 'oklch(0.92 0.03 250)',
      sidebarAccentForeground: 'oklch(0.25 0.05 250)',
    },
  },
  layout: {
    sidebar: {
      // Example: Hide specific modules for FreightTech brand
      hiddenModules: ['audit_logs', 'docs', 'example'],
      hiddenGroups: ['catalog.nav.group', 'entities.nav.group', 'booking.nav.group', 'customers~sales.nav.group'],
    },
    navbar: {
      // Example: Hide elements from navbar
      // hideSearch: false,
      hideOrgSwitcher: false,
    },
  },
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
