import {
  validateOmBackground,
  validateOmColor,
  validateOmFieldStyle,
  validateOmSectionStyle,
  validateOmTheme,
} from '../schema/style-validators'

describe('validateOmColor (R-CS-1 security core)', () => {
  it('rejects the CSS-injection / XSS attack corpus', () => {
    const attacks = [
      'red;}body{background:red}',
      'url(javascript:alert(1))',
      'var(--x)',
      'expression(alert(1))',
      '</style><script>alert(1)</script>',
      '#fff" onload="alert(1)',
      'rgb(0,0,0)',
      'rgba(0,0,0,1)',
      'hsl(0,0%,0%)',
      'red',
      'transparent ',
      'calc(1px)',
      '#xyz',
      '#12',
      '#12345',
      '#1234567',
      '#1234567890',
      '',
    ]
    for (const attack of attacks) {
      expect(validateOmColor(attack)).not.toBeNull()
    }
  })

  it('rejects non-string colors', () => {
    expect(validateOmColor(42)).not.toBeNull()
    expect(validateOmColor(null)).not.toBeNull()
    expect(validateOmColor({})).not.toBeNull()
  })

  it('accepts curated tokens', () => {
    for (const token of [
      'surface',
      'surface-muted',
      'foreground',
      'muted-foreground',
      'accent',
      'border',
      'transparent',
      'inherit',
    ]) {
      expect(validateOmColor(token)).toBeNull()
    }
  })

  it('accepts strict hex literals (#rgb, #rrggbb, #rrggbbaa)', () => {
    expect(validateOmColor('#fff')).toBeNull()
    expect(validateOmColor('#0F766E')).toBeNull()
    expect(validateOmColor('#0f766eff')).toBeNull()
    expect(validateOmColor('#abc123')).toBeNull()
  })
})

describe('validateOmBackground', () => {
  it('accepts kind none with no other keys', () => {
    expect(validateOmBackground({ kind: 'none' })).toBeNull()
  })

  it('rejects extra keys on kind none', () => {
    expect(validateOmBackground({ kind: 'none', color: '#fff' })).not.toBeNull()
  })

  it('accepts kind color with valid color', () => {
    expect(validateOmBackground({ kind: 'color', color: '#fff' })).toBeNull()
    expect(validateOmBackground({ kind: 'color', color: 'surface' })).toBeNull()
  })

  it('rejects kind color with invalid color', () => {
    expect(validateOmBackground({ kind: 'color', color: 'rgb(0,0,0)' })).not.toBeNull()
    expect(validateOmBackground({ kind: 'color' })).not.toBeNull()
  })

  it('accepts kind gradient with valid colors and in-range integer angle', () => {
    expect(validateOmBackground({ kind: 'gradient', from: '#000', to: '#fff', angle: 0 })).toBeNull()
    expect(validateOmBackground({ kind: 'gradient', from: '#000', to: '#fff', angle: 360 })).toBeNull()
    expect(validateOmBackground({ kind: 'gradient', from: 'accent', to: '#fff', angle: 90 })).toBeNull()
  })

  it('rejects out-of-range or non-integer gradient angle', () => {
    expect(validateOmBackground({ kind: 'gradient', from: '#000', to: '#fff', angle: -1 })).not.toBeNull()
    expect(validateOmBackground({ kind: 'gradient', from: '#000', to: '#fff', angle: 361 })).not.toBeNull()
    expect(validateOmBackground({ kind: 'gradient', from: '#000', to: '#fff', angle: 90.5 })).not.toBeNull()
  })

  it('rejects gradient with bad color stops', () => {
    expect(validateOmBackground({ kind: 'gradient', from: 'url(x)', to: '#fff', angle: 90 })).not.toBeNull()
    expect(validateOmBackground({ kind: 'gradient', from: '#000', to: 'red', angle: 90 })).not.toBeNull()
  })

  it('rejects unknown kind and non-object', () => {
    expect(validateOmBackground({ kind: 'image', assetId: 'x' })).not.toBeNull()
    expect(validateOmBackground({ kind: 'video' })).not.toBeNull()
    expect(validateOmBackground('none')).not.toBeNull()
    expect(validateOmBackground(null)).not.toBeNull()
  })

  it('rejects unknown keys on gradient', () => {
    expect(
      validateOmBackground({ kind: 'gradient', from: '#000', to: '#fff', angle: 90, evil: 1 }),
    ).not.toBeNull()
  })
})

