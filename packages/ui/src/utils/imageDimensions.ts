export async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => signature[index] === value)
  const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255
  if (!png && !jpeg) throw new Error('[internal] Selected image is not a PNG or JPEG')
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('[internal] Selected image could not be decoded'))
    }
    image.src = url
  })
}
