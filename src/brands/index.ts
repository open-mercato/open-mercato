// Simplified brand system - just domain detection for conditional rendering
export {
  brands,
  defaultBrand,
  getBrandByDomain,
  getBrandById,
  extractDomain,
} from './registry'

// Types
export type {
  BrandConfig,
  BrandTheme,
  BrandThemeColors,
  BrandLayout,
  BrandSidebarLayout,
  BrandNavbarLayout,
} from './types'
