const logger = require('../utils/logger')
const { audit } = require('../utils/auditLogger')

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
      audit('auth_denied', { userId: userId ?? null, username: ctx.from?.username ?? null })
      await ctx.reply('⛔ No estás autorizado para usar este bot.')
      return
    }
    await next()
  }
}

/**
 * Returns a Telegraf middleware that enforces per-user rate limiting.
 * Configured via RATE_LIMIT_MAX (default: 10) and RATE_LIMIT_WINDOW_SECONDS (default: 60).
 * Set RATE_LIMIT_MAX=0 to disable.
 */
function rateLimiterMiddleware() {
  const rawMax    = parseInt(process.env.RATE_LIMIT_MAX            ?? '10', 10)
  const rawWindow = parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '60', 10)

  const maxRequests = (!isNaN(rawMax)    && rawMax    >= 0) ? rawMax
    : (logger.warn('rateLimiter: RATE_LIMIT_MAX inválido — usando default 10'), 10)
  const windowMs    = (!isNaN(rawWindow) && rawWindow  > 0) ? rawWindow * 1000
    : (logger.warn('rateLimiter: RATE_LIMIT_WINDOW_SECONDS inválido — usando default 60s'), 60_000)

  if (maxRequests === 0) {
    logger.info('rateLimiter: deshabilitado (RATE_LIMIT_MAX=0)')
    return (_ctx, next) => next()
  }

  logger.info(`rateLimiter: ${maxRequests} req / ${windowMs / 1000}s por usuario`)

  const buckets = new Map() // userId → { count, windowStart }

  return async (ctx, next) => {
    const userId = ctx.from?.id
    if (!userId) return next()

    const now    = Date.now()
    const bucket = buckets.get(userId)

    if (!bucket || now - bucket.windowStart >= windowMs) {
      buckets.set(userId, { count: 1, windowStart: now })
      return next()
    }

    if (bucket.count < maxRequests) {
      bucket.count++
      return next()
    }

    const secsLeft = Math.ceil((windowMs - (now - bucket.windowStart)) / 1000)
    logger.warn(`rateLimiter: userId ${userId} bloqueado (${bucket.count} reqs en ventana, ${secsLeft}s restantes)`)
    audit('rate_limited', { userId, count: bucket.count, secsLeft })
    await ctx.reply(`⏳ Demasiadas solicitudes. Esperá ${secsLeft} segundos.`)
  }
}

module.exports = { authMiddleware, rateLimiterMiddleware }
