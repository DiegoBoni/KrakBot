const { v4: uuidv4 } = require('uuid')
const logger = require('./logger')

// Sessions inactive longer than this will be cleaned up
const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

const DEFAULT_AGENT = () => process.env.DEFAULT_AGENT || 'claude'

class SessionManager {
  constructor() {
    this._sessions = new Map()
  }

  /**
   * Returns the existing session for userId or creates a new one.
   * @param {number|string} userId
   * @returns {object} session
   */
  getOrCreate(userId) {
    const key = String(userId)
    if (!this._sessions.has(key)) {
      const session = {
        id: uuidv4(),
        userId: key,
        agent: DEFAULT_AGENT(),
        history: [],
        lastActivity: Date.now(),
        taskCount: 0,
      }
      this._sessions.set(key, session)
      logger.debug(`Session created for user ${userId} (agent: ${session.agent})`)
    }
    return this._sessions.get(key)
  }

  /**
   * Changes the active agent for a user's session.
   * @param {number|string} userId
   * @param {string} agentKey
   */
  setAgent(userId, agentKey) {
    const session = this.getOrCreate(userId)
    session.agent = agentKey
    session.lastActivity = Date.now()
    logger.debug(`User ${userId} switched to agent: ${agentKey}`)
  }

  /**
   * Appends a pair of entries (user + assistant) to the session history.
   * @param {number|string} userId
   * @param {string} role  'user' | 'assistant'
   * @param {string} content
   */
  addToHistory(userId, role, content) {
    const session = this.getOrCreate(userId)
    session.history.push({ role, content, timestamp: Date.now() })
    session.lastActivity = Date.now()
    if (role === 'user') session.taskCount++
  }

  /**
   * Clears conversation history for a user (keeps session metadata).
   * @param {number|string} userId
   */
  clearHistory(userId) {
    const session = this.getOrCreate(userId)
    session.history = []
    session.taskCount = 0
    session.lastActivity = Date.now()
    logger.debug(`History cleared for user ${userId}`)
  }

  /**
   * Removes sessions that have been inactive for longer than SESSION_TTL_MS.
   */
  cleanup() {
    const now = Date.now()
    let removed = 0
    for (const [key, session] of this._sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this._sessions.delete(key)
        removed++
      }
    }
    if (removed > 0) logger.info(`Session cleanup: removed ${removed} inactive session(s)`)
  }

  /**
   * Returns the number of active sessions.
   */
  get size() {
    return this._sessions.size
  }
}

// Singleton
module.exports = new SessionManager()
