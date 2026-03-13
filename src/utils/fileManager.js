'use strict'

const path = require('path')
const { createWriteStream, statSync, unlinkSync, readdirSync, mkdirSync } = require('fs')
const { readFileSync } = require('fs')
const { rmSync } = require('fs')
const { pipeline } = require('stream/promises')
const { randomUUID } = require('crypto')
const mammoth = require('mammoth')
const XLSX    = require('xlsx')
const JSZip   = require('jszip')

// ─── Allowlists ───────────────────────────────────────────────────────────────

const ALLOWED_TEXT_EXTS = new Set([
  'txt', 'md', 'csv', 'log', 'py', 'js', 'ts', 'jsx', 'tsx',
  'java', 'go', 'rs', 'rb', 'php', 'sh', 'sql', 'yaml', 'yml',
  'json', 'toml', 'html', 'css', 'xml', 'ini', 'env', 'conf',
  'doc', 'docx',
  'xls', 'xlsx',
  'ppt', 'pptx',
])

const ALLOWED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

const ALLOWED_BINARY_EXTS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'])

const MAX_TEXT_CHARS = 50_000

// ─── Config ───────────────────────────────────────────────────────────────────

function getMaxFileSizeBytes() {
  return (parseInt(process.env.MAX_FILE_SIZE_MB) || 20) * 1024 * 1024
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a file by MIME type and original filename.
 * Returns { ok, reason?, fileType? }
 * fileType: 'text' | 'image' | 'binary' (binary = PDF)
 */
function validateFile(mimeType, originalName) {
  const nameParts = (originalName ?? '').split('.')
  const ext = nameParts.length > 1 ? nameParts.pop().toLowerCase() : ''

  if (!ext || (!ALLOWED_TEXT_EXTS.has(ext) && !ALLOWED_BINARY_EXTS.has(ext))) {
    return {
      ok: false,
      reason: `Tipo de archivo .${ext || 'desconocido'} no soportado.`,
    }
  }

  const fileType = ALLOWED_IMAGE_EXTS.has(ext) ? 'image'
                 : ext === 'pdf' ? 'binary'
                 : 'text'

  return { ok: true, fileType }
}

// ─── Directory management ─────────────────────────────────────────────────────

function getUploadDir(userId) {
  const dir = path.resolve(__dirname, '../../data/uploads', String(userId))
  mkdirSync(dir, { recursive: true })
  return dir
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Download a Telegram file to local disk.
 * Returns { localPath, size }
 */
async function downloadTelegramFile(telegram, fileId, userId, originalName) {
  const fileInfo = await telegram.getFile(fileId)
  const ext = path.extname(originalName).toLowerCase() || '.bin'
  const uuid = randomUUID()
  const localPath = path.join(getUploadDir(userId), `${uuid}${ext}`)

  const token = process.env.TELEGRAM_TOKEN
  const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`)
  }

  await pipeline(response.body, createWriteStream(localPath))

  const { size } = statSync(localPath)
  return { localPath, size }
}

// ─── Read text ────────────────────────────────────────────────────────────────

/**
 * Read a text file with utf-8 (fallback latin1). Truncates at maxChars.
 */
function readTextFile(localPath, maxChars = MAX_TEXT_CHARS) {
  let content
  try {
    content = readFileSync(localPath, 'utf-8')
  } catch {
    content = readFileSync(localPath, 'latin1')
  }

  if (content.length > maxChars) {
    return content.slice(0, maxChars) +
      `\n\n[... archivo truncado a ${maxChars.toLocaleString()} caracteres ...]`
  }
  return content
}

/**
 * Extract plain text from a .docx (or .doc) file using mammoth.
 * Falls back to raw utf-8 read for .doc (older binary format, best-effort).
 * @param {string} localPath
 * @param {number} maxChars
 * @returns {Promise<string>}
 */
async function readWordFile(localPath, maxChars = MAX_TEXT_CHARS) {
  const ext = path.extname(localPath).toLowerCase()
  let content

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: localPath })
    content = result.value ?? ''
  } else {
    // .doc — best-effort: extract readable ASCII strings from binary
    const raw = readFileSync(localPath, 'latin1')
    content = raw.replace(/[^\x20-\x7E\n\r\t\xC0-\xFF]/g, ' ').replace(/ {3,}/g, ' ').trim()
  }

  if (content.length > maxChars) {
    return content.slice(0, maxChars) +
      `\n\n[... archivo truncado a ${maxChars.toLocaleString()} caracteres ...]`
  }
  return content
}

/**
 * Extract text from .xlsx or .xls using SheetJS.
 * Each sheet becomes a labeled CSV block.
 * @param {string} localPath
 * @param {number} maxChars
 * @returns {string}
 */
function readExcelFile(localPath, maxChars = MAX_TEXT_CHARS) {
  const workbook = XLSX.readFile(localPath)
  const parts = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    if (csv.trim()) parts.push(`### Hoja: ${sheetName}\n${csv}`)
  }
  let content = parts.join('\n\n')
  if (content.length > maxChars) {
    content = content.slice(0, maxChars) +
      `\n\n[... archivo truncado a ${maxChars.toLocaleString()} caracteres ...]`
  }
  return content
}

/**
 * Extract text from .pptx by reading slide XMLs inside the zip.
 * Falls back to best-effort for .ppt (old binary format).
 * @param {string} localPath
 * @param {number} maxChars
 * @returns {Promise<string>}
 */
async function readPptxFile(localPath, maxChars = MAX_TEXT_CHARS) {
  const ext = path.extname(localPath).toLowerCase()
  let content

  if (ext === '.pptx') {
    const buffer = readFileSync(localPath)
    const zip = await JSZip.loadAsync(buffer)
    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)[0])
        const nb = parseInt(b.match(/\d+/)[0])
        return na - nb
      })

    const parts = []
    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.files[slideFiles[i]].async('string')
      // Extract text nodes from XML, strip all tags
      const text = xml
        .replace(/<a:t[^>]*>(.*?)<\/a:t>/gs, '$1 ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ').trim()
      if (text) parts.push(`### Slide ${i + 1}\n${text}`)
    }
    content = parts.join('\n\n')
  } else {
    // .ppt binary — best-effort ASCII extraction
    const raw = readFileSync(localPath, 'latin1')
    content = raw.replace(/[^\x20-\x7E\n\r\t\xC0-\xFF]/g, ' ').replace(/ {3,}/g, ' ').trim()
  }

  if (content.length > maxChars) {
    content = content.slice(0, maxChars) +
      `\n\n[... archivo truncado a ${maxChars.toLocaleString()} caracteres ...]`
  }
  return content
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/** Delete a single file silently (no-op if already deleted). */
function cleanupFile(localPath) {
  if (!localPath) return
  try { unlinkSync(localPath) } catch { /* already gone */ }
}

