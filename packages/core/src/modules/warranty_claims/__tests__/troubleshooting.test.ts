import {
  guideMatches,
  parseGuideSteps,
  selectBestGuide,
  walkGuide,
  type TroubleshootingNode,
} from '../lib/troubleshooting'

function validTree(): TroubleshootingNode {
  const parsed = parseGuideSteps({
    prompt: 'Does the device power on?',
    options: [
      {
        label: 'No',
        resolution: 'Ask the customer to charge the battery and retry.',
        reasonCode: 'no_power',
      },
      {
        label: 'Yes',
        next: {
          prompt: 'Is the display damaged?',
          options: [
            {
              label: 'Cracked',
              resolution: 'Route to physical damage review.',
              reasonCode: 'physical_damage',
            },
            {
              label: 'No visible damage',
              resolution: 'Continue with software reset instructions.',
            },
          ],
        },
      },
    ],
  })
  if (!parsed) throw new Error('expected fixture tree to parse')
  return parsed
}

describe('warranty troubleshooting guides', () => {
  test('parseGuideSteps returns a normalized tree for valid input', () => {
    expect(validTree()).toEqual({
      prompt: 'Does the device power on?',
      options: [
        {
          label: 'No',
          resolution: 'Ask the customer to charge the battery and retry.',
          reasonCode: 'no_power',
        },
        {
          label: 'Yes',
          next: {
            prompt: 'Is the display damaged?',
            options: [
              {
                label: 'Cracked',
                resolution: 'Route to physical damage review.',
                reasonCode: 'physical_damage',
              },
              {
                label: 'No visible damage',
                resolution: 'Continue with software reset instructions.',
              },
            ],
          },
        },
      ],
    })
  })

  test('parseGuideSteps returns null for malformed input', () => {
    expect(parseGuideSteps(null)).toBeNull()
    expect(parseGuideSteps({ prompt: 'Missing options' })).toBeNull()
    expect(parseGuideSteps({ prompt: 'Dead end', options: [{ label: 'Broken' }] })).toBeNull()
    expect(parseGuideSteps({ prompt: 'Bad option', options: [{ next: { prompt: 'Nested', options: [] } }] })).toBeNull()
  })

  test('walkGuide navigates to child nodes and terminal results', () => {
    const root = validTree()

    expect(walkGuide(root, [])).toEqual({ node: root, terminal: null })
    expect(walkGuide(root, [1])).toEqual({ node: root.options[1].next, terminal: null })
    expect(walkGuide(root, [1, 0])).toEqual({
      node: null,
      terminal: {
        resolution: 'Route to physical damage review.',
        reasonCode: 'physical_damage',
      },
    })
    expect(walkGuide(root, [9])).toEqual({ node: null, terminal: null })
  })

  test('guideMatches excludes inactive and nonmatching guides', () => {
    expect(guideMatches({ claimType: null, reasonCode: null, isActive: true }, 'warranty', 'defective')).toBe(true)
    expect(guideMatches({ claimType: 'warranty', reasonCode: null, isActive: true }, 'warranty', 'defective')).toBe(true)
    expect(guideMatches({ claimType: null, reasonCode: 'defective', isActive: true }, 'return', 'defective')).toBe(true)
    expect(guideMatches({ claimType: 'return', reasonCode: null, isActive: true }, 'warranty', 'defective')).toBe(false)
    expect(guideMatches({ claimType: null, reasonCode: 'other', isActive: true }, 'warranty', 'defective')).toBe(false)
    expect(guideMatches({ claimType: null, reasonCode: null, isActive: false }, 'warranty', 'defective')).toBe(false)
  })

  test('selectBestGuide prefers the most specific matching guide', () => {
    const guides = [
      { id: 'any', claimType: null, reasonCode: null, isActive: true },
      { id: 'claim-type', claimType: 'warranty', reasonCode: null, isActive: true },
      { id: 'reason', claimType: null, reasonCode: 'defective', isActive: true },
      { id: 'exact', claimType: 'warranty', reasonCode: 'defective', isActive: true },
      { id: 'inactive-exact', claimType: 'warranty', reasonCode: 'defective', isActive: false },
    ]

    expect(selectBestGuide(guides, 'warranty', 'defective')?.id).toBe('exact')
    expect(selectBestGuide(guides, 'return', 'defective')?.id).toBe('reason')
    expect(selectBestGuide(guides, 'return', 'unknown')?.id).toBe('any')
  })
})
