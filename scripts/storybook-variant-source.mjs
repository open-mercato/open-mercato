export function buildVariantStory(variantId) {
  const exportName = variantId.split(/[^a-zA-Z0-9]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  const literal = JSON.stringify(variantId).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return `export const Variant${exportName}: Story = { name: ${literal}, render: () => <EntryVariant entry={entry} variantId={${literal}} />, parameters: { docs: { source: { code: entry.variants.find(variant => variant.id === ${literal})!.code } } } }`
}
