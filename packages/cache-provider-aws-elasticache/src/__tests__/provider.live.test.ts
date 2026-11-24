import path from 'node:path'
import { provider } from '../index'
import { defineLiveProviderHarness } from '../../test-support/live'
import { LIVE_PROFILES } from '../../test-support/live-profiles'

defineLiveProviderHarness({
  packageDir: path.resolve(__dirname, '../..'),
  provider: provider as never,
  profiles: LIVE_PROFILES,
})
