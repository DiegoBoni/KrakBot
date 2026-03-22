const { Telegraf } = require('telegraf')
const { authMiddleware, rateLimiterMiddleware } = require('./middleware')
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
  handlePhoto,
  handleDocument,
  handleVoice,
  handlePing,
  handleSoul,
  handleReloadSoul,
  handlePolicy,
  handlePolicyView,
  handlePolicyEdit,
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
  // Audio hub
  handleVozHub,
  handleAudioVoiceMode,
  handleAudioTtsButton,
  handleAudioListen,
  handleAudioVoicePicker,
  // TTS
  handleVoiceMode,
  handleTtsButton,
  handleListen,
  handleTtsVoice,
  handleTtsCallback,
  // Inline callbacks
  handleNewAgentVoiceLangSelect,
  handleNewAgentVoiceSelect,
  handleNewAgentCliSelect,
  // TTS voice picker
  handleTtsVoiceLangSelect,
  handleTtsVoiceSelect,
  handleDelAgentConfirm,
  handleDelAgentCancel,
  handleEditAgentFieldSelect,
  handleEditAgentCliValSelect,
  handleEditAgentCancel,
  // Agent inline callbacks (Phase 1)
  handleAgentActivate,
  handleAgentManage,
  handleAgentEditFromButton,
  handleAgentDeletePrompt,
  handleAgentDeleteConfirm,
  handleAgentListRefresh,
  handleAgentNew,
  // Soul inline callbacks (Phase 2)
  handleSoulEdit,
  handleSoulReload,
  // Memory inline callbacks (Phase 3)
  handleMemoryForget,
  handleMemoriesPage,
  // Teams
  handleBuildTeam,
  handleListTeams,
  handleDelTeam,
  handleEditTeam,
  // Team inline callbacks (Phase 4)
  handleTeamDetailBtn,
  handleTeamEditBtn,
  handleTeamDeleteBtn,
  handleTeamDeleteConfirmBtn,
  handleTeamListRefresh,
  handleTeamNewBtn,
  // Tasks
  handleCreateTask,
  handleListTasks,
  handleTaskStatus,
  handleCancelTask,
  handleTeamStatus,
  // Task inline callbacks (Phase 5)
  handleTaskDetail,
  handleTaskCancelPrompt,
  handleTaskCancelConfirm,
  handleTasksHistory,
  handleTasksPage,
  // Generic
  handleActionCancel,
  // Team callbacks + feedback
  handleTeamCallback,
  handlePendingReviewFeedback,
  handleTextIfActive,
} = require('./handlers')
const buildTeamWizard = require('../workflows/buildTeamWizard')
const logger = require('../utils/logger')

