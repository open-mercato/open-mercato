import path from 'node:path'
import { defineLiveHarnessReadinessSuite } from '../../test-support/live-readiness'

defineLiveHarnessReadinessSuite({
  packageDir: path.resolve(__dirname, '../..'),
  profiles: [
    {
      id: 'kit-fixture-profile',
      description: 'Synthetic profile exercising the shared readiness rules',
      required: ['OM_CACHE_LIVE_KIT_HOST', 'OM_CACHE_LIVE_KIT_IDENTITY'],
      optional: [],
      settings: (env) => ({ host: env.OM_CACHE_LIVE_KIT_HOST }),
    },
  ],
})
