/**
 * Feature-toggle identifier gating the entire production module surface.
 * Kept in its own file so client components can import the id without
 * pulling in server-only toggle resolution code.
 */
export const PRODUCTION_TOGGLE_ID = 'production_enabled'
