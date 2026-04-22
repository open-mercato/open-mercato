declare module 'cross-spawn' {
  import type { spawn as spawnFunction } from 'node:child_process'

  const spawn: typeof spawnFunction

  export default spawn
}
