import type { ModuleCli } from '@/modules/registry'

const hello: ModuleCli = {
  command: 'hello',
  async run() {
    console.log('Hello from example module!')
  },
}

export default [hello]
