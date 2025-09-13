import type { ModuleCli } from '@/modules/registry'

// App-level CLI commands (optional). These show up under module id 'app'.
// Example:
// const hello: ModuleCli = { command: 'hello', run: async (argv) => { console.log('Hello', argv.join(' ')) } }
// export default [hello]
export default [] as ModuleCli[]

