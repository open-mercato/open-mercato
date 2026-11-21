import { defineProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import type { AwilixContainer } from 'awilix'

export function register(_container: AwilixContainer): void {}

export default { register }

defineProcessDiRegistrar(register)
