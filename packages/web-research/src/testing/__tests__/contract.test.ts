import { z } from 'zod'
import { defineAdapterModule } from '../../contract/adapter'
import { describeAdapterContract } from '../contract'
import { createFakeAdapter } from '../fakeAdapter'

const versionOneAdapter = defineAdapterModule({
  id: 'version-one',
  kind: 'api',
  contractVersion: 1,
  optionsSchema: z.object({}),
  createAdapter: () => createFakeAdapter({ id: 'version-one', results: [{ url: 'https://example.test/page' }] }),
})

describeAdapterContract(versionOneAdapter, { configuredOptions: {} }, { describe, it, expect })
