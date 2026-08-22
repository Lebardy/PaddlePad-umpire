import { randomInt } from 'node:crypto'

// Codes get read aloud, texted, and typed on phones, so the alphabet
// excludes characters that are easy to confuse: 0/O, 1/I/L, 5/S, 8/B.
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789'
const GROUPS = 3
const GROUP_LENGTH = 4

/**
 * Generates a code like `PAD-7K3M-9QXR`. Three groups of four from a
 * 27-character alphabet is about 57 bits of entropy, which is far
 * beyond guessing range for a single-use code, especially behind the
 * rate limiter on /auth/register.
 *
 * randomInt (not Math.random) because these are a security boundary:
 * anyone holding a valid code can create an account.
 */
export function generateInviteCode() {
  const groups = []
  for (let g = 0; g < GROUPS; g += 1) {
    let group = ''
    for (let i = 0; i < GROUP_LENGTH; i += 1) {
      group += ALPHABET[randomInt(ALPHABET.length)]
    }
    groups.push(group)
  }
  return groups.join('-')
}

/**
 * Accepts codes typed with any casing, spaces instead of dashes, or
 * no separators at all, and normalizes them back to the canonical
 * stored form. Someone reading a code over the phone shouldn't fail
 * because they typed `pad 7k3m 9qxr`.
 */
export function normalizeInviteCode(value) {
  const cleaned = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

  if (cleaned.length !== GROUPS * GROUP_LENGTH) return cleaned

  const groups = []
  for (let i = 0; i < cleaned.length; i += GROUP_LENGTH) {
    groups.push(cleaned.slice(i, i + GROUP_LENGTH))
  }
  return groups.join('-')
}
