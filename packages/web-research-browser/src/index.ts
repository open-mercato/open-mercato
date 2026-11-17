export {
  browserAdapterModule,
  browserOptionsSchema,
  createBrowserAdapter,
  type BrowserOptions,
} from './adapter'
export { Sidecar, createSidecar, type SidecarOptions, type SidecarStream, type SpawnFn } from './client'
export { SidecarError, type SidecarErrorKind, type SidecarReply, type SidecarRequest } from './protocol'

export { browserAdapterModule as default } from './adapter'
