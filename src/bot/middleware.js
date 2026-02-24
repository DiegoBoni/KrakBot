const logger = require('../utils/logger')

/**
 * Returns a Telegraf middleware that restricts access to authorized user IDs.
 * If AUTHORIZED_USERS is empty, all users are allowed.
 */
function authMiddleware() {
  const raw = process.env.AUTHORIZED_USERS || ''
  const allowedIds = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n))

  if (allowedIds.length === 0) {
    logger.info('Auth: AUTHORIZED_USERS not set — all users allowed')
    return (ctx, next) => next()
  }

  logger.info(`Auth: restricting to ${allowedIds.length} user(s): ${allowedIds.join(', ')}`)

  return async (ctx, next) => {
    const userId = ctx.from?.id
    if (!userId || !allowedIds.includes(userId)) {
      logger.warn(`Unauthorized access attempt from user ${userId ?? 'unknown'}`)
      await ctx.reply('⛔ No estás autorizado para usar este bot.')
      return
    }
    await next()
  }
}

module.exports = { authMiddleware }
