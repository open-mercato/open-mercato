export function isPlatformMapEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  return process.env.OM_PLATFORM_MAP_ENABLED === 'true'
}
