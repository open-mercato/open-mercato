import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import type { CacheStrategy } from '@open-mercato/cache'
import { registerLocales } from '@open-mercato/shared/lib/i18n/locale-registry'
import { CachedDisplayProfileResolver } from './lib/resolve-display-profile'

export function register(container: AppContainer) {
  // `en-US` is the overlay dictionary a US market selects through its `language_tag`; it is not
  // offered by the locale settings screen, which cannot present region subtags today. Registering
  // normalizes to `en-us` and validates only the base subtag, so nothing about locale folding
  // changes: while `en-us` is unregistered `en-US` still folds to `en`, and once registered it
  // resolves to itself and inherits the whole of `en` underneath. Idempotent, so repeating it per
  // container is a no-op.
  registerLocales(['en-US'])

  container.register({
    displayProfileResolver: {
      resolve: (c) => {
        const em = c.resolve<EntityManager>('em')
        let cache: CacheStrategy | null = null
        try {
          cache = c.resolve<CacheStrategy>('cache')
        } catch {
          // The resolver stays usable without a cache; it just reads through on every request.
          cache = null
        }
        return new CachedDisplayProfileResolver(em, cache)
      },
    },
  })
}
