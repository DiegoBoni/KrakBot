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
