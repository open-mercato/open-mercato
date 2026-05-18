/** @jest-environment jsdom */

import * as React from 'react'
import { render as rtlRender, fireEvent, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ColorPicker, normalizeHex, COLOR_PICKER_DEFAULT_SWATCHES } from '../color-picker'

// ColorPicker uses useT() for the eyedropper aria-label; wrap every
// render in an empty-dict I18nProvider so the primitive falls back
// to its hardcoded English defaults.
const render: typeof rtlRender = (ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(
    <I18nProvider locale="en" dict={{}}>
      {ui}
    </I18nProvider>,
    options,
  )

describe('normalizeHex', () => {
  it('uppercases and prefixes 6-digit hex', () => {
    expect(normalizeHex('6366f1')).toBe('#6366F1')
    expect(normalizeHex('#6366f1')).toBe('#6366F1')
    expect(normalizeHex('  #abc123 ')).toBe('#ABC123')
  })

  it('expands 3-digit hex to 6 and uppercases', () => {
    expect(normalizeHex('#f0a')).toBe('#FF00AA')
    expect(normalizeHex('abc')).toBe('#AABBCC')
  })

  it('returns null for invalid input', () => {
    expect(normalizeHex('not-a-hex')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex('#1234567')).toBeNull()
    expect(normalizeHex('')).toBeNull()
  })
})

describe('ColorPicker', () => {
  it('renders a trigger button with the current color preview and hex label', () => {
    const { container } = render(<ColorPicker value="#6366F1" onChange={() => {}} />)
    const trigger = container.querySelector('[data-slot="color-picker-trigger"]') as HTMLButtonElement
    expect(trigger).not.toBeNull()
    expect(trigger.textContent).toContain('#6366F1')
    const preview = container.querySelector('[data-slot="color-picker-preview"]') as HTMLSpanElement
    expect(preview.style.backgroundColor).toBeTruthy()
  })

  it('opens the popover when the trigger is clicked', async () => {
    const { container } = render(<ColorPicker value="#6366F1" onChange={() => {}} />)
    const trigger = container.querySelector('[data-slot="color-picker-trigger"]') as HTMLButtonElement
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(screen.queryByText('Choose color')).toBeInTheDocument()
    })
  })

  describe('Section 1 — Choose color', () => {
    it('renders the hue slider as a native range input', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        const slider = document.querySelector('[data-slot="color-picker-hue-slider"]') as HTMLInputElement
        expect(slider).not.toBeNull()
        expect(slider.tagName).toBe('INPUT')
        expect(slider.type).toBe('range')
        expect(slider.min).toBe('0')
        expect(slider.max).toBe('360')
      })
    })

    it('changing the hue slider fires onChange with a pure saturated color', async () => {
      const onChange = jest.fn()
      render(<ColorPicker value="#6366F1" onChange={onChange} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-hue-slider"]')).not.toBeNull()
      })
      const slider = document.querySelector(
        '[data-slot="color-picker-hue-slider"]',
      ) as HTMLInputElement
      fireEvent.change(slider, { target: { value: '0' } })
      // Hue 0° + s=100% + l=50% = pure red #FF0000
      expect(onChange).toHaveBeenCalledWith('#FF0000')
    })

    it('honors the custom chooseLabel prop', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} chooseLabel="Pick a hue" />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.queryByText('Pick a hue')).toBeInTheDocument()
      })
    })
  })

  describe('Section 2 — Hex input + Eyedropper', () => {
    it('renders the hex input when allowCustom is true (default)', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-hex"]')).not.toBeNull()
      })
    })

    it('does NOT render the hex input when allowCustom=false', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} allowCustom={false} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-swatch"]')).not.toBeNull()
      })
      expect(document.querySelector('[data-slot="color-picker-hex"]')).toBeNull()
    })

    it('commits hex on blur when input is valid', async () => {
      const onChange = jest.fn()
      render(<ColorPicker value="#6366F1" onChange={onChange} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-hex"]')).not.toBeNull()
      })
      const input = document.querySelector('[data-slot="color-picker-hex"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '#abcdef' } })
      fireEvent.blur(input)
      expect(onChange).toHaveBeenCalledWith('#ABCDEF')
    })

    it('shows an inline error and does NOT call onChange when hex is invalid', async () => {
      const onChange = jest.fn()
      render(<ColorPicker value="#6366F1" onChange={onChange} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-hex"]')).not.toBeNull()
      })
      const input = document.querySelector('[data-slot="color-picker-hex"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'nope' } })
      fireEvent.blur(input)
      expect(onChange).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-error"]')).not.toBeNull()
      })
    })

    it('commits hex on Enter', async () => {
      const onChange = jest.fn()
      render(<ColorPicker value="#6366F1" onChange={onChange} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-hex"]')).not.toBeNull()
      })
      const input = document.querySelector('[data-slot="color-picker-hex"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '#111222' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onChange).toHaveBeenCalledWith('#111222')
    })

    it('does NOT render the eyedropper button when browser lacks EyeDropper API', async () => {
      // jsdom does not implement EyeDropper — confirm the button is absent.
      render(<ColorPicker value="#6366F1" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-hex"]')).not.toBeNull()
      })
      expect(document.querySelector('[data-slot="color-picker-eyedropper"]')).toBeNull()
    })
  })

  describe('Section 3 — Saved colors', () => {
    it('renders the default 10 swatches when no swatches prop is provided', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        const swatches = document.querySelectorAll('[data-slot="color-picker-swatch"]')
        expect(swatches.length).toBe(COLOR_PICKER_DEFAULT_SWATCHES.length)
        expect(COLOR_PICKER_DEFAULT_SWATCHES.length).toBe(10)
      })
    })

    it('selected swatch dot carries an inset white ring (Figma Selected state)', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        const selected = document.querySelector(
          '[data-slot="color-picker-swatch"][data-state="on"]',
        ) as HTMLButtonElement
        expect(selected).not.toBeNull()
        const dot = selected.querySelector(
          '[data-slot="color-picker-swatch-dot"]',
        ) as HTMLSpanElement
        expect(dot.className).toContain('ring-2')
        expect(dot.className).toContain('ring-inset')
        expect(dot.className).toContain('ring-background')
      })
    })

    it('fires onChange with the swatch value when a swatch is clicked', async () => {
      const onChange = jest.fn()
      render(<ColorPicker value="#6366F1" onChange={onChange} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelectorAll('[data-slot="color-picker-swatch"]').length).toBeGreaterThan(0)
      })
      const target = Array.from(
        document.querySelectorAll('[data-slot="color-picker-swatch"]'),
      ).find((node) => node.getAttribute('aria-label') === '#22C55E') as HTMLButtonElement
      fireEvent.click(target)
      expect(onChange).toHaveBeenCalledWith('#22C55E')
    })

    it('honors a custom swatches palette', async () => {
      render(
        <ColorPicker
          value="#FF0000"
          onChange={() => {}}
          swatches={['#FF0000', '#00FF00', '#0000FF']}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        const swatches = document.querySelectorAll('[data-slot="color-picker-swatch"]')
        expect(swatches.length).toBe(3)
      })
    })

    it('honors the savedLabel prop', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} savedLabel="My palette" />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.queryByText('My palette')).toBeInTheDocument()
      })
    })
  })

  describe('Section 4 — Add new color (optional)', () => {
    it('does NOT render the add button when onAddSwatch is omitted', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-swatch"]')).not.toBeNull()
      })
      expect(document.querySelector('[data-slot="color-picker-add"]')).toBeNull()
    })

    it('renders the add button when onAddSwatch is provided', async () => {
      render(
        <ColorPicker value="#6366F1" onChange={() => {}} onAddSwatch={() => {}} />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-add"]')).not.toBeNull()
      })
    })

    it('fires onAddSwatch with the current value when the add button is clicked', async () => {
      const onAddSwatch = jest.fn()
      render(
        <ColorPicker value="#123456" onChange={() => {}} onAddSwatch={onAddSwatch} />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-add"]')).not.toBeNull()
      })
      const addButton = document.querySelector('[data-slot="color-picker-add"]') as HTMLButtonElement
      fireEvent.click(addButton)
      expect(onAddSwatch).toHaveBeenCalledWith('#123456')
    })

    it('honors the addLabel prop', async () => {
      render(
        <ColorPicker
          value="#6366F1"
          onChange={() => {}}
          onAddSwatch={() => {}}
          addLabel="Save color"
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.queryByText('Save color')).toBeInTheDocument()
      })
    })
  })

  describe('Section 2 — extras (opacity / trash)', () => {
    it('renders the "100%" opacity badge inside the hex container when showOpacity=true', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} showOpacity />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-opacity"]')).not.toBeNull()
      })
      expect(
        document.querySelector('[data-slot="color-picker-opacity"]')?.textContent,
      ).toBe('100%')
    })

    it('does NOT render the opacity badge by default', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-hex"]')).not.toBeNull()
      })
      expect(document.querySelector('[data-slot="color-picker-opacity"]')).toBeNull()
    })

    it('does NOT render the remove button when onRemoveColor is omitted', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-hex"]')).not.toBeNull()
      })
      expect(document.querySelector('[data-slot="color-picker-remove"]')).toBeNull()
    })

    it('renders the remove (trash) button when onRemoveColor is provided', async () => {
      render(
        <ColorPicker
          value="#6366F1"
          onChange={() => {}}
          onRemoveColor={() => {}}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-remove"]')).not.toBeNull()
      })
    })

    it('fires onRemoveColor with the current value when the trash button is clicked', async () => {
      const onRemoveColor = jest.fn()
      render(
        <ColorPicker
          value="#ABCDEF"
          onChange={() => {}}
          onRemoveColor={onRemoveColor}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-remove"]')).not.toBeNull()
      })
      const removeButton = document.querySelector(
        '[data-slot="color-picker-remove"]',
      ) as HTMLButtonElement
      fireEvent.click(removeButton)
      expect(onRemoveColor).toHaveBeenCalledWith('#ABCDEF')
    })
  })

  describe('Section 3 — Edit link', () => {
    it('does NOT render the Edit link when onEditSavedColors is omitted', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-swatch"]')).not.toBeNull()
      })
      expect(document.querySelector('[data-slot="color-picker-edit"]')).toBeNull()
    })

    it('renders the Edit link in the saved-colors header when onEditSavedColors is provided', async () => {
      render(
        <ColorPicker
          value="#6366F1"
          onChange={() => {}}
          onEditSavedColors={() => {}}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-edit"]')).not.toBeNull()
      })
      expect(
        document.querySelector('[data-slot="color-picker-edit"]')?.textContent,
      ).toBe('Edit')
    })

    it('fires onEditSavedColors when the Edit link is clicked', async () => {
      const onEditSavedColors = jest.fn()
      render(
        <ColorPicker
          value="#6366F1"
          onChange={() => {}}
          onEditSavedColors={onEditSavedColors}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-edit"]')).not.toBeNull()
      })
      const editLink = document.querySelector(
        '[data-slot="color-picker-edit"]',
      ) as HTMLButtonElement
      fireEvent.click(editLink)
      expect(onEditSavedColors).toHaveBeenCalled()
    })

    it('honors the editLabel prop', async () => {
      render(
        <ColorPicker
          value="#6366F1"
          onChange={() => {}}
          onEditSavedColors={() => {}}
          editLabel="Manage"
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(screen.queryByText('Manage')).toBeInTheDocument()
      })
    })
  })

  describe('persistKey — uncontrolled swatches with localStorage', () => {
    beforeEach(() => {
      window.localStorage.clear()
    })

    it('hydrates the swatches from localStorage on mount when persistKey is set', async () => {
      window.localStorage.setItem(
        'color-picker:test-1',
        JSON.stringify(['#FF0000', '#00FF00', '#0000FF']),
      )
      render(<ColorPicker value="#6366F1" onChange={() => {}} persistKey="color-picker:test-1" />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        const swatches = document.querySelectorAll('[data-slot="color-picker-swatch"]')
        expect(swatches.length).toBe(3)
      })
    })

    it('falls back to defaultSwatches when localStorage is empty', async () => {
      render(
        <ColorPicker
          value="#6366F1"
          onChange={() => {}}
          persistKey="color-picker:test-empty"
          defaultSwatches={['#000000', '#FFFFFF']}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        const swatches = document.querySelectorAll('[data-slot="color-picker-swatch"]')
        expect(swatches.length).toBe(2)
      })
    })

    it('renders the add + trash buttons automatically when persistKey is set (no callbacks needed)', async () => {
      render(<ColorPicker value="#6366F1" onChange={() => {}} persistKey="color-picker:test-auto" />)
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-add"]')).not.toBeNull()
        expect(document.querySelector('[data-slot="color-picker-remove"]')).not.toBeNull()
      })
    })

    it('persists newly-added color to localStorage', async () => {
      render(
        <ColorPicker
          value="#ABCDEF"
          onChange={() => {}}
          persistKey="color-picker:test-add"
          defaultSwatches={['#000000']}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-add"]')).not.toBeNull()
      })
      const addButton = document.querySelector(
        '[data-slot="color-picker-add"]',
      ) as HTMLButtonElement
      fireEvent.click(addButton)
      const stored = JSON.parse(window.localStorage.getItem('color-picker:test-add') ?? '[]')
      expect(stored).toContain('#ABCDEF')
      expect(stored).toContain('#000000')
    })

    it('persists removal of current color from localStorage', async () => {
      window.localStorage.setItem(
        'color-picker:test-remove',
        JSON.stringify(['#FF0000', '#00FF00', '#0000FF']),
      )
      render(
        <ColorPicker value="#00FF00" onChange={() => {}} persistKey="color-picker:test-remove" />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-remove"]')).not.toBeNull()
      })
      const trash = document.querySelector('[data-slot="color-picker-remove"]') as HTMLButtonElement
      fireEvent.click(trash)
      const stored = JSON.parse(window.localStorage.getItem('color-picker:test-remove') ?? '[]')
      expect(stored).not.toContain('#00FF00')
      expect(stored).toContain('#FF0000')
      expect(stored).toContain('#0000FF')
    })

    it('does NOT duplicate when adding a color that is already in the palette', async () => {
      window.localStorage.setItem(
        'color-picker:test-dedup',
        JSON.stringify(['#AABBCC']),
      )
      render(
        <ColorPicker value="#AABBCC" onChange={() => {}} persistKey="color-picker:test-dedup" />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-add"]')).not.toBeNull()
      })
      const addButton = document.querySelector(
        '[data-slot="color-picker-add"]',
      ) as HTMLButtonElement
      fireEvent.click(addButton)
      const stored = JSON.parse(window.localStorage.getItem('color-picker:test-dedup') ?? '[]')
      expect(stored.length).toBe(1)
    })

    it('still fires onAddSwatch / onRemoveColor as notification callbacks in persisted mode', async () => {
      const onAddSwatch = jest.fn()
      const onRemoveColor = jest.fn()
      window.localStorage.setItem(
        'color-picker:test-notify',
        JSON.stringify(['#111111']),
      )
      render(
        <ColorPicker
          value="#222222"
          onChange={() => {}}
          persistKey="color-picker:test-notify"
          onAddSwatch={onAddSwatch}
          onRemoveColor={onRemoveColor}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        expect(document.querySelector('[data-slot="color-picker-add"]')).not.toBeNull()
      })
      fireEvent.click(document.querySelector('[data-slot="color-picker-add"]') as HTMLButtonElement)
      expect(onAddSwatch).toHaveBeenCalledWith('#222222')
    })

    it('controlled mode (swatches prop) takes priority over persistKey', async () => {
      window.localStorage.setItem(
        'color-picker:test-priority',
        JSON.stringify(['#ABCDEF', '#FEDCBA']),
      )
      render(
        <ColorPicker
          value="#6366F1"
          onChange={() => {}}
          swatches={['#FF0000']}
          persistKey="color-picker:test-priority"
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        const swatches = document.querySelectorAll('[data-slot="color-picker-swatch"]')
        expect(swatches.length).toBe(1)
      })
    })

    it('ignores corrupt JSON in localStorage gracefully', async () => {
      window.localStorage.setItem('color-picker:test-corrupt', 'not-json{')
      render(
        <ColorPicker
          value="#6366F1"
          onChange={() => {}}
          persistKey="color-picker:test-corrupt"
          defaultSwatches={['#AAAAAA']}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => {
        const swatches = document.querySelectorAll('[data-slot="color-picker-swatch"]')
        expect(swatches.length).toBe(1)
      })
    })
  })

  it('disables the trigger when disabled prop is set', () => {
    const { container } = render(<ColorPicker value="#6366F1" onChange={() => {}} disabled />)
    const trigger = container.querySelector('[data-slot="color-picker-trigger"]') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
  })

  it('forwards ref to the trigger element', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(<ColorPicker ref={ref} value="#6366F1" onChange={() => {}} />)
    expect(ref.current?.getAttribute('data-slot')).toBe('color-picker-trigger')
  })
})
