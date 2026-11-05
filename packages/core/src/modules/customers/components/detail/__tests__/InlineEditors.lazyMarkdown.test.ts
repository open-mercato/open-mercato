import * as fs from 'fs'
import * as path from 'path'

const source = fs.readFileSync(
  path.join(__dirname, '..', 'InlineEditors.tsx'),
  'utf8',
)

describe('InlineEditors markdown loading (perf #3177)', () => {
  it('does not statically import the markdown rendering stack', () => {
    expect(source).not.toMatch(/from ['"]react-markdown['"]/)
    expect(source).not.toMatch(/from ['"]remark-gfm['"]/)
  })

  it('renders markdown through the shared lazy renderer', () => {
    expect(source).toMatch(/from ['"]@open-mercato\/ui\/backend\/markdown['"]/)
  })
})
