const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')
const logger = require('./logger')

const SESSIONS_DIR = path.resolve(__dirname, '../../data/sessions')

function getHistoryWindow() {
  const n = parseInt(process.env.HISTORY_WINDOW)
  return isNaN(n) || n < 0 ? 6 : n
}

function getSessionTTL() {
  const h = parseFloat(process.env.SESSION_TTL_HOURS)
  if (isNaN(h) || h <= 0) return 0
  return h * 60 * 60 * 1000
}

const DEFAULT_AGENT = () => process.env.DEFAULT_AGENT || 'claude'

class SessionManager {
  constructor() {
    this._sessions = new Map()
    try {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true })
    } catch (err) {
      logger.error(`SessionManager: no se pudo crear data/sessions/: ${err.message}`)
    }
  }

  _sessionPath(userId) {
    return path.join(SESSIONS_DIR, `${userId}.json`)
  }

  _loadFromDisk(userId) {
    try {
      const raw = fs.readFileSync(this._sessionPath(userId), 'utf8')
      const data = JSON.parse(raw)
      if (!data.userId || !Array.isArray(data.history)) return null
      logger.debug(`Session loaded from disk for user ${userId} (${data.history.length} entries)`)
      return {
        id: data.id ?? uuidv4(),
        userId: String(userId),
        agent: data.agent ?? DEFAULT_AGENT(),
        history: data.history,
        lastActivity: Date.now(),
        taskCount: data.taskCount ?? 0,
        onboarding: null,
        backgroundTask: null,
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error(`Session load failed for user ${userId}: ${err.message}`)
      }
      return null
    }
  }

  _saveToDisk(session) {
    const data = JSON.stringify({
      version: 1,
      id: session.id,
      userId: session.userId,
      agent: session.agent,
      history: session.history,
      taskCount: session.taskCount,
      savedAt: new Date().toISOString(),
    }, null, 2)
    try {
      fs.writeFileSync(this._sessionPath(session.userId), data, 'utf8')
    } catch (err) {
      logger.error(`Session save failed for user ${session.userId}: ${err.message}`)
    }
  }

  /**
   * Returns the existing session for userId or creates a new one.
   * Hydrates from disk if available.
   * @param {number|string} userId
   * @returns {object} session
   */
  getOrCreate(userId) {
    const key = String(userId)
    if (!this._sessions.has(key)) {
      const fromDisk = this._loadFromDisk(key)
      if (fromDisk) {
        this._sessions.set(key, fromDisk)
        return fromDisk
      }
      const session = {
        id: uuidv4(),
        userId: key,
        agent: DEFAULT_AGENT(),
        history: [],
        lastActivity: Date.now(),
        taskCount: 0,
        onboarding: null,
        backgroundTask: null,
      }
      this._sessions.set(key, session)
      logger.debug(`Session created for user ${userId} (agent: ${session.agent})`)
    }
    return this._sessions.get(key)
  }

  startOnboarding(userId, pendingMessage) {
    const session = this.getOrCreate(userId)
    session.onboarding = {
      step: 'ask_human_name',
      answers: {},
      pendingMessage: pendingMessage || null,
    }
    logger.debug(`Onboarding started for user ${userId}`)
  }

  getOnboarding(userId) {
    const session = this.getOrCreate(userId)
    return session.onboarding
  }

  advanceOnboarding(userId, answer) {
    const steps = ['ask_human_name', 'ask_bot_name', 'ask_tone', 'ask_extra', 'done']
    const session = this.getOrCreate(userId)
    if (!session.onboarding) return { done: false, nextStep: null }

    const currentStep = session.onboarding.step
    if (answer !== null && answer !== undefined) {
      session.onboarding.answers[currentStep] = answer
    }

    const currentIdx = steps.indexOf(currentStep)
    const nextStep = steps[currentIdx + 1] ?? 'done'
    session.onboarding.step = nextStep

    return { done: nextStep === 'done', nextStep }
  }

  clearOnboarding(userId) {
    const session = this.getOrCreate(userId)
    session.onboarding = null
    logger.debug(`Onboarding cleared for user ${userId}`)
  }

  /**
   * Changes the active agent for a user's session.
   * Persists the change to disk.
   * @param {number|string} userId
   * @param {string} agentKey
   */
  setAgent(userId, agentKey) {
    const session = this.getOrCreate(userId)
    session.agent = agentKey
    session.lastActivity = Date.now()
    logger.debug(`User ${userId} switched to agent: ${agentKey}`)
    this._saveToDisk(session)
  }

  /**
   * Appends an entry to the session history with rolling window enforcement.
   * Persists to disk asynchronously.
   * @param {number|string} userId
   * @param {string} role  'user' | 'assistant'
   * @param {string} content
   * @param {string} [agentOverride]  agent key to record; defaults to session.agent
   */
  addToHistory(userId, role, content, agentOverride) {
    const session = this.getOrCreate(userId)
    session.history.push({ role, content, agent: agentOverride ?? session.agent, timestamp: Date.now() })
    session.lastActivity = Date.now()
    if (role === 'user') session.taskCount++

    // Rolling window: keep last HISTORY_WINDOW pairs (user + assistant)
    const win = getHistoryWindow()
    if (win > 0 && session.history.length > win * 2) {
      session.history = session.history.slice(-win * 2)
    }

    this._saveToDisk(session)
  }

  /**
   * Clears conversation history for a user (keeps session metadata).
   * Also removes the persisted session file from disk.
   * @param {number|string} userId
   */
  clearHistory(userId) {
    const session = this.getOrCreate(userId)
    session.history = []
    session.taskCount = 0
    session.lastActivity = Date.now()
    logger.debug(`History cleared for user ${userId}`)
    try {
      fs.unlinkSync(this._sessionPath(userId))
    } catch (err) {
      if (err.code !== 'ENOENT') logger.error(`Session file delete failed: ${err.message}`)
    }
  }

  /**
   * Removes in-memory sessions inactive longer than SESSION_TTL_HOURS.
   * If SESSION_TTL_HOURS=0 (default), no sessions are ever removed.
   */
  cleanup() {
    const ttl = getSessionTTL()
    if (ttl === 0) {
      logger.debug(`Session cleanup skipped (SESSION_TTL_HOURS=0) — active sessions: ${this._sessions.size}`)
      return
    }
    const now = Date.now()
    let removed = 0
    for (const [key, session] of this._sessions) {
      if (now - session.lastActivity > ttl) {
        this._sessions.delete(key)
        removed++
      }
    }
    if (removed > 0) logger.info(`Session cleanup: removed ${removed} inactive session(s)`)
  }

  /**
   * Stores a background task descriptor for a user.
   * @param {number|string} userId
   * @param {{ agentKey, statusMsgId, transitionMsgId, cancel, startTime, originalPrompt }} data
   */
  setBackgroundTask(userId, data) {
    const session = this.getOrCreate(userId)
    session.backgroundTask = data
    logger.debug(`Background task set for user ${userId}`)
  }

  /**
   * Returns the current background task for a user, or null.
   * @param {number|string} userId
   * @returns {object|null}
   */
  getBackgroundTask(userId) {
    const session = this.getOrCreate(userId)
    return session.backgroundTask ?? null
  }

  /**
   * Clears the background task for a user.
   * @param {number|string} userId
   */
  clearBackgroundTask(userId) {
    const session = this.getOrCreate(userId)
    session.backgroundTask = null
    logger.debug(`Background task cleared for user ${userId}`)
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