function createBot() {
  const token = process.env.TELEGRAM_TOKEN
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en el .env')

  // handlerTimeout must exceed the CLI runner safety ceiling (30 min) so Telegraf
  // doesn't kill the handler promise before the agent has a chance to respond.
  const bot = new Telegraf(token, { handlerTimeout: 31 * 60 * 1000 })

  // ─── Auth ──────────────────────────────────────────────────────────────────
  bot.use(authMiddleware())

  // ─── Rate limiting ─────────────────────────────────────────────────────────
  bot.use(rateLimiterMiddleware())

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
        if (session.buildTeamFlow) {
          session.buildTeamFlow = null
          logger.debug(`buildTeamFlow cancelled for user ${userId} (command received)`)
        }
      }
    }
    return next()
  })

  // ─── Commands ──────────────────────────────────────────────────────────────
  bot.command('start', handleStart)
  bot.command(['help', 'ayuda'], handleHelp)
  bot.command(['agents', 'agentes'], handleListAgents)
  bot.command(['session', 'sesion'], handleSession)
  bot.command(['clear', 'limpiar'], handleClearHistory)

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
  bot.command('policy',     handlePolicy)
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

  // Audio/TTS commands
  bot.command(['voice', 'voz'], handleVozHub) // hub con inline keyboard
  bot.command('listen',    handleListen)      // escuchar último mensaje directo
  bot.command('voicemode', handleVoiceMode)
  bot.command('ttsbutton', handleTtsButton)
  bot.command('ttsvoice',  handleTtsVoice)

  // Team commands
  bot.command('buildteam',   handleBuildTeam)
  bot.command('teams',       handleListTeams)
  bot.command('delteam',     handleDelTeam)
  bot.command('editteam',    handleEditTeam)
  bot.command('task',        handleCreateTask)
  bot.command('tasks',       handleListTasks)
  bot.command('taskstatus',  handleTaskStatus)
  bot.command('canceltask',  handleCancelTask)
  bot.command('teamstatus',  handleTeamStatus)

  // ─── Inline keyboard actions ───────────────────────────────────────────────

  // Update notification
  bot.action('update_yes',    async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await updateChecker.handleUpdateYes(ctx) })
  bot.action('update_remind', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await updateChecker.handleUpdateRemind(ctx) })
  bot.action('update_ignore', async (ctx) => { await ctx.answerCbQuery().catch(() => {}); await updateChecker.handleUpdateIgnore(ctx) })

  // newagent: voice language selection
  bot.action(/^newagent_vl:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleNewAgentVoiceLangSelect(ctx, ctx.match[1])
  })

  // newagent: voice selection (full voice name)
  bot.action(/^newagent_vs:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleNewAgentVoiceSelect(ctx, ctx.match[1])
  })

  // newagent: voice back (show language picker again)
  bot.action('newagent_vback', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    const { VOICE_CATALOG } = require('../utils/ttsService')
    const rows = []
    for (let i = 0; i < VOICE_CATALOG.length; i += 2) {
      const row = [{ text: VOICE_CATALOG[i].lang, callback_data: `newagent_vl:${i}` }]
      if (VOICE_CATALOG[i + 1]) row.push({ text: VOICE_CATALOG[i + 1].lang, callback_data: `newagent_vl:${i + 1}` })
      rows.push(row)
    }
    await ctx.editMessageText('🔊 *¿Qué voz usará este agente?*\nElegí el idioma:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: rows },
    }).catch(() => {})
  })

  // ttsvoice: language selection
  bot.action(/^ttsvoice_l:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleTtsVoiceLangSelect(ctx, ctx.match[1])
  })

  // ttsvoice: voice selection
  bot.action(/^ttsvoice_s:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleTtsVoiceSelect(ctx, ctx.match[1])
  })

  // ttsvoice: back to language picker
  bot.action('ttsvoice_back', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleTtsVoice(ctx)
  })

  // Audio hub callbacks
  bot.action('audio_voicemode', handleAudioVoiceMode)
  bot.action('audio_ttsbutton', handleAudioTtsButton)
  bot.action('audio_listen',    handleAudioListen)
  bot.action('audio_voice',     handleAudioVoicePicker)

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

  // TTS: listen button
  bot.action('tts_last', async (ctx) => { await handleTtsCallback(ctx) })

  // setagent inline button (from /agentes list)
  bot.action(/^setagent:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await handleSetAgent(ctx, `custom:${ctx.match[1]}`)
  })

  // ─── Phase 1: Agent inline callbacks ───────────────────────────────────────

  // agent_manage: tap on custom agent → sub-menu with activate/edit/delete
  bot.action(/^agent_manage:(.+)$/, async (ctx) => {
    await handleAgentManage(ctx, ctx.match[1])
  })

  // agent_activate: supports both built-in keys and "custom:id" form
  bot.action(/^agent_activate:(.+)$/, async (ctx) => {
    await handleAgentActivate(ctx, ctx.match[1])
  })

  bot.action(/^agent_edit:(.+)$/, async (ctx) => {
    await handleAgentEditFromButton(ctx, ctx.match[1])
  })

  bot.action(/^agent_delete:(.+)$/, async (ctx) => {
    await handleAgentDeletePrompt(ctx, ctx.match[1])
  })

  bot.action(/^agent_delete_confirm:(.+)$/, async (ctx) => {
    await handleAgentDeleteConfirm(ctx, ctx.match[1])
  })

  bot.action('agent_list_refresh', async (ctx) => {
    await handleAgentListRefresh(ctx)
  })

  bot.action('agent_new', async (ctx) => {
    await handleAgentNew(ctx)
  })

  // ─── Phase 2: Soul inline callbacks ────────────────────────────────────────

  bot.action('soul_edit', async (ctx) => {
    await handleSoulEdit(ctx)
  })

  bot.action('soul_reload', async (ctx) => {
    await handleSoulReload(ctx)
  })

  // ─── Policy inline callbacks ────────────────────────────────────────────────

  bot.action(/^policy_view:(.+)$/, async (ctx) => {
    await handlePolicyView(ctx)
  })

  bot.action(/^policy_edit:(.+)$/, async (ctx) => {
    await handlePolicyEdit(ctx)
  })

  // ─── Phase 3: Memory inline callbacks ──────────────────────────────────────

  bot.action(/^memory_forget:(.+)$/, async (ctx) => {
    await handleMemoryForget(ctx, ctx.match[1])
  })

  bot.action(/^memories_page:(\d+)$/, async (ctx) => {
    await handleMemoriesPage(ctx, ctx.match[1])
  })

  // ─── Phase 4: Team inline callbacks (non-workflow) ─────────────────────────

  bot.action(/^team_detail:(.+)$/, async (ctx) => {
    await handleTeamDetailBtn(ctx, ctx.match[1])
  })

  bot.action(/^team_edit_btn:(.+)$/, async (ctx) => {
    await handleTeamEditBtn(ctx, ctx.match[1])
  })

  bot.action(/^team_delete_btn:(.+)$/, async (ctx) => {
    await handleTeamDeleteBtn(ctx, ctx.match[1])
  })

  bot.action(/^team_delete_confirm:(.+)$/, async (ctx) => {
    await handleTeamDeleteConfirmBtn(ctx, ctx.match[1])
  })

  bot.action('team_list_refresh', async (ctx) => {
    await handleTeamListRefresh(ctx)
  })

  bot.action('team_new', async (ctx) => {
    await handleTeamNewBtn(ctx)
  })

  // ─── Phase 5: Task inline callbacks ────────────────────────────────────────

  bot.action(/^task_detail:(.+)$/, async (ctx) => {
    await handleTaskDetail(ctx, ctx.match[1])
  })

  bot.action(/^task_cancel:(.+)$/, async (ctx) => {
    await handleTaskCancelPrompt(ctx, ctx.match[1])
  })

  bot.action(/^task_cancel_confirm:(.+)$/, async (ctx) => {
    await handleTaskCancelConfirm(ctx, ctx.match[1])
  })

  bot.action('tasks_history', async (ctx) => {
    await handleTasksHistory(ctx)
  })

  bot.action(/^tasks_page:(\d+)$/, async (ctx) => {
    await handleTasksPage(ctx, ctx.match[1])
  })

  // ─── Generic ───────────────────────────────────────────────────────────────

  bot.action('action_cancel', async (ctx) => {
    await handleActionCancel(ctx)
  })

  // buildteam: model selection
  bot.action(/^buildteam_model:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {})
    await buildTeamWizard.handleModelSelected(ctx, ctx.match[1])
  })

  // Team workflow callbacks (catch-all for team_* and buildteam_* prefixes)
  // Skip callbacks that are handled by the specific Phase 4 actions above
  const INLINE_TEAM_PREFIXES = ['team_detail:', 'team_edit_btn:', 'team_delete_btn:', 'team_delete_confirm:', 'team_list_refresh', 'team_new']
  bot.action(/^(team_|buildteam_|autoroute_team:)/, async (ctx) => {
    const data = ctx.callbackQuery?.data ?? ''
    if (INLINE_TEAM_PREFIXES.some(p => data === p || data.startsWith(p + ':'))) return
    const handled = await handleTeamCallback(ctx, data).catch(err => {
      logger.error(`handleTeamCallback error: ${err.message}`)
      return false
    })
    if (!handled) await ctx.answerCbQuery().catch(() => {})
  })

  // ─── Text messages → task dispatch ────────────────────────────────────────
  // Fire-and-forget: return immediately so Telegraf's polling loop can fetch
  // the next update without waiting for the (potentially 30-min) AI handler.
  bot.on('text', (ctx) => {
    async function dispatch() {
      if (await handlePendingReviewFeedback(ctx)) return
      if (await handleTextIfActive(ctx)) return
      await handleTask(ctx)
    }
    dispatch().catch((err) => {
      logger.error(`Unhandled task error: ${err.message}`)
      ctx.reply('❌ Error inesperado.').catch(() => {})
    })
  })

  // ─── Photo / document messages → file attachment dispatch ─────────────────
  bot.on('photo',    (ctx) => { handlePhoto(ctx).catch((err)    => logger.error(`Unhandled photo error: ${err.message}`)) })
  bot.on('document', (ctx) => { handleDocument(ctx).catch((err) => logger.error(`Unhandled document error: ${err.message}`)) })

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
