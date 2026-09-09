export const CATALOG_SETTINGS_MODULE_ID = 'catalog'

// Controls whether the EU unit-price presentation feature is exposed at all.
// Default ON so existing tenants keep the current behavior; manufacturers or
// other non-retail tenants can turn it off to remove the settings from the
// product form entirely.
export const UNIT_PRICE_DISPLAY_ENABLED_KEY = 'unit_price_display_enabled'
export const UNIT_PRICE_DISPLAY_ENABLED_DEFAULT = true

// EU Omnibus (2019/2161) configuration. Stored under its own key rather than merged into a
// single settings blob so a concurrent unit-price write can never clobber it, and vice versa.
export const OMNIBUS_CONFIG_KEY = 'omnibus'
export const OMNIBUS_DEFAULT_LOOKBACK_DAYS = 30
