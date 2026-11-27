import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  envDisablesAutoIndexing,
  SEARCH_AUTO_INDEX_CONFIG_KEY,
  SEARCH_AUTO_INDEX_CONFIG_MODULE,
} from '@open-mercato/shared/lib/search/auto-indexing'

export const setup: ModuleSetupConfig = {
  instanceConfigDefaults: () => [
    {
      name: SEARCH_AUTO_INDEX_CONFIG_KEY,
      value: !envDisablesAutoIndexing(),
      legacyStorageNamespace: SEARCH_AUTO_INDEX_CONFIG_MODULE,
    },
  ],

  defaultRoleFeatures: {
    admin: ['search.*', 'vector.*'],
    // `search.global` only unlocks the Cmd+K palette — the mirror image of the
    // `ai_assistant.view` grant that gives employees Cmd+L. It does not widen what
    // they can read: the global-search endpoint drops every result whose entity
    // type the caller has no owning-module view feature for. The administration
    // features (`search.view`, `search.manage`, `search.reindex`) stay admin-only.
    employee: ['search.global', 'vector.*'],
  },
}

export default setup
