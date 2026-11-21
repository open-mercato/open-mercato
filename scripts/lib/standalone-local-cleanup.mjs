export function createStandaloneCleanup({ stopCommand = async () => {}, stopServer, stopDatabase }) {
  let completion
  return () => {
    completion ??= (async () => {
      try {
        await stopCommand()
      } finally {
        try {
          await stopServer()
        } finally {
          stopDatabase()
        }
      }
    })()
    return completion
  }
}

export function registerStandaloneCleanup(cleanup, runtime = process) {
  let terminating = false
  const terminate = (code) => {
    if (terminating) return
    terminating = true
    void cleanup().then(
      () => runtime.exit(code),
      () => runtime.exit(code),
    )
  }
  const interrupt = () => terminate(130)
  const terminateSignal = () => terminate(143)
  runtime.once('SIGINT', interrupt)
  runtime.once('SIGTERM', terminateSignal)
  return () => {
    runtime.removeListener('SIGINT', interrupt)
    runtime.removeListener('SIGTERM', terminateSignal)
  }
}
