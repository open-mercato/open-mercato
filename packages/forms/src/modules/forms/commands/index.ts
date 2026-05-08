/**
 * Forms module commands barrel.
 *
 * Importing this file is enough to register every command via the side-effect
 * `registerCommand(...)` calls inside each module. The CommandBus consumes the
 * registry without needing direct references to the handler instances.
 */
import './form'
import './form-version'

export * from './form'
export * from './form-version'
