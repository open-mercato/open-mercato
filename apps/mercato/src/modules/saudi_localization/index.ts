import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

// Side-effect registration: the Kingdom's financial country plugin joins the
// engine's registry when this module loads, the way the platform's other
// registries bootstrap. Imported for effect only — nothing downstream reads the
// module object for it.
import './financial-plugin'

export const metadata: ModuleInfo = {
  name: 'saudi_localization',
  title: 'Saudi Localization (ZATCA)',
  version: '0.1.0',
  description: 'ZATCA e-invoicing payloads, Saudi VAT primitives and Hijri-aware document dates.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
