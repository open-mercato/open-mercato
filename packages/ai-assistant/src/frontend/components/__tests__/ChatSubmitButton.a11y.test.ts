import fs from 'node:fs'
import path from 'node:path'

const commandPaletteSource = fs.readFileSync(
  path.join(__dirname, '..', 'CommandPalette', 'CommandPalette.tsx'),
  'utf8',
)
const dockableChatSource = fs.readFileSync(
  path.join(__dirname, '..', 'DockableChat', 'DockableChat.tsx'),
  'utf8',
)

describe('AI Assistant submit button accessibility', () => {
  it('labels the command palette button for both send and stop states', () => {
    expect(commandPaletteSource).toContain(
      "aria-label={isStreaming ? t('ai_assistant.chat.cancel') : t('ai_assistant.chat.send')}",
    )
  })

  it('labels both dockable chat buttons for send and stop states', () => {
    expect(
      dockableChatSource.match(
        /aria-label=\{isStreaming \? t\('ai_assistant\.chat\.cancel'\) : t\('ai_assistant\.chat\.send'\)\}/g,
      ),
    ).toHaveLength(2)
  })
})
