const { Telegraf } = require('telegraf')
const { authMiddleware } = require('./middleware')
const {
  handleStart,
  handleHelp,
  handleListAgents,
  handleSetAgent,
  handleSession,
  handleClearHistory,
  handleTask,
  handleVoice,
  handlePing,
  handleSoul,
  handleReloadSoul,
  handleSkip,
  handleRemember,
  handleMemories,
  handleForget,
} = require('./handlers')
const logger = require('../utils/logger')

function createBot() {
  const token = process.env.TELEGRAM_TOKEN
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en el .env')

  // handlerTimeout must exceed the CLI runner safety ceiling (30 min) so Telegraf
  // doesn't kill the handler promise before the agent has a chance to respond.
  const bot = new Telegraf(token, { handlerTimeout: 31 * 60 * 1000 })

  // ─── Auth ──────────────────────────────────────────────────────────────────
  bot.use(authMiddleware())

  // ─── Commands ──────────────────────────────────────────────────────────────
  bot.command('start', handleStart)
  bot.command(['help', 'ayuda'], handleHelp)
  bot.command('agentes', handleListAgents)
  bot.command('sesion', handleSession)
  bot.command('limpiar', handleClearHistory)

  // Agent-switching commands
  bot.command('claude', (ctx) => handleSetAgent(ctx, 'claude'))
  bot.command('gemini', (ctx) => handleSetAgent(ctx, 'gemini'))
  bot.command('codex',  (ctx) => handleSetAgent(ctx, 'codex'))
  bot.command('ping',   (ctx) => {
    const parts = ctx.message.text.split(/\s+/)
    const agentArg = parts[1] ?? null
    return handlePing(ctx, agentArg)
  })

  // Soul & memory commands
  bot.command('soul',       handleSoul)
  bot.command('reloadsoul', handleReloadSoul)
  bot.command('skip',       handleSkip)
  bot.command('remember',   handleRemember)
  bot.command('memories',   handleMemories)
  bot.command('forget',     handleForget)

  // ─── Text messages → task dispatch ────────────────────────────────────────
  // Fire-and-forget: return immediately so Telegraf's polling loop can fetch
  // the next update without waiting for the (potentially 30-min) AI handler.
  bot.on('text', (ctx) => {
    handleTask(ctx).catch((err) => {
      logger.error(`Unhandled task error: ${err.message}`)
      ctx.reply('❌ Error inesperado.').catch(() => {})
    })
  })

  // ─── Voice / audio messages → transcription + dispatch ────────────────────
  bot.on('voice', (ctx) => { handleVoice(ctx).catch((err) => logger.error(`Unhandled voice error: ${err.message}`)) })
  bot.on('audio', (ctx) => { handleVoice(ctx).catch((err) => logger.error(`Unhandled audio error: ${err.message}`)) })

  // ─── Global error handler ─────────────────────────────────────────────────
  bot.catch(async (err, ctx) => {
    logger.error(`Unhandled bot error for update ${ctx.update?.update_id}: ${err.message}`)
    try {
      await ctx.reply('❌ Ocurrió un error inesperado. Intentá de nuevo.')
    } catch {
      // Swallow — can't do much if even the error reply fails
    }
  })

  return bot
}

module.exports = { createBot }
