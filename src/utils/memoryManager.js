const fs = require('fs')
const path = require('path')
const logger = require('./logger')

const DATA_DIR = path.resolve(path.join(__dirname, '../../data'))
const MEMORIES_DIR = path.join(DATA_DIR, 'memories')

class MemoryManager {
  constructor() {
    this._ensureDir()
  }

  _ensureDir() {
    try {
      fs.mkdirSync(MEMORIES_DIR, { recursive: true })
    } catch (err) {
      logger.error(`MemoryManager: no se pudo crear data/memories/: ${err.message}`)
    }
  }

  _timestamp() {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  }

  _slug(content) {
    return content
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join('-')
      .replace(/-{2,}/g, '-')
      .slice(0, 40) || 'memoria'
  }

  _parseFile(filename) {
    try {
      const filepath = path.join(MEMORIES_DIR, filename)
      const raw = fs.readFileSync(filepath, 'utf8')
      const dateMatch = raw.match(/^---\ndate:\s*(.+?)\n---\n/s)
      const date = dateMatch ? dateMatch[1].trim() : ''
      const content = raw.replace(/^---\n[\s\S]*?---\n/, '').trim()
      const id = filename.replace(/\.md$/, '')
      return { id, filename, date, content, preview: content.slice(0, 80) }
    } catch {
      return null
    }
  }

  _listFiles() {
    try {
      return fs.readdirSync(MEMORIES_DIR)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse()
    } catch {
      return []
    }
  }

  async save(content) {
    this._ensureDir()
    const ts = this._timestamp()
    const slug = this._slug(content)
    const filename = `${ts}-${slug}.md`
    const filepath = path.join(MEMORIES_DIR, filename)
    const fileContent = `---\ndate: ${new Date().toISOString()}\n---\n\n${content.trim()}\n`
    fs.writeFileSync(filepath, fileContent, 'utf8')
    const id = filename.replace(/\.md$/, '')
    logger.debug(`MemoryManager: guardado ${filename}`)
    return id
  }

  async list(page = 1, limit = 10) {
    const files = this._listFiles()
    const start = (page - 1) * limit
    const slice = files.slice(start, start + limit)
    return slice.map((f) => this._parseFile(f)).filter(Boolean)
  }

  async remove(idOrLast) {
    const files = this._listFiles()
    if (files.length === 0) return false

    let target
    if (idOrLast === 'last') {
      target = files[0]
    } else {
      target = files.find((f) => f.replace(/\.md$/, '') === idOrLast)
    }

    if (!target) return false

    try {
      fs.unlinkSync(path.join(MEMORIES_DIR, target))
      logger.debug(`MemoryManager: eliminado ${target}`)
      return true
    } catch {
      return false
    }
  }

  async getRecent(n = 5, maxChars = 2000) {
    const files = this._listFiles().slice(0, n)
    const parts = []
    let total = 0

    for (const f of files) {
      const parsed = this._parseFile(f)
      if (!parsed) continue
      const entry = `[${parsed.date.slice(0, 10)}] ${parsed.content}`
      if (total + entry.length > maxChars) {
        const remaining = maxChars - total
        if (remaining > 20) parts.push(entry.slice(0, remaining))
        break
      }
      parts.push(entry)
      total += entry.length
    }

    return parts.join('\n\n')
  }
}

module.exports = new MemoryManager()
