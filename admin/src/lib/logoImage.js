// ============================================================
// A facility logo, shrunk in the browser before it is uploaded.
//
// Two copies: one fitting inside 512 x 512 for the facility page, one
// inside 128 x 128 for lists. The longest side is shrunk to the box and
// the shape kept -- a wide logo stays wide; the display tile fits it.
// Saved as WebP where the browser can make one (Safari cannot, and
// quietly hands back a PNG instead), else PNG, and JPEG only when a PNG
// would be over the server's 300 KB cap (a photo, which has no
// see-through parts to lose). The server checks everything again.
// ============================================================

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const MAX_PICKED_BYTES = 10 * 1024 * 1024
const FULL_BOX = 512
const SMALL_BOX = 128
const FULL_MAX_BYTES = 300 * 1024

/** The size a picture is drawn at to fit inside `box`, never enlarged. */
export function fitWithin(width, height, box) {
  const scale = Math.min(1, box / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Why a picked file is refused before anything is read, or null. */
export function pickProblem(file) {
  if (!LOGO_TYPES.includes(file.type)) return 'Pick a PNG, JPEG or WebP picture.'
  if (file.size > MAX_PICKED_BYTES) return 'That picture is over 10 MB. Pick a smaller one.'
  return null
}

function draw(bitmap, box) {
  const size = fitWithin(bitmap.width, bitmap.height, box)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  return canvas
}

function toBlob(canvas, type) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, type === 'image/png' ? undefined : 0.9))
}

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Both copies of `file` as data addresses of the same type, ready for
 * uploadFacilityLogo. Rejects when the file can't be read as a picture.
 */
export async function prepareLogo(file) {
  const bitmap = await createImageBitmap(file)
  const full = draw(bitmap, FULL_BOX)
  const small = draw(bitmap, SMALL_BOX)
  bitmap.close?.()

  let type = 'image/webp'
  let fullBlob = await toBlob(full, type)
  if (fullBlob?.type !== 'image/webp') {
    type = 'image/png'
    fullBlob = await toBlob(full, type)
  }
  if (fullBlob.size > FULL_MAX_BYTES) {
    type = 'image/jpeg'
    fullBlob = await toBlob(full, type)
  }
  const smallBlob = await toBlob(small, type)
  return { full: await toDataUrl(fullBlob), small: await toDataUrl(smallBlob) }
}
