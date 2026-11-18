import { asFunction, type BuildResolver, type DisposableResolver } from 'awilix'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from './container'

type Registrar = (container: AppContainer) => unknown
const PROCESS_REGISTRAR = Symbol.for('@open-mercato/shared/di/process-registrar')
type MarkedRegistrar = Registrar & { [PROCESS_REGISTRAR]?: Registrar }

export function defineProcessDiRegistrar<RegistrarType extends Registrar>(
  registrar: RegistrarType,
  options?: { legacy: RegistrarType },
): RegistrarType {
  const callable = options?.legacy ?? registrar
  Object.defineProperty(callable, PROCESS_REGISTRAR, { value: registrar, configurable: true })
  return callable
}

export function getProcessDiRegistrar(registrar: Registrar): Registrar | null {
  return (registrar as MarkedRegistrar)[PROCESS_REGISTRAR] ?? null
}

export function isProcessDiRegistrar(registrar: Registrar): boolean {
  return getProcessDiRegistrar(registrar) !== null
}

export function asScopedService<Service>(factory: (container: AppContainer) => Service): BuildResolver<Service> & DisposableResolver<Service> {
  return asFunction(({ scope }: { scope: AppContainer }) => factory(scope))
    .scoped()
    .proxy()
    .inject((scope) => ({ scope }))
}

type ProcessEventSetup = (bus: EventBus) => void | Promise<void>
const PROCESS_EVENT_SETUPS_KEY = Symbol.for('@open-mercato/shared/di/process-event-setups')
const PROCESS_ACTIVATIONS_KEY = Symbol.for('@open-mercato/shared/di/process-activations')
const CALLER_SETUPS_KEY = Symbol.for('@open-mercato/shared/di/caller-setups')
type SetupGlobals = typeof globalThis & {
  [PROCESS_ACTIVATIONS_KEY]?: WeakMap<AppContainer, Array<() => void>>
  [PROCESS_EVENT_SETUPS_KEY]?: WeakMap<AppContainer, ProcessEventSetup[]>
  [CALLER_SETUPS_KEY]?: WeakMap<AppContainer, CallerSetup[]>
}
const setupGlobals = globalThis as SetupGlobals
const processEventSetups = setupGlobals[PROCESS_EVENT_SETUPS_KEY] ??= new WeakMap<AppContainer, ProcessEventSetup[]>()

export function registerProcessEventSetup(container: AppContainer, setup: ProcessEventSetup): void {
  const setups = processEventSetups.get(container) ?? []
  setups.push(setup)
  processEventSetups.set(container, setups)
}

export async function runProcessEventSetups(container: AppContainer, bus: EventBus): Promise<void> {
  for (const setup of processEventSetups.get(container) ?? []) await setup(bus)
}

type CallerSetup = (container: AppContainer) => void | Promise<void>
const callerSetups = setupGlobals[CALLER_SETUPS_KEY] ??= new WeakMap<AppContainer, CallerSetup[]>()

export function registerCallerSetup(root: AppContainer, setup: CallerSetup): void {
  const setups = callerSetups.get(root) ?? []
  setups.push(setup)
  callerSetups.set(root, setups)
}

export async function runCallerSetups(root: AppContainer, caller: AppContainer): Promise<void> {
  for (const setup of callerSetups.get(root) ?? []) await setup(caller)
}

const processActivations = setupGlobals[PROCESS_ACTIVATIONS_KEY] ??= new WeakMap<AppContainer, Array<() => void>>()

export function registerProcessActivation(root: AppContainer, activate: () => void): void {
  const activations = processActivations.get(root) ?? []
  activations.push(activate)
  processActivations.set(root, activations)
}

export function runProcessActivations(root: AppContainer): void {
  for (const activate of processActivations.get(root) ?? []) activate()
}
