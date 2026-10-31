import { IMAGE_LIMITS } from '../generation/imageInputs.mjs'

export const MAX_IMAGE_SOURCE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 1536
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'
const supportedTypes = new Set(IMAGE_ACCEPT.split(','))
const imageExtension = /\.(?:png|jpe?g|webp|gif|bmp|avif|heic|heif|tiff?)$/i

// Reading clipboardData synchronously is important: browsers discard it once the
// paste handler returns. The resulting File objects remain available to decode.
export function transferImageFiles(transfer) {
  if (!transfer) return []
  const fromItems = Array.from(transfer.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile?.())
    .filter(Boolean)
  const files = fromItems.length ? fromItems : Array.from(transfer.files || [])
  return files.filter(file => String(file.type || '').startsWith('image/') || imageExtension.test(file.name || ''))
}

export function transferHasFiles(transfer) {
  return Array.from(transfer?.types || []).includes('Files') ||
    Array.from(transfer?.items || []).some(item => item.kind === 'file')
}

export function imageByteSize(image) {
  const base64 = String(image.dataUrl || '').split(',')[1] || ''
  return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
}

async function dataUrlFor(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${blob.type};base64,${globalThis.btoa(binary)}`
}

async function decodeBrowserImage(file) {
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const bitmap = await globalThis.createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch { /* Some browser/image combinations require the Image decoder. */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const element = new Image()
    await new Promise((resolve, reject) => {
      element.onload = resolve
      element.onerror = () => reject(new Error('This image could not be read. Please use a PNG, JPEG or WebP image.'))
      element.src = url
    })
    return { source: element, width: element.naturalWidth, height: element.naturalHeight, release() {} }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('This image could not be prepared. Try a smaller image.')), type, quality)
  })
}

// Keep readable originals when small enough. Otherwise resize and encode once
// from the original pixels; WebP retains transparency for large PNG references.
export async function normalizePromptImage(file, {
  decodeImage = decodeBrowserImage,
  createCanvas = () => document.createElement('canvas'),
} = {}) {
  const type = String(file?.type || '').toLowerCase()
  if (!supportedTypes.has(type)) throw new Error('Use PNG, JPEG or WebP images.')
  if (!file.size) throw new Error('The image is empty.')
  if (file.size > MAX_IMAGE_SOURCE_BYTES) throw new Error('Choose an image smaller than 20 MB.')
  let decoded
  try {
    decoded = await decodeImage(file)
    const { width, height } = decoded
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new Error('This image has invalid dimensions.')
    }
    if (width * height > 80_000_000) throw new Error('This image is too large. Please use a smaller image.')
    let output = file
    let outputWidth = width, outputHeight = height
    if (file.size > IMAGE_LIMITS.maxImageBytes || Math.max(width, height) > MAX_IMAGE_DIMENSION) {
      const canvas = createCanvas()
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser could not prepare the image.')
      let scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height))
      let prepared = false
      for (let pass = 0; pass < 6 && !prepared; pass++) {
        outputWidth = canvas.width = Math.max(1, Math.round(width * scale))
        outputHeight = canvas.height = Math.max(1, Math.round(height * scale))
        context.drawImage(decoded.source, 0, 0, outputWidth, outputHeight)
        if (type === 'image/png') {
          output = await canvasBlob(canvas, 'image/png')
          prepared = output.size <= IMAGE_LIMITS.maxImageBytes
        }
        if (!prepared) {
          for (const quality of [0.9, 0.78, 0.64, 0.5]) {
            output = await canvasBlob(canvas, type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', quality)
            if (output.size <= IMAGE_LIMITS.maxImageBytes) { prepared = true; break }
          }
        }
        scale *= 0.75
      }
      if (!prepared) throw new Error('The image is still too large. Please crop it or choose a smaller image.')
    }
    if (!supportedTypes.has(output.type)) throw new Error('This browser could not encode the image.')
    return {
      name: String(file.name || 'Pasted image').slice(0, 160),
      mimeType: output.type,
      dataUrl: await dataUrlFor(output),
      width: outputWidth,
      height: outputHeight,
    }
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error('This image could not be read. Please try another image.')
  } finally {
    decoded?.release?.()
  }
}
