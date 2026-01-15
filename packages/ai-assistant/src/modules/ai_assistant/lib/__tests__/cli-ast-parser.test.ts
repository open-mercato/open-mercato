import { parseCliSourceAst, buildSchemaFromParams, extractModuleId } from '../cli-ast-parser'

describe('cli-ast-parser', () => {
  describe('parseCliSourceAst', () => {
    it('should extract command name from simple CLI definition', () => {
      const source = `
        const cmd = {
          command: 'my-command',
          async run(rest) {
            console.log('running')
          }
        }
        export default [cmd]
      `
      const commands = parseCliSourceAst(source)
      expect(commands).toHaveLength(1)
      expect(commands[0].name).toBe('my-command')
    })

    it('should extract parameters from args property access', () => {
      const source = `
        const cmd = {
          command: 'add-user',
          async run(rest) {
            const args = parseArgs(rest)
            const email = args.email
            const password = args.password
            console.log(email, password)
          }
        }
        export default [cmd]
      `
      const commands = parseCliSourceAst(source)
      expect(commands).toHaveLength(1)
      const params = commands[0].parameters
      expect(params.map((p) => p.name)).toContain('email')
      expect(params.map((p) => p.name)).toContain('password')
    })

    it('should detect aliases from nullish coalescing', () => {
      const source = `
        const cmd = {
          command: 'add-user',
          async run(rest) {
            const args = parseArgs(rest)
            const orgId = args.organizationId ?? args.orgId ?? args.org
            console.log(orgId)
          }
        }
        export default [cmd]
      `
      const commands = parseCliSourceAst(source)
      const params = commands[0].parameters
      const orgParam = params.find((p) => p.name === 'organizationId')
      expect(orgParam).toBeDefined()
      expect(orgParam!.aliases).toEqual(['orgId', 'org'])
    })

    it('should extract usage string from console.error', () => {
      const source = `
        const cmd = {
          command: 'add-user',
          async run(rest) {
            const args = parseArgs(rest)
            if (!args.email) {
              console.error('Usage: mercato auth add-user --email <email>')
              return
            }
          }
        }
        export default [cmd]
      `
      const commands = parseCliSourceAst(source)
      expect(commands[0].usageString).toBe('Usage: mercato auth add-user --email <email>')
    })

    it('should detect required params from if-statement validation', () => {
      const source = `
        const cmd = {
          command: 'add-user',
          async run(rest) {
            const args = parseArgs(rest)
            const email = args.email
            const password = args.password
            if (!email || !password) {
              console.error('Usage: mercato auth add-user --email <email> --password <pw>')
              return
            }
          }
        }
        export default [cmd]
      `
      const commands = parseCliSourceAst(source)
      const params = commands[0].parameters
      const emailParam = params.find((p) => p.name === 'email')
      const passwordParam = params.find((p) => p.name === 'password')
      expect(emailParam?.required).toBe(true)
      expect(passwordParam?.required).toBe(true)
    })

    it('should handle multiple commands in one file', () => {
      const source = `
        const cmd1 = {
          command: 'list-users',
          async run() { }
        }
        const cmd2 = {
          command: 'add-user',
          async run(rest) {
            const args = parseArgs(rest)
            console.log(args.email)
          }
        }
        export default [cmd1, cmd2]
      `
      const commands = parseCliSourceAst(source)
      expect(commands).toHaveLength(2)
      expect(commands.map((c) => c.name)).toEqual(['list-users', 'add-user'])
    })

    it('should handle element access syntax args["key"]', () => {
      const source = `
        const cmd = {
          command: 'test',
          async run(rest) {
            const args = parseArgs(rest)
            const val = args['some-key']
          }
        }
        export default [cmd]
      `
      const commands = parseCliSourceAst(source)
      const params = commands[0].parameters
      expect(params.map((p) => p.name)).toContain('some-key')
    })

    it('should handle method declaration syntax for run', () => {
      const source = `
        const cmd = {
          command: 'my-cmd',
          run(rest) {
            const args = parseArgs(rest)
            console.log(args.param1)
          }
        }
        export default [cmd]
      `
      const commands = parseCliSourceAst(source)
      expect(commands).toHaveLength(1)
      expect(commands[0].name).toBe('my-cmd')
    })

    it('should handle arrow function syntax for run', () => {
      const source = `
        const cmd = {
          command: 'arrow-cmd',
          run: async (rest) => {
            const args = parseArgs(rest)
            console.log(args.name)
          }
        }
        export default [cmd]
      `
      const commands = parseCliSourceAst(source)
      expect(commands).toHaveLength(1)
      expect(commands[0].name).toBe('arrow-cmd')
      expect(commands[0].parameters.map((p) => p.name)).toContain('name')
    })

    it('should not mark params as required without usage error', () => {
      const source = `
        const cmd = {
          command: 'test',
          async run(rest) {
            const args = parseArgs(rest)
            const email = args.email
            if (!email) {
              // Just returns without usage message
              return
            }
          }
        }
        export default [cmd]
      `
      const commands = parseCliSourceAst(source)
      const params = commands[0].parameters
      const emailParam = params.find((p) => p.name === 'email')
      expect(emailParam?.required).toBe(false)
    })
  })

  describe('buildSchemaFromParams', () => {
    it('should create optional string fields by default', () => {
      const params = [
        { name: 'email', aliases: [], required: false, type: 'string' as const },
        { name: 'name', aliases: [], required: false, type: 'string' as const },
      ]
      const schema = buildSchemaFromParams(params)
      const result = schema.safeParse({})
      expect(result.success).toBe(true)
    })

    it('should create required fields when marked', () => {
      const params = [{ name: 'email', aliases: [], required: true, type: 'string' as const }]
      const schema = buildSchemaFromParams(params)
      const result = schema.safeParse({})
      expect(result.success).toBe(false)
    })

    it('should skip context parameters', () => {
      const params = [
        { name: 'email', aliases: [], required: false, type: 'string' as const },
        { name: 'tenantId', aliases: [], required: false, type: 'string' as const },
        { name: 'organizationId', aliases: [], required: false, type: 'string' as const },
        { name: 'orgId', aliases: [], required: false, type: 'string' as const },
        { name: 'org', aliases: [], required: false, type: 'string' as const },
        { name: 'tenant', aliases: [], required: false, type: 'string' as const },
      ]
      const schema = buildSchemaFromParams(params)
      const shape = schema.shape
      expect(Object.keys(shape)).toEqual(['email'])
    })

    it('should add description for aliased params', () => {
      const params = [
        {
          name: 'customerId',
          aliases: ['custId', 'cust'],
          required: false,
          type: 'string' as const,
        },
      ]
      const schema = buildSchemaFromParams(params)
      const shape = schema.shape
      expect(shape.customerId.description).toBe('Aliases: custId, cust')
    })

    it('should handle boolean type', () => {
      const params = [{ name: 'dryRun', aliases: [], required: false, type: 'boolean' as const }]
      const schema = buildSchemaFromParams(params)
      const result = schema.safeParse({ dryRun: true })
      expect(result.success).toBe(true)
    })

    it('should validate required fields correctly', () => {
      const params = [
        { name: 'email', aliases: [], required: true, type: 'string' as const },
        { name: 'name', aliases: [], required: false, type: 'string' as const },
      ]
      const schema = buildSchemaFromParams(params)

      // Should fail without email
      const fail = schema.safeParse({ name: 'test' })
      expect(fail.success).toBe(false)

      // Should pass with email
      const pass = schema.safeParse({ email: 'test@example.com' })
      expect(pass.success).toBe(true)
    })
  })

  describe('extractModuleId', () => {
    it('should extract module ID from standard path', () => {
      expect(extractModuleId('packages/core/src/modules/auth/cli.ts')).toBe('auth')
      expect(extractModuleId('packages/search/src/modules/search/cli.ts')).toBe('search')
      expect(extractModuleId('packages/core/src/modules/customers/cli.ts')).toBe('customers')
    })

    it('should return unknown for non-matching paths', () => {
      expect(extractModuleId('some/other/path.ts')).toBe('unknown')
      expect(extractModuleId('cli.ts')).toBe('unknown')
      expect(extractModuleId('')).toBe('unknown')
    })

    it('should handle various path formats', () => {
      expect(extractModuleId('/absolute/packages/core/src/modules/auth/cli.ts')).toBe('auth')
      expect(extractModuleId('./packages/core/src/modules/auth/cli.ts')).toBe('auth')
    })
  })
})
