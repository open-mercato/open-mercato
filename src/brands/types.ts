/**
 * Theme color configuration for brand customization
 * Colors should be valid CSS color values (hex, rgb, oklch, etc.)
 */
export interface BrandThemeColors {
  /** Main background color */
  background?: string
  /** Main foreground/text color */
  foreground?: string
  /** Primary action color */
  primary?: string
  /** Primary foreground (text on primary) */
  primaryForeground?: string
  /** Secondary color */
  secondary?: string
  /** Secondary foreground */
  secondaryForeground?: string
  /** Accent color for highlights */
  accent?: string
  /** Accent foreground */
  accentForeground?: string
  /** Muted backgrounds */
  muted?: string
  /** Muted text */
  mutedForeground?: string
  /** Border color */
  border?: string
  /** Card background */
  card?: string
  /** Card foreground */
  cardForeground?: string
  /** Sidebar background */
  sidebar?: string
  /** Sidebar text color */
  sidebarForeground?: string
  /** Sidebar primary color */
  sidebarPrimary?: string
  /** Sidebar primary foreground */
  sidebarPrimaryForeground?: string
  /** Sidebar accent */
  sidebarAccent?: string
  /** Sidebar accent foreground */
  sidebarAccentForeground?: string
  /** Sidebar border */
  sidebarBorder?: string
}

/**
 * Theme configuration for a brand
 */
export interface BrandTheme {
  /** Custom CSS color overrides */
  colors?: BrandThemeColors
}

/**
 * Sidebar layout configuration
 */
export interface BrandSidebarLayout {
  /** Module IDs to permanently hide (e.g., ['audit_logs', 'api_docs']) */
  hiddenModules?: string[]
  /** Navigation group IDs to permanently hide (e.g., ['entities.nav.group']) */
  hiddenGroups?: string[]
}

/**
 * Navbar layout configuration
 */
export interface BrandNavbarLayout {
  /** Hide the global search component */
  hideSearch?: boolean
  /** Hide the organization switcher */
  hideOrgSwitcher?: boolean
}

/**
 * Layout configuration for a brand
 */
export interface BrandLayout {
  /** Sidebar customization */
  sidebar?: BrandSidebarLayout
  /** Navbar customization */
  navbar?: BrandNavbarLayout
}

/**
 * Brand configuration for multi-tenant/white-label support
 * Used for domain detection and conditional rendering
 */
export interface BrandConfig {
  /** Unique identifier for the brand */
  id: string
  /** Display name */
  name: string
  /** Product name shown in sidebar */
  productName: string
  /** Logo configuration */
  logo: {
    src: string
    width: number
    height: number
    alt: string
  }
  /** Domains that map to this brand */
  domains: string[]
  /** Theme customization (colors, etc.) */
  theme?: BrandTheme
  /** Layout customization (sidebar, navbar) */
  layout?: BrandLayout
}
