import fs from 'node:fs'
import path from 'node:path'

describe('DemoFeedbackWidget import graph', () => {
  it('imports useAiDock directly instead of the broad AI barrel', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/DemoFeedbackWidget.tsx'), 'utf8')

    expect(source).not.toContain("@open-mercato/ui/ai'")
    expect(source).toContain("@open-mercato/ui/ai/AiDock")
  })
})
