import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'eudr',
  title: 'EUDR Compliance',
  version: '0.1.0',
  description: 'EU Deforestation Regulation compliance: product commodity mappings, supplier origin evidence, due diligence statements.',
  author: 'Open Mercato Team',
  license: 'MIT',
  /**
   * `catalog` is a HARD dependency, and saying so is the fix.
   *
   * `data/enrichers.ts` reads `E.catalog.catalog_product` at module scope, so with `catalog` disabled
   * `E.catalog` is undefined and the read throws while the enricher registry is being imported — which takes
   * `/api/auth/login` with it. An installation shaped as a CRM rather than a shop could not reach its own login
   * screen, and the error named a property rather than a module.
   *
   * Declared rather than defended with optional chaining. This module exists to map PRODUCTS to deforestation
   * compliance evidence, so without a catalogue it has nothing to work on at all — the honest answer is that it
   * cannot be enabled, which the generator now says before anybody starts the app rather than after.
   */
  requires: ['catalog'],
  ejectable: true,
}

export { features } from './acl'
