// Handing a video file to the phone: its share sheet, or a plain download.

/** Whether this browser can put a video file in the share sheet (most phones yes, most laptops no). */
export function canShareVideo() {
  try {
    return Boolean(navigator.canShare?.({ files: [new File([new Uint8Array(1)], 'clip.mp4', { type: 'video/mp4' })] }))
  } catch {
    return false
  }
}

/** Chrome refuses to share a file over 50 MiB (it answers like a cancel), so a bigger one is saved instead. */
export const SHARE_LIMIT_BYTES = 50 * 1024 * 1024

/**
 * Opens the share sheet with `file`. 'too-big' when it is over the limit (nothing is opened). 'needs-tap' when the browser refused because the
 * tap that asked was too long ago (cutting took a while): a second tap shares it.
 */
export async function shareFile(file) {
  if (file.size > SHARE_LIMIT_BYTES) return 'too-big'
  try {
    await navigator.share({ files: [file], title: file.name.replace(/\.mp4$/, '') })
    return 'shared'
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled'
    if (error?.name === 'NotAllowedError') return 'needs-tap'
    throw error
  }
}

/** Saves `blob` as a file called `name`. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
