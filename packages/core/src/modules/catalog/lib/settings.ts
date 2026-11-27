export const CATALOG_SETTINGS_MODULE_ID = 'catalog'

// Controls whether the EU unit-price presentation feature is exposed at all.
// Default ON so existing tenants keep the current behavior; manufacturers or
// other non-retail tenants can turn it off to remove the settings from the
// product form entirely.
export const UNIT_PRICE_DISPLAY_ENABLED_KEY = 'unit_price_display_enabled'
export const UNIT_PRICE_DISPLAY_ENABLED_DEFAULT = true

// Tenant-scoped config row for the AI category suggestion feature (spec
// 2026-10-28-catalog-ai-product-categorization.md). Off by default: both a
// platform gate (decision model configured) and this tenant gate must be open
// before any product data reaches a decision model provider.
export const AI_CATEGORIZATION_CONFIG_NAME = 'ai_categorization'
