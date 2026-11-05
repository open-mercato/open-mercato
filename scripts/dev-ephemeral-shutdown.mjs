// Coordinates graceful shutdown of the ephemeral dev runner (scripts/dev-ephemeral.ts).
//
// Owns the active PostgreSQL container id and the running dev child so that a
// single place decides how the process tears down. Fixes issue #2745:
//  - the container removal is awaited before `process.exit` (it used to be a
//    fire-and-forget call right before exiting, which tore Node down before
//    `docker rm -f` ran and leaked the container);
//  - signal handlers are installed up front (before the container is created)
//    and remove the active container, so a SIGINT/SIGTERM that arrives during
//    initialization still cleans up instead of leaking the container.
export function createEphemeralShutdownController({
  stopContainer,
  beforeExit = () => {},
  onInterrupt = () => {},
  exit = (code) => process.exit(code),
  processRef = process,
} = {}) {
  if (typeof stopContainer !== 'function') {
    throw new TypeError('createEphemeralShutdownController requires a stopContainer(containerId) function')
  }

  let activeContainerId = null
  let activeChild = null
  let shutdownPromise = null
  let handlersInstalled = false

  const setActiveContainerId = (containerId) => {
    activeContainerId = containerId || null
  }

  const setActiveChild = (child) => {
    activeChild = child ?? null
  }

  const runShutdown = async (exitCode) => {
    beforeExit()
    const containerId = activeContainerId
    if (containerId) {
      activeContainerId = null
      try {
        await stopContainer(containerId)
      } catch {
        // Best-effort cleanup: never block the exit on a docker error.
      }
    }
    return exit(exitCode)
  }

  // Deduplicate into a single in-flight shutdown: a signal handler can start the
  // teardown while main() independently calls shutdown again (e.g. the
  // interrupted step reports failure). Both must await the SAME cleanup so the
  // second caller cannot process.exit() before the container removal completes.
  const shutdown = (exitCode) => {
    if (!shutdownPromise) {
      shutdownPromise = runShutdown(exitCode)
    }
    return shutdownPromise
  }

  const handleSignal = (signal) => {
    onInterrupt()
    if (activeChild && typeof activeChild.kill === 'function' && !activeChild.killed) {
      // The dev runtime is up — forward the signal so it shuts down gracefully;
      // its exit handler removes the container and the main flow then exits.
      activeChild.kill(signal)
      return
    }
    // No dev child yet (still initializing) — remove the container and exit.
    void shutdown(0)
  }

  const installSignalHandlers = () => {
    if (handlersInstalled) return
    handlersInstalled = true
    processRef.on('SIGINT', () => handleSignal('SIGINT'))
    processRef.on('SIGTERM', () => handleSignal('SIGTERM'))
  }

  return { shutdown, installSignalHandlers, setActiveContainerId, setActiveChild }
}
