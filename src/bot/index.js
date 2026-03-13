const { Telegraf } = require('telegraf')
const { authMiddleware } = require('./middleware')
const updateChecker = require('../utils/updateChecker')
const sessionManager = require('../utils/sessionManager')
const {
  handleStart,
  handleHelp,
  handleListAgents,
  handleSetAgent,
  handleSetAgentCmd,
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
  // Custom agents
  handleNewAgent,
  handleDelAgent,
  handleEditAgent,
  handleAuto,
  handleAutoMode,
  handleDefault,
  // Inline callbacks
  handleNewAgentCliSelect,
  handleDelAgentConfirm,
  handleDelAgentCancel,
  handleEditAgentFieldSelect,
  handleEditAgentCliValSelect,
  handleEditAgentCancel,
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

  // ─── Middleware: cancel active flows when user sends a command ─────────────
  bot.use((ctx, next) => {
    if (ctx.message?.text?.startsWith('/')) {
      const userId = ctx.from?.id
      if (userId) {
        const session = sessionManager.getOrCreate(userId)
        if (session.newAgentFlow) {
          session.newAgentFlow = null
          logger.debug(`newAgentFlow cancelled for user ${userId} (command received)`)
        }
        if (session.editAgentFlow) {
          session.editAgentFlow = null
          logger.debug(`editAgentFlow cancelled for user ${userId} (command received)`)
        }
      }
    }
    return next()
  })

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
  bot.command('setagent', handleSetAgentCmd)
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

  // Auto-update command
  bot.command('update', (ctx) => updateChecker.handleUpdate(ctx))

  // Back to default agent
  bot.command('default', handleDefault)

  // Custom agents commands
  bot.command('newagent',  handleNewAgent)
  bot.command('delagent',  handleDelAgent)
  bot.command('editagent', handleEditAgent)
  bot.command('auto',      handleAuto)
  bot.command('automode',  handleAutoMode)

  // ─── Inline keyboard actions ───────────────────────────────────────────────

  // Update notification
  bot.action('update_yes',    async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await updateChecker.handleUpdateYes(ctx) })
  bot.action('update_remind', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await updateChecker.handleUpdateRemind(ctx) })
  bot.action('update_ignore', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await updateChecker.handleUpdateIgnore(ctx) })

  // newagent: CLI selection
  bot.action(/^newagent_cli:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleNewAgentCliSelect(ctx, ctx.match[1])
  })

  // delagent: confirmation
  bot.action(/^delagent_yes:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleDelAgentConfirm(ctx, ctx.match[1])
  })
  bot.action('delagent_no', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleDelAgentCancel(ctx)
  })

  // editagent: field selection
  bot.action(/^editagent_(desc|prompt|cli):(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    const fieldMap = { desc: 'description', prompt: 'systemPrompt', cli: 'cli' }
    await handleEditAgentFieldSelect(ctx, fieldMap[ctx.match[1]], ctx.match[2])
  })
  bot.action(/^editagent_cli_val:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleEditAgentCliValSelect(ctx, ctx.match[1])
  })
  bot.action('editagent_cancel', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleEditAgentCancel(ctx)
  })

  // setagent inline button (from /agentes list)
  bot.action(/^setagent:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleSetAgent(ctx, `custom:${ctx.match[1]}`)
  })

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
