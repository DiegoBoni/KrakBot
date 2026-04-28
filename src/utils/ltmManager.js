const fs   = require('fs')
const path = require('path')
const logger = require('./logger')
const { encrypt, decrypt, isEncrypted } = require('./cryptoHelper')

const MEMORIES_DIR = path.resolve(__dirname, '../../data/memories')

function _ltmPath(userId) {
  return path.join(MEMORIES_DIR, `${userId}-ltm.md`)
}

function read(userId) {
  try {
    const raw  = fs.readFileSync(_ltmPath(String(userId)), 'utf8')
    const text = isEncrypted(raw) ? (decrypt(raw) ?? raw) : raw
    return text.replace(/^---\n[\s\S]*?---\n\n?/, '').trim()
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`LTM read failed for user ${userId}: ${err.message}`)
    return ''
  }
}

function write(userId, content) {
  try {
    fs.mkdirSync(MEMORIES_DIR, { recursive: true })
    const fileContent = `---\nuserId: ${userId}\nupdatedAt: ${new Date().toISOString()}\n---\n\n${content.trim()}\n`
    const toWrite = encrypt(fileContent) ?? fileContent
    fs.writeFileSync(_ltmPath(String(userId)), toWrite, 'utf8')
    logger.debug(`LTM written for user ${userId} (${content.length} chars)`)
  } catch (err) {
    logger.error(`LTM write failed for user ${userId}: ${err.message}`)
  }
}

function remove(userId) {
  try {
    fs.unlinkSync(_ltmPath(String(userId)))
    logger.debug(`LTM deleted for user ${userId}`)
    return true
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(`LTM delete failed for user ${userId}: ${err.message}`)
    return false
  }
}

module.exports = { read, write, remove }
