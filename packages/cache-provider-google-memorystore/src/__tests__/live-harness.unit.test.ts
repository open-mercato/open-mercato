import path from 'node:path'
import { defineLiveHarnessReadinessSuite } from '@open-mercato/cache-provider-managed-kit/testing/live-readiness'
import { LIVE_PROFILES } from '../../test-support/live-profiles'

defineLiveHarnessReadinessSuite({ packageDir: path.resolve(__dirname, '../..'), profiles: LIVE_PROFILES })
