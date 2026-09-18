import type { BrandStyle } from '@open-mercato/ui/theme/brand-style'
import type { ColorStudio } from './colorStudio'

export function studioBrandStyle(studio: ColorStudio, logo: string | null): BrandStyle {
  const theme = (mode: 'light' | 'dark') => {
    const tokens = studio[mode].tokens
    return {
      '--primary': tokens['--primary'],
      '--primary-hover': tokens['--primary-hover'],
      '--primary-foreground': tokens['--primary-foreground'],
      '--brand-lime': studio.secondaryScale.find(stop => stop.step === 200)!.hex,
      '--brand-yellow': studio.scale.find(stop => stop.step === 200)!.hex,
      '--brand-violet': studio.tertiaryScale.find(stop => stop.step === 200)!.hex,
      '--brand-violet-foreground': '#000000',
    }
  }
  return { version: 1, logo, seeds: studio.seeds, actionShades: { light: studio.light.actionStep, dark: studio.dark.actionStep }, light: theme('light'), dark: theme('dark') }
}

export function readBrandLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return Promise.reject(new Error('fileType'))
  if (file.size > 1024 * 1024) return Promise.reject(new Error('fileSize'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('fileDecode'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') { reject(new Error('fileDecode')); return }
      const data = reader.result
      const image = new Image()
      image.onerror = () => reject(new Error('fileDecode'))
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) {
          reject(new Error('fileDimensions'))
          return
        }
        resolve(data)
      }
      image.src = data
    }
    reader.readAsDataURL(file)
  })
}
