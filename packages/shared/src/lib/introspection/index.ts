export {
  PLATFORM_MAP_SCHEMA_VERSION,
  type CollectPlatformMapOptions,
  type IntrospectionContext,
  type IntrospectionSnapshot,
  type PlatformMap,
  type SurfaceProvider,
  type SurfaceRow,
  type SurfaceTier,
} from './types'

export {
  collectPlatformMap,
  getSurfaceProvider,
  getSurfaceProviderIds,
  getSurfaceProviders,
  registerSurfaceProvider,
} from './registry'

export { renderPlatformMapHuman, renderSurfaceTable } from './render'

export { builtInSurfaceProviders } from './providers'

export { SURFACE_CATALOG, type SurfaceCatalogEntry } from './surface-catalog'

export { buildIntrospectionContext } from './context'
export { buildRuntimeIntrospectionContext } from './runtime-context'
export {
  loadIntrospectionSnapshot,
  registerIntrospectionSnapshotLoader,
  resetIntrospectionSnapshotLoader,
  type IntrospectionSnapshotField,
  type IntrospectionSnapshotLoader,
} from './snapshot-loader'
export {
  resolveBootstrapFilesForSurfaces,
  type IntrospectionBootstrapFile,
} from './surface-bootstrap-deps'
