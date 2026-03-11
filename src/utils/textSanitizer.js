/**
 * textSanitizer.js
 * Cleans text before TTS synthesis: strips markdown, emojis, URLs and code.
 */

const DEFAULT_MAX_CHARS = 1500

function getTtsMaxChars() {
  const n = parseInt(process.env.TTS_MAX_CHARS)
  return isNaN(n) || n <= 0 ? DEFAULT_MAX_CHARS : n
}

/**
 * Truncates text to maxChars at the last sentence boundary (`.`, `!`, `?`)
 * or word boundary before the limit.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncate(text, maxChars) {
  if (text.length <= maxChars) return text
  const slice = text.slice(0, maxChars)
  // Try to cut at last sentence-ending punctuation
  const lastPunct = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'))
  if (lastPunct > maxChars * 0.5) return slice.slice(0, lastPunct + 1)
  // Fall back to last space
  const lastSpace = slice.lastIndexOf(' ')
  if (lastSpace > maxChars * 0.5) return slice.slice(0, lastSpace)
  return slice
}

/**
 * Strips markdown, emojis, and URLs from text to produce clean TTS input.
 * Then truncates to TTS_MAX_CHARS.
 * @param {string} text
 * @returns {string}
 */
function sanitize(text) {
  if (!text || typeof text !== 'string') return ''

  let s = text

  // 1. Replace fenced code blocks with placeholder
  s = s.replace(/```[\s\S]*?```/g, 'bloque de código')

  // 2. Replace inline code with its content
  s = s.replace(/`([^`]+)`/g, '$1')

  // 3. Replace markdown links [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // 4. Replace raw URLs with "enlace"
  s = s.replace(/https?:\/\/\S+/g, 'enlace')

  // 5. Strip bold and italic markdown: **x**, __x__, *x*, _x_
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/_([^_]+)_/g, '$1')

  // 6. Strip heading markers: # ## ### etc.
  s = s.replace(/^#{1,6}\s+/gm, '')

  // 7. Strip blockquote markers: > text
  s = s.replace(/^>\s*/gm, '')

  // 8. Strip horizontal rules
  s = s.replace(/^[-*_]{3,}\s*$/gm, '')

  // 9. Strip list markers: - item, * item, 1. item
  s = s.replace(/^[\s]*[-*+]\s+/gm, '')
  s = s.replace(/^[\s]*\d+\.\s+/gm, '')

  // 10. Remove emojis (broad Unicode ranges covering most emoji)
  s = s.replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
  s = s.replace(/[\u{2600}-\u{27BF}]/gu, '')
  s = s.replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
  s = s.replace(/[\u{FE00}-\u{FE0F}]/gu, '')  // variation selectors
  s = s.replace(/[\u{20D0}-\u{20FF}]/gu, '')  // combining marks

  // 11. Collapse multiple newlines to a single space (TTS reads linearly)
  s = s.replace(/\n+/g, ' ')

  // 12. Collapse multiple spaces
  s = s.replace(/\s{2,}/g, ' ')

  s = s.trim()

  // 13. Truncate
  return truncate(s, getTtsMaxChars())
}

module.exports = { sanitize, truncate }