describe('validateOmTheme', () => {
  it('accepts a full valid theme', () => {
    expect(
      validateOmTheme({
        background: { kind: 'gradient', from: '#0f766e', to: '#fff', angle: 135 },
        surface: '#ffffff',
        foreground: 'foreground',
        accent: '#0f766e',
        border: 'border',
        fontFamily: 'serif',
        fontScale: 'lg',
        radius: 'full',
        contentWidth: 'md',
      }),
    ).toBeNull()
  })

  it('accepts an empty theme', () => {
    expect(validateOmTheme({})).toBeNull()
  })

  it('rejects unknown keys', () => {
    expect(validateOmTheme({ evil: 'x' })).not.toBeNull()
    expect(validateOmTheme({ surface: '#fff', css: 'body{}' })).not.toBeNull()
  })

  it('rejects bad enum members and colors', () => {
    expect(validateOmTheme({ fontFamily: 'comic-sans' })).not.toBeNull()
    expect(validateOmTheme({ radius: 'huge' })).not.toBeNull()
    expect(validateOmTheme({ accent: 'rgb(0,0,0)' })).not.toBeNull()
    expect(validateOmTheme({ background: { kind: 'image' } })).not.toBeNull()
  })

  it('rejects non-object', () => {
    expect(validateOmTheme('x')).not.toBeNull()
    expect(validateOmTheme([])).not.toBeNull()
  })

  it('accepts form-level labelColor + labelWeight, rejects a bad weight', () => {
    expect(validateOmTheme({ labelColor: '#0f766e', labelWeight: 'semibold' })).toBeNull()
    expect(validateOmTheme({ labelColor: 'foreground' })).toBeNull()
    expect(validateOmTheme({ labelWeight: 'heavy' })).not.toBeNull()
    expect(validateOmTheme({ labelColor: 'rgb(0,0,0)' })).not.toBeNull()
  })

  it('accepts form-level inputText, rejects non-color values', () => {
    expect(validateOmTheme({ inputText: '#ffffff' })).toBeNull()
    expect(validateOmTheme({ inputText: 'foreground' })).toBeNull()
    expect(validateOmTheme({ inputText: 'rgb(255,255,255)' })).not.toBeNull()
    expect(validateOmTheme({ inputText: 42 as never })).not.toBeNull()
  })

  it('accepts a valid logo (assetId UUID + optional hints)', () => {
    expect(
      validateOmTheme({
        logo: {
          assetId: '3ce4cd96-c236-4069-8ce4-e21de6c0cdee',
          alt: 'Acme',
          align: 'center',
          size: 'lg',
        },
      }),
    ).toBeNull()
  })

  it('rejects a logo with a non-UUID assetId, unknown key, bad enum, or URL', () => {
    expect(validateOmTheme({ logo: { assetId: 'not-a-uuid' } })).not.toBeNull()
    // No author-supplied URLs — only an assetId.
    expect(
      validateOmTheme({ logo: { assetId: '3ce4cd96-c236-4069-8ce4-e21de6c0cdee', src: 'https://evil/x.png' } }),
    ).not.toBeNull()
    expect(
      validateOmTheme({ logo: { assetId: '3ce4cd96-c236-4069-8ce4-e21de6c0cdee', size: 'huge' } }),
    ).not.toBeNull()
    expect(
      validateOmTheme({
        logo: { assetId: '3ce4cd96-c236-4069-8ce4-e21de6c0cdee', alt: 'x'.repeat(301) },
      }),
    ).not.toBeNull()
  })
})

describe('validateOmSectionStyle', () => {
  it('accepts a full valid section style', () => {
    expect(
      validateOmSectionStyle({
        background: { kind: 'color', color: 'surface-muted' },
        foreground: '#111111',
        padding: 'lg',
        border: 'subtle',
        radius: 'md',
        card: true,
        align: 'center',
      }),
    ).toBeNull()
  })

  it('rejects unknown keys', () => {
    expect(validateOmSectionStyle({ shadow: 'big' })).not.toBeNull()
  })

  it('rejects bad members', () => {
    expect(validateOmSectionStyle({ padding: 'enormous' })).not.toBeNull()
    expect(validateOmSectionStyle({ border: 'glow' })).not.toBeNull()
    expect(validateOmSectionStyle({ card: 'yes' })).not.toBeNull()
    expect(validateOmSectionStyle({ align: 'justify' })).not.toBeNull()
    expect(validateOmSectionStyle({ foreground: 'var(--x)' })).not.toBeNull()
  })
})

describe('validateOmFieldStyle', () => {
  it('accepts a full valid field style', () => {
    expect(
      validateOmFieldStyle({
        labelWeight: 'semibold',
        labelColor: '#0f766e',
        textColor: 'muted-foreground',
        accent: '#abcdef',
        align: 'end',
      }),
    ).toBeNull()
  })

  it('rejects unknown keys', () => {
    expect(validateOmFieldStyle({ fontSize: '13px' })).not.toBeNull()
  })

  it('rejects bad members', () => {
    expect(validateOmFieldStyle({ labelWeight: 'black' })).not.toBeNull()
    expect(validateOmFieldStyle({ labelColor: 'red' })).not.toBeNull()
    expect(validateOmFieldStyle({ align: 'top' })).not.toBeNull()
    expect(validateOmFieldStyle({ textColor: 'expression(1)' })).not.toBeNull()
  })

  it('rejects non-object', () => {
    expect(validateOmFieldStyle(null)).not.toBeNull()
  })
})
