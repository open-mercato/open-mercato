import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ts from 'typescript-js'

const enginePath = join(__dirname, '..', 'engine.ts')
const engineSource = ts.createSourceFile(enginePath, readFileSync(enginePath, 'utf8'), ts.ScriptTarget.Latest, true)
const engineClass = engineSource.statements.find(
  (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement) && statement.name?.text === 'DefaultDataEngine',
)
if (!engineClass) throw new Error('[internal] DefaultDataEngine class not found')

const methodNames = ['updateOrmEntity', 'deleteOrmEntity']
const methods = engineClass.members.filter(
  (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && methodNames.includes(member.name.getText(engineSource)),
)
const probePath = join(__dirname, 'orm-query-probe.ts')
const probeSource = `
  import type { EntityName, FilterQuery } from '@mikro-orm/core'
  import type { EntityManager } from '@mikro-orm/postgresql'
  class OrmQueryProbe {
    constructor(private readonly em: EntityManager) {}
    ${methods.map((method) => method.getText(engineSource)).join('\n')}
  }
`

const managerPath = join(dirname(require.resolve('@mikro-orm/core')), 'EntityManager.d.ts')
const managerText = readFileSync(managerPath, 'utf8')
const managerSource = ts.createSourceFile(managerPath, managerText, ts.ScriptTarget.Latest, true)
const managerClass = managerSource.statements.find(
  (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement) && statement.name?.text === 'EntityManager',
)
const findOne = managerClass?.members.find(
  (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && member.name.getText(managerSource) === 'findOne',
)
const whereType = findOne?.parameters.find((parameter) => parameter.name.getText(managerSource) === 'where')?.type
if (!whereType) throw new Error('[internal] EntityManager.findOne query type not found')

describe('DataEngine ORM query compatibility', () => {
  test.each([
    ['MikroORM 7.1 / 7.2.8', '[Using] extends [never] ? FilterQuery<NoInfer<Entity>> : IndexFilterQuery<NoInfer<Entity>, Using>'],
    ['MikroORM 7.2.9', 'NoInfer<[Using] extends [never] ? FilterQuery<Entity> : IndexFilterQuery<Entity, Using>>'],
  ])('update and delete compile with the %s findOne signature', (_version, queryType) => {
    expect(methods.map((method) => method.name.getText(engineSource))).toEqual(methodNames)
    const declaration = managerText.slice(0, whereType.getStart(managerSource)) + queryType + managerText.slice(whereType.end)
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    }
    const host = ts.createCompilerHost(options)
    const readFile = host.readFile.bind(host)
    host.readFile = (filePath) => filePath === probePath ? probeSource : filePath === managerPath ? declaration : readFile(filePath)
    const fileExists = host.fileExists.bind(host)
    host.fileExists = (filePath) => filePath === probePath || fileExists(filePath)

    const program = ts.createProgram([probePath], options, host)
    const errors = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    expect(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([])
  })
})
