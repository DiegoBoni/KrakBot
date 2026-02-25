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

  // handlerTimeout must exceed the CLI runner timeout (default 120s) so Telegraf
  // doesn't kill the handler promise before the agent has a chance to respond.
  const cliTimeout = parseInt(process.env.CLI_TIMEOUT) || 120_000
  const bot = new Telegraf(token, { handlerTimeout: cliTimeout + 30_000 })

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
  bot.on('text', handleTask)

  // ─── Voice / audio messages → transcription + dispatch ────────────────────
  bot.on('voice', handleVoice)
  bot.on('audio', handleVoice)

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
