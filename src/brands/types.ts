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
}
