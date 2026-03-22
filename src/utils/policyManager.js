'use strict'

/**
 * PolicyManager — loads agent behavior policies from data/policies/.
 *
 * File resolution order (merged in this order):
 *   1. data/policies/default.md  — applies to all agents
 *   2. data/policies/{agentKey}.md — agent-specific additions (claude, gemini, codex)
 *
 * If neither file exists, no policy block is injected.
 * Files are read fresh on every get() call so changes take effect without restart.
 */

const fs   = require('fs')
const path = require('path')
const logger = require('./logger')

const POLICIES_DIR = path.resolve(__dirname, '../../data/policies')
const POLICY_MAX_CHARS = 2000

class PolicyManager {
  constructor() {
    try {
      fs.mkdirSync(POLICIES_DIR, { recursive: true })
    } catch (err) {
      logger.error(`PolicyManager: no se pudo crear data/policies/: ${err.message}`)
    }
  }

  _read(filename) {
    try {
      const p = path.join(POLICIES_DIR, filename)
      if (!fs.existsSync(p)) return ''
      return fs.readFileSync(p, 'utf8').trim()
    } catch {
      return ''
    }
  }

  /**
   * Returns the merged policy for the given agent key, or null if no policy files exist.
   * Reads from disk on every call — no caching — so edits take effect immediately.
   * @param {string} [agentKey]  e.g. 'claude', 'gemini', 'codex'
   * @returns {string|null}
   */
  get(agentKey) {
    const defaultPolicy = this._read('default.md')
    const agentPolicy   = agentKey ? this._read(`${agentKey}.md`) : ''

    const parts = [defaultPolicy, agentPolicy].filter(Boolean)
    if (parts.length === 0) return null

    let merged = parts.join('\n\n')
    if (merged.length > POLICY_MAX_CHARS) {
      logger.warn(`PolicyManager: policy para "${agentKey ?? 'default'}" excede ${POLICY_MAX_CHARS} chars, se truncará.`)
      merged = merged.slice(0, POLICY_MAX_CHARS)
    }
    return merged
  }

  /**
   * Returns the path to a policy file (useful for editing tools).
   * @param {'default'|string} name
   */
  filePath(name) {
    return path.join(POLICIES_DIR, `${name}.md`)
  }
}

module.exports = new PolicyManager()
