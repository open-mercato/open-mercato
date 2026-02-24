import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { Dictionary, DictionaryEntry } from './data/entities'

export function register(container: AppContainer) {
  container.register({
    Dictionary: asValue(Dictionary),
    DictionaryEntry: asValue(DictionaryEntry),
  })
}
