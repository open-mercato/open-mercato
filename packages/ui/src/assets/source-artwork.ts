export type SourceArtworkGroup = 'brand' | 'country-flags' | 'emojies' | 'appstore-badges' | 'others' | 'thumbnails'

export type SourceArtwork = {
  id: string
  name: string
  group: SourceArtworkGroup
  category: string
  width: number
  height: number
  src: string
}

const loaders = {
  brand: () => import('./source-artwork-brand.generated'),
  'country-flags': () => import('./source-artwork-country-flags.generated'),
  emojies: () => import('./source-artwork-emojies.generated'),
  'appstore-badges': () => import('./source-artwork-appstore-badges.generated'),
  others: () => import('./source-artwork-others.generated'),
  thumbnails: () => import('./source-artwork-thumbnails.generated'),
}

export async function loadSourceArtwork(group: SourceArtworkGroup): Promise<readonly SourceArtwork[]> {
  return (await loaders[group]()).artwork
}
