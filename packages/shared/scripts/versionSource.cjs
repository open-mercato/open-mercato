// Pure source emitter for the build-time replacement of src/lib/version.ts.
// Kept side-effect free, and CommonJS so both build.mjs and the Jest suite can load it.

const {
  IndentationText,
  Project,
  QuoteKind,
  ScriptKind,
  StructureKind,
  VariableDeclarationKind,
} = require('ts-morph')

const VIRTUAL_FILE_NAME = 'version.ts'
const BANNER = '// Build-time generated version\n'

let sharedProject = null

function getProject() {
  if (!sharedProject) {
    sharedProject = new Project({
      useInMemoryFileSystem: true,
      manipulationSettings: {
        indentationText: IndentationText.TwoSpaces,
        quoteKind: QuoteKind.Single,
        useTrailingCommas: true,
      },
    })
  }

  return sharedProject
}

function assertNoSyntacticDiagnostics(project, sourceFile) {
  const diagnostics = project.getProgram().getSyntacticDiagnostics(sourceFile)
  if (diagnostics.length === 0) return

  const details = diagnostics
    .map((diagnostic) => `  line ${diagnostic.getLineNumber() ?? 0}: ${diagnostic.getMessageText()}`)
    .join('\n')
  throw new Error(`[internal] Generated ${VIRTUAL_FILE_NAME} is not syntactically valid:\n${details}`)
}

function normalizeSourceText(text) {
  const normalized = text.replace(/\r\n/g, '\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

function buildVersionSource(version) {
  const project = getProject()
  const sourceFile = project.createSourceFile(VIRTUAL_FILE_NAME, '', {
    overwrite: true,
    scriptKind: ScriptKind.TS,
  })

  sourceFile.addVariableStatement({
    kind: StructureKind.VariableStatement,
    isExported: true,
    declarationKind: VariableDeclarationKind.Const,
    declarations: [{ name: 'APP_VERSION', initializer: (writer) => writer.quote(String(version)) }],
  })

  sourceFile.addVariableStatement({
    kind: StructureKind.VariableStatement,
    isExported: true,
    declarationKind: VariableDeclarationKind.Const,
    declarations: [{ name: 'appVersion', initializer: 'APP_VERSION' }],
  })

  sourceFile.formatText({ indentSize: 2, convertTabsToSpaces: true })
  sourceFile.insertText(0, BANNER)
  assertNoSyntacticDiagnostics(project, sourceFile)

  return normalizeSourceText(sourceFile.getFullText())
}

module.exports = { buildVersionSource }
