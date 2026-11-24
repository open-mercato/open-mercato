import path from 'node:path'
import { defineLiveProviderHarness } from '@open-mercato/cache-provider-managed-kit/testing/live'
import { provider } from '../index'
import { LIVE_PROFILES } from '../../test-support/live-profiles'

defineLiveProviderHarness({
  packageDir: path.resolve(__dirname, '../..'),
  provider: provider as never,
  profiles: LIVE_PROFILES,
})
