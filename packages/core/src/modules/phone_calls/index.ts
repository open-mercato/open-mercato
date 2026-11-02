import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'phone_calls',
  title: 'Phone Calls',
  version: '0.1.0',
  description: 'Provider-neutral core hub for ingesting and browsing phone calls.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
