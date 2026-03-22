'use strict'

/**
 * AES-256-GCM encryption helpers for at-rest data (sessions, memories).
 *
 * Usage:
 *   Set SESSION_SECRET in .env to enable encryption.
 *   If SESSION_SECRET is not set, encrypt() returns null and all data
 *   is stored as plain text (backward-compatible).
 *
 * Encrypted payload format (JSON):
 *   { "v": 2, "iv": "<hex>", "tag": "<hex>", "data": "<hex>" }
 */

const crypto = require('crypto')

const ALGORITHM  = 'aes-256-gcm'
const IV_LENGTH  = 12   // bytes — recommended for GCM
const TAG_LENGTH = 16   // bytes

/** Derive a 32-byte key from SESSION_SECRET using SHA-256. Returns null if secret not set. */
function _getKey() {
  const secret = process.env.SESSION_SECRET
  if (!secret) return null
  return crypto.createHash('sha256').update(secret).digest()
}

/** Returns true if SESSION_SECRET is set and encryption is active. */
function isEncryptionEnabled() {
  return !!process.env.SESSION_SECRET
}

/**
 * Encrypt a plaintext string.
 * Returns an encrypted JSON string, or null if SESSION_SECRET is not set.
 * @param {string} plaintext
 * @returns {string|null}
 */
function encrypt(plaintext) {
  const key = _getKey()
  if (!key) return null

  const iv      = crypto.randomBytes(IV_LENGTH)
  const cipher  = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH })
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag     = cipher.getAuthTag()

  return JSON.stringify({
    v:    2,
    iv:   iv.toString('hex'),
    tag:  tag.toString('hex'),
    data: enc.toString('hex'),
  })
}

/**
 * Decrypt a previously encrypted string.
 * Returns the original plaintext, or null if decryption fails or is disabled.
 * @param {string} ciphertext  JSON string produced by encrypt()
 * @returns {string|null}
 */
function decrypt(ciphertext) {
  const key = _getKey()
  if (!key) return null

  try {
    const parsed = JSON.parse(ciphertext)
    if (parsed.v !== 2 || !parsed.iv || !parsed.tag || !parsed.data) return null

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(parsed.iv, 'hex'),
      { authTagLength: TAG_LENGTH }
    )
    decipher.setAuthTag(Buffer.from(parsed.tag, 'hex'))

    return decipher.update(Buffer.from(parsed.data, 'hex')).toString('utf8')
         + decipher.final('utf8')
  } catch {
    return null
  }
}

/**
 * Returns true if the given string looks like an encrypted payload (v:2 wrapper).
 * @param {string} str
 * @returns {boolean}
 */
function isEncrypted(str) {
  if (typeof str !== 'string') return false
  try {
    const p = JSON.parse(str)
    return p?.v === 2 && typeof p.iv === 'string' && typeof p.data === 'string'
  } catch {
    return false
  }
}

module.exports = { encrypt, decrypt, isEncrypted, isEncryptionEnabled }