/** Delete all uploads for a userId (used by /limpiar). */
function cleanupUserUploads(userId) {
  const dir = path.resolve(__dirname, '../../data/uploads', String(userId))
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
}

/**
 * Delete files older than 1 hour from data/uploads/.
 * Called by the hourly cleanup loop in index.js.
 */
async function cleanupExpiredUploads() {
  const baseDir = path.resolve(__dirname, '../../data/uploads')
  const ONE_HOUR = 60 * 60 * 1000
  const now = Date.now()

  let userDirs
  try { userDirs = readdirSync(baseDir) } catch { return }

  for (const userDir of userDirs) {
    const userPath = path.join(baseDir, userDir)
    let files
    try { files = readdirSync(userPath) } catch { continue }

    for (const file of files) {
      const filePath = path.join(userPath, file)
      try {
        const { mtimeMs } = statSync(filePath)
        if (now - mtimeMs > ONE_HOUR) unlinkSync(filePath)
      } catch { /* ignore */ }
    }

    // Remove empty user directory
    try {
      if (readdirSync(userPath).length === 0) rmSync(userPath, { recursive: true })
    } catch { /* ignore */ }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return human-readable file size string. */
function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** Return emoji based on file extension. */
function fileEmoji(originalName) {
  const ext = (originalName ?? '').split('.').pop()?.toLowerCase()
  const codeExts = new Set(['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'go', 'rs', 'rb', 'php', 'sh', 'sql'])
  if (codeExts.has(ext)) return '💻'
  if (ext === 'pdf') return '📄'
  if (ext === 'csv') return '📊'
  if (ext === 'doc' || ext === 'docx') return '📝'
  if (ext === 'xls' || ext === 'xlsx') return '📊'
  if (ext === 'ppt' || ext === 'pptx') return '📑'
  if (ALLOWED_IMAGE_EXTS.has(ext)) return '🖼️'
  return '📎'
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  validateFile,
  getMaxFileSizeBytes,
  downloadTelegramFile,
  readTextFile,
  readWordFile,
  readExcelFile,
  readPptxFile,
  cleanupFile,
  cleanupUserUploads,
  cleanupExpiredUploads,
  formatSize,
  fileEmoji,
}
