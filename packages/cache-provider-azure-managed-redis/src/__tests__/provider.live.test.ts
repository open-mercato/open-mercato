import path from 'node:path'
import { defineLiveProviderHarness } from '@open-mercato/cache-provider-managed-kit/testing/live'
import { azureManagedRedisCacheProviderRegistration } from '../index'
import { LIVE_PROFILES } from '../../test-support/live-profiles'

defineLiveProviderHarness({
  packageDir: path.resolve(__dirname, '../..'),
  registration: azureManagedRedisCacheProviderRegistration,
  profiles: LIVE_PROFILES,
})
