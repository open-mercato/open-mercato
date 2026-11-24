import { asValue, createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../../di'
import { SignInActivityService } from '../SignInActivityService'
jest.mock('../../security.mfa-providers', () => ({ mfaProviders: [] }))

test('resolves the sign-in collector in the production DI injection mode', () => {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue({}),
    tenantEncryptionService: asValue({}),
  })
  register(container as AppContainer)
  expect(container.resolve('signInActivityService')).toBeInstanceOf(SignInActivityService)
})
