import path from 'node:path'
import { defineLiveProviderHarness } from '@open-mercato/cache-provider-managed-kit/testing/live'
import { awsElastiCacheCacheProviderRegistration } from '../index'
import { LIVE_PROFILES } from '../../test-support/live-profiles'

defineLiveProviderHarness({
  packageDir: path.resolve(__dirname, '../..'),
  registration: awsElastiCacheCacheProviderRegistration,
  profiles: LIVE_PROFILES,
})
