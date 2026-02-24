const fs = require('fs')
const path = require('path')
const logger = require('./logger')

const DATA_DIR = path.resolve(process.env.SOUL_PATH ? path.dirname(process.env.SOUL_PATH) : path.join(__dirname, '../../data'))
const SOUL_PATH = process.env.SOUL_PATH ? path.resolve(process.env.SOUL_PATH) : path.join(DATA_DIR, 'SOUL.md')
const SOUL_MAX_CHARS = 4000

class SoulManager {
  constructor() {
    this._cache = null
    this._ensureDataDir()
    this._load()
  }

  _ensureDataDir() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    } catch (err) {
      logger.error(`SoulManager: no se pudo crear data/: ${err.message}`)
    }
  }

  _load() {
    try {
      if (!fs.existsSync(SOUL_PATH)) {
        this._cache = null
        return
      }
      let content = fs.readFileSync(SOUL_PATH, 'utf8')
      if (content.length > SOUL_MAX_CHARS) {
        logger.warn(`SOUL.md excede ${SOUL_MAX_CHARS} chars, se truncará al inyectarse.`)
        content = content.slice(0, SOUL_MAX_CHARS)
      }
      this._cache = content
    } catch (err) {
      logger.error(`SoulManager: error leyendo SOUL.md: ${err.message}`)
      this._cache = null
    }
  }

  soulExists() {
    return this._cache !== null
  }

  get() {
    return this._cache
  }

  reload() {
    this._load()
    logger.debug('SoulManager: SOUL.md recargado desde disco.')
  }

  async writeSoul(content) {
    try {
      this._ensureDataDir()
      fs.writeFileSync(SOUL_PATH, content, 'utf8')
      this._load()
      logger.info('SoulManager: SOUL.md generado y cacheado.')
    } catch (err) {
      logger.error(`SoulManager: error escribiendo SOUL.md: ${err.message}`)
      throw err
    }
  }
}

module.exports = new SoulManager()
