import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { defaultEncryptionMaps } from '../../encryption'

const encryptedClasses = new Set(defaultEncryptionMaps.map(({ entityId }) =>
  entityId.split(':')[1].split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(''),
))
const commandsPath = path.resolve(__dirname, '..')

describe('customer command encrypted reads (#2115)', () => {
  it.each(fs.readdirSync(commandsPath).filter((filename) => filename.endsWith('.ts')))(
    '%s uses decryption helpers for encrypted entities',
    (filename) => {
      const source = ts.createSourceFile(filename, fs.readFileSync(path.join(commandsPath, filename), 'utf8'), ts.ScriptTarget.Latest, true)
      const violations: string[] = []
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && ['find', 'findOne', 'findAndCount'].includes(node.expression.name.text)
          && node.arguments[0]
          && encryptedClasses.has(node.arguments[0].getText(source))
        ) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
          violations.push(`${filename}:${line + 1}: ${node.expression.getText(source)}(${node.arguments[0].getText(source)})`)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      expect(violations).toEqual([])
    },
  )
})
