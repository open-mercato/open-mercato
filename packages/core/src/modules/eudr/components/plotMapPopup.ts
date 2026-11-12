export function createPlotMapPopupContent(name: string): HTMLElement {
  const content = document.createElement('span')
  content.textContent = name
  return content
}
