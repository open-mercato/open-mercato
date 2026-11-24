import path from 'node:path'
import { defineLiveProviderHarness } from '@open-mercato/cache-provider-managed-kit/testing/live'
import { googleMemorystoreCacheProviderRegistration } from '../index'
import { LIVE_PROFILES } from '../../test-support/live-profiles'

defineLiveProviderHarness({
  packageDir: path.resolve(__dirname, '../..'),
  registration: googleMemorystoreCacheProviderRegistration,
  profiles: LIVE_PROFILES,
})
