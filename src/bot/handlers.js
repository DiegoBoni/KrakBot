const { dispatch, dispatchStreaming, resolveAgent, getAgentInfo, listAgents, routeWithRootAgent } = require('../agents/router')
const sessionManager = require('../utils/sessionManager')
const soulManager = require('../utils/soulManager')
const memoryManager = require('../utils/memoryManager')
const customAgentManager = require('../utils/customAgentManager')
const fileManager = require('../utils/fileManager')
const ttsService = require('../utils/ttsService')
const { VOICE_CATALOG } = ttsService
const { createReadStream } = require('fs')
const logger = require('../utils/logger')
const { transcribe, checkWhisper } = require('../utils/audioTranscriber')
// Team workflows
const teamManager      = require('../utils/teamManager')
const taskManager      = require('../utils/taskManager')
const heartbeatManager = require('../utils/heartbeatManager')
const teamWorkflow     = require('../workflows/teamWorkflow')
const buildTeamWizard  = require('../workflows/buildTeamWizard')

const MAX_RESPONSE_LENGTH = parseInt(process.env.MAX_RESPONSE_LENGTH) || 4000

// Regex to detect "@agentAlias task" at the start of a message
const MENTION_RE = /^@(\w[\w-]*)\s+([\s\S]+)$/

// Escape characters that break Telegram Markdown V1
function escapeMd(text) {
  return String(text).replace(/[_*`[]/g, '\\$&')
}

// ─── Vibe phrases (shown while agent is thinking > 60s) ────────────────────────

const VIBE_PHRASES = [
  '🔥 Generando código a full velocidad...',
  '🧠 Pensando como un pulpo con cafeína...',
  '⚡ Procesando... el agente está en modo beast.',
  '🪄 Mágicamente cocinando tu respuesta...',
  '🚀 La tarea es compleja pero ya viene...',
  '💡 Analizando cada detalle con cuidado...',
  '🔮 El oráculo está consultando el universo...',
  '🐙 Ocho tentáculos trabajando en simultáneo...',
  '🎯 Apuntando directo al objetivo...',
  '🏗️ Construyendo la respuesta ladrillo por ladrillo...',
  '🌊 Navegando el contexto... hay mucha data.',
  '⚙️ Motores encendidos, paciencia que ya llega...',
  '🧩 Armando las piezas del rompecabezas...',
  '🦑 El kraken está despierto y trabajando...',
]

/**
 * Returns a random vibe phrase, avoiding repeating the last one.
 * @param {number} lastIdx  Index of the previously shown phrase (-1 for none)
 * @returns {string}
 */
function randomVibe(lastIdx) {
  const available = VIBE_PHRASES.filter((_, i) => i !== lastIdx)
  return available[Math.floor(Math.random() * available.length)]
}

// ─── Onboarding ────────────────────────────────────────────────────────────────

const ONBOARDING_QUESTIONS = {
  ask_human_name: '¡Hola! Antes de arrancar... ¿cómo te llamo? (tu nombre o apodo)',
  ask_bot_name:   null, // built dynamically with humanName
  ask_tone:       '¿Cómo preferís que te hable?\nEj: *directo y técnico* / *relajado con humor* / *formal*',
  ask_extra:      '¿Algo más que deba saber de vos o de tus proyectos? Podés saltear esto con /skip',
}

function buildSoulTemplate(answers) {
  const humanName = answers.ask_human_name || 'amigo'
  const botName   = answers.ask_bot_name   || 'KrakBot'
  const tone      = answers.ask_tone       || 'Directo y técnico. Sin floro.'
  const extra     = answers.ask_extra      || ''

  return `# Alma de ${botName}

## Identidad
- **Nombre del bot:** ${botName}
- **Icono:** 🐙⚡
- **Idioma:** Español (Argentina)

## Mi humano
- **Nombre:** ${humanName}${extra ? `\n- **Contexto:** ${extra}` : ''}

## Personalidad
${tone}

## Instrucciones
- Siempre respondé en el idioma del mensaje del usuario.
- Sos un asistente de IA conversacional. No sos un agente de terminal.
- Si el contexto incluye memorias guardadas, dales prioridad.
- Dirigite al usuario como ${humanName}.
`
}

async function handleOnboarding(ctx, answer) {
  const userId = ctx.from.id
  const ob = sessionManager.getOnboarding(userId)
  if (!ob) return

  // First call (answer === null): just send the first question without advancing
  if (answer !== null) {
    const { done } = sessionManager.advanceOnboarding(userId, answer)

    if (done) {
      const answers = sessionManager.getOnboarding(userId).answers
      const humanName = answers.ask_human_name || 'amigo'
      const soul = buildSoulTemplate(answers)
      await soulManager.writeSoul(soul)
      const pending = sessionManager.getOnboarding(userId).pendingMessage
      sessionManager.clearOnboarding(userId)

      await ctx.reply(
        `Listo, *${humanName}*! Ya sé quién sos. ¿En qué te ayudo?`,
        { parse_mode: 'Markdown' }
      )

      if (pending) {
        ctx.message.text = pending
        return handleTask(ctx)
      }
      return
    }
  }

  // Send the question for the current step
  const currentStep = sessionManager.getOnboarding(userId).step
  let question

  if (currentStep === 'ask_bot_name') {
    const humanName = sessionManager.getOnboarding(userId).answers.ask_human_name || 'vos'
    question = `Buenísimo, *${humanName}*! ¿Y cómo querés que me llame yo?\n(Enter o cualquier texto — dejame como *KrakBot* si querés)`
  } else {
    question = ONBOARDING_QUESTIONS[currentStep]
  }

  if (question) {
    await ctx.reply(question, { parse_mode: 'Markdown' })
  }
}

// ─── Command handlers ──────────────────────────────────────────────────────────

async function handleStart(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  const agent = getAgentInfo(session.agent)
  const emoji = agent?.emoji ?? '🤖'
  const name = agent?.name ?? session.agent

  await ctx.reply(
    `🐙⚡ *Bienvenido a KrakBot*\n\n` +
    `${emoji} Agente activo: *${name}*\n\n` +
    `Enviame cualquier tarea y se la delego al agente.\n\n` +
    `*Comandos útiles:*\n` +
    `/agentes — ver agentes disponibles\n` +
    `/claude · /gemini · /codex — cambiar agente\n` +
    `/newagent — crear un agente personalizado\n` +
    `/auto <tarea> — Root Agent elige el mejor agente\n` +
    `/sesion — info de tu sesión\n` +
    `/limpiar — borrar historial\n` +
    `/soul — ver o configurar mi personalidad\n` +
    `/remember — guardar una memoria\n` +
    `/ayuda — instrucciones detalladas\n\n` +
    `💡 También podés mencionar un agente al inicio del mensaje:\n` +
    `\`@claude explicá este código\`\n` +
    `\`@python-expert optimizá esta función\``,
    { parse_mode: 'Markdown' }
  )

  if (!soulManager.soulExists() && !sessionManager.getOnboarding(ctx.from.id)) {
    sessionManager.startOnboarding(ctx.from.id, null)
    await handleOnboarding(ctx, null)
  }
}

async function handleHelp(ctx) {
  await ctx.reply(
    `📖 *Instrucciones de uso*\n\n` +
    `*Enviar una tarea:*\n` +
    `Escribí tu consulta directamente. Se la mando al agente activo.\n\n` +
    `*Mencionar un agente puntualmente:*\n` +
    `\`@claude <tarea>\` — usa Claude para esa respuesta\n` +
    `\`@gemini <tarea>\` — usa Gemini para esa respuesta\n` +
    `\`@codex <tarea>\` — usa Codex para esa respuesta\n` +
    `\`@python-expert <tarea>\` — usa un custom agent\n` +
    `También funcionan los aliases: \`@cc\`, \`@gem\`, \`@g\`, \`@gpt\`, etc.\n\n` +
    `*Cambiar agente activo:*\n` +
    `/claude · /gemini · /codex\n` +
    `/setagent <id> — activar un custom agent\n\n` +
    `*Custom Agents:*\n` +
    `/newagent — crear un agente especializado\n` +
    `/agents — ver todos los agentes\n` +
    `/editagent <id> — editar un agente\n` +
    `/delagent <id> — borrar un agente\n\n` +
    `*Root Agent:*\n` +
    `/auto <tarea> — elige el mejor agente automáticamente\n` +
    `/automode on|off — routing automático permanente\n\n` +
    `*Personalización:*\n` +
    `/soul — ver mi alma (personalidad y contexto)\n` +
    `/soul reset — reconfigurar desde cero\n` +
    `/reloadsoul — recargar SOUL.md sin reiniciar\n\n` +
    `*Memorias:*\n` +
    `/remember <texto> — guardar una memoria\n` +
    `/memories — listar memorias guardadas\n` +
    `/forget last|<id> — borrar una memoria\n\n` +
    `*Voz y audio:*\n` +
    `/voicemode — respuestas en audio\n` +
    `/ttsbutton — botón 🔊 al pie de cada respuesta\n` +
    `/listen — escuchar el último mensaje\n` +
    `/ttsvoice — cambiar voz TTS\n\n` +
    `*Historial:*\n` +
    `Todos los agentes reciben las últimas 6 entradas como contexto.\n` +
    `/clear para borrar el historial.\n\n` +
    `*Límite de respuesta:* ${MAX_RESPONSE_LENGTH} caracteres por mensaje (se divide automáticamente).`,
    { parse_mode: 'Markdown' }
  )
}

// ─── Agents list helpers ───────────────────────────────────────────────────────

function buildAgentsMessage(userId) {
  const session = sessionManager.getOrCreate(userId)
  const agents = listAgents()

  const lines = agents.map((a) => {
    const active = a.key === session.agent ? ' ✅ *activo*' : ''
    const cliOk  = global.__cliStatus?.[a.key]?.found !== false
    const badge  = cliOk ? '' : ' ⚠️'
    return `${a.emoji} *${a.name}*${active}${badge} — ${escapeMd(a.description)}`
  })

  let text = `🤖 *Agentes disponibles:*\n\n${lines.join('\n')}`

  const customAgents = customAgentManager.list()
  if (customAgents.length > 0) {
    const customLines = customAgents.map((a) => {
      const active = session.agent === `custom:${a.id}` ? ' ✅ *activo*' : ''
      return `${a.emoji} *${escapeMd(a.name)}*${active} _(${a.cli ?? 'claude'})_ — ${escapeMd(a.description)}`
    })
    text += `\n\n── *Custom Agents* ──\n\n${customLines.join('\n')}`
  }

  return text
}

function buildAgentsKeyboard(userId) {
  const session = sessionManager.getOrCreate(userId)
  const agents = listAgents()
  const keyboard = []

  // Built-in agents — de a 2 por fila para que no ocupen todo el ancho
  const inactiveBuiltins = agents.filter(a => a.key !== session.agent)
  for (let i = 0; i < inactiveBuiltins.length; i += 2) {
    const row = [{ text: `✅ ${inactiveBuiltins[i].emoji} ${inactiveBuiltins[i].name}`, callback_data: `agent_activate:${inactiveBuiltins[i].key}` }]
    if (inactiveBuiltins[i + 1]) row.push({ text: `✅ ${inactiveBuiltins[i + 1].emoji} ${inactiveBuiltins[i + 1].name}`, callback_data: `agent_activate:${inactiveBuiltins[i + 1].key}` })
    keyboard.push(row)
  }

  // Custom agents
  const customAgents = customAgentManager.list()
  for (const a of customAgents) {
    const isActive = session.agent === `custom:${a.id}`
    const row = []
    if (!isActive) row.push({ text: `✅ Activar`, callback_data: `agent_activate:custom:${a.id}` })
    row.push({ text: `✏️ Editar`, callback_data: `agent_edit:${a.id}` })
    row.push({ text: `🗑 Borrar`, callback_data: `agent_delete:${a.id}` })
    keyboard.push(row)
  }

  // Last row
  keyboard.push([{ text: '➕ Nuevo agente', callback_data: 'agent_new' }])

  return { inline_keyboard: keyboard }
}

async function handleListAgents(ctx) {
  const userId = ctx.from.id
  const text = buildAgentsMessage(userId)
  const keyboard = buildAgentsKeyboard(userId)
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard })
}

// ─── Agent inline callback handlers ───────────────────────────────────────────

async function handleAgentActivate(ctx, agentKey) {
  try {
    await handleSetAgent(ctx, agentKey)
  } catch (err) {
    await ctx.answerCbQuery('❌ Error', { show_alert: true }).catch(() => {})
    return
  }
  const userId = ctx.from.id
  const newText = buildAgentsMessage(userId)
  const newKeyboard = buildAgentsKeyboard(userId)
  await ctx.editMessageText(newText, { parse_mode: 'Markdown', reply_markup: newKeyboard }).catch(() => {})
  await ctx.answerCbQuery('✅ Agente activado').catch(() => {})
}

async function handleAgentEditFromButton(ctx, id) {
  const agent = customAgentManager.get(id)
  if (!agent) {
    await ctx.answerCbQuery('❌ Agente no encontrado', { show_alert: true }).catch(() => {})
    return
  }
  const session = sessionManager.getOrCreate(ctx.from.id)
  session.editAgentFlow = { targetId: id, field: null }
  await ctx.editMessageText(
    `✏️ Editando *${agent.emoji} ${escapeMd(agent.name)}*\n¿Qué querés cambiar?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '📝 Descripción',   callback_data: `editagent_desc:${id}` },
          { text: '🧠 System Prompt', callback_data: `editagent_prompt:${id}` },
          { text: '⚙️ CLI',           callback_data: `editagent_cli:${id}` },
          { text: '🚫 Cancelar',      callback_data: 'agent_list_refresh' },
        ]],
      },
    }
  ).catch(() => {})
  await ctx.answerCbQuery().catch(() => {})
}

async function handleAgentDeletePrompt(ctx, id) {
  const agent = customAgentManager.get(id)
  if (!agent) {
    await ctx.answerCbQuery('❌ Agente no encontrado', { show_alert: true }).catch(() => {})
    return
  }
  await ctx.editMessageText(
    `⚠️ ¿Seguro que querés borrar *${agent.emoji} ${escapeMd(agent.name)}*?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Sí, borrar', callback_data: `agent_delete_confirm:${id}` },
          { text: '❌ Cancelar',   callback_data: 'agent_list_refresh' },
        ]],
      },
    }
  ).catch(() => {})
  await ctx.answerCbQuery().catch(() => {})
}

async function handleAgentDeleteConfirm(ctx, id) {
  const agent = customAgentManager.get(id)
  if (!agent) {
    await ctx.editMessageText('El agente ya no existe.').catch(() => {})
    await ctx.answerCbQuery().catch(() => {})
    return
  }
  customAgentManager.remove(id)
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (session.agent === `custom:${id}`) {
    sessionManager.setAgent(ctx.from.id, process.env.DEFAULT_AGENT || 'claude')
  }
  const newText = buildAgentsMessage(ctx.from.id)
  const newKeyboard = buildAgentsKeyboard(ctx.from.id)
  await ctx.editMessageText(newText, { parse_mode: 'Markdown', reply_markup: newKeyboard }).catch(() => {})
  await ctx.answerCbQuery('🗑 Agente borrado').catch(() => {})
}

async function handleAgentListRefresh(ctx) {
  const userId = ctx.from.id
  const newText = buildAgentsMessage(userId)
  const newKeyboard = buildAgentsKeyboard(userId)
  await ctx.editMessageText(newText, { parse_mode: 'Markdown', reply_markup: newKeyboard }).catch(() => {})
  await ctx.answerCbQuery().catch(() => {})
}

async function handleAgentNew(ctx) {
  await ctx.answerCbQuery().catch(() => {})
  await ctx.reply('Usá /newagent para crear un nuevo agente personalizado.')
}

async function handleSetAgent(ctx, agentKey) {
  if (agentKey.startsWith('custom:')) {
    const id = agentKey.slice(7)
    const def = customAgentManager.get(id)
    if (!def) {
      await ctx.reply(`❌ Agente no encontrado: "${id}"`)
      return
    }
    sessionManager.setAgent(ctx.from.id, agentKey)
    if (def.ttsVoice) {
      sessionManager.setTtsVoice(ctx.from.id, def.ttsVoice)
      sessionManager.setTtsGender(ctx.from.id, def.ttsGender ?? 'masc')
    } else if (def.ttsGender) {
      sessionManager.setTtsGender(ctx.from.id, def.ttsGender)
    }
    const voiceEntry = def.ttsVoice
      ? VOICE_CATALOG.flatMap(g => g.voices).find(v => v.id === def.ttsVoice)
      : null
    const voiceLabel = voiceEntry?.label ?? (def.ttsGender === 'fem' ? 'Elena' : 'Tomás')
    await ctx.reply(`${def.emoji} Agente cambiado a *${def.name}* (voz: ${voiceLabel})`, { parse_mode: 'Markdown' })
    return
  }

  const agent = getAgentInfo(agentKey)
  if (!agent) {
    await ctx.reply(`❌ Agente desconocido: "${agentKey}"`)
    return
  }
  sessionManager.setAgent(ctx.from.id, agentKey)
  await ctx.reply(`${agent.emoji} Agente cambiado a *${agent.name}*`, { parse_mode: 'Markdown' })
}

async function handleSetAgentCmd(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/)
  const id = parts[1]?.toLowerCase()
  if (!id) {
    await ctx.reply('Usá `/setagent <id>` — ej: `/setagent python-expert`', { parse_mode: 'Markdown' })
    return
  }
  if (customAgentManager.get(id)) {
    return handleSetAgent(ctx, `custom:${id}`)
  }
  return handleSetAgent(ctx, id)
}

async function handleDefault(ctx) {
  const defaultKey = process.env.DEFAULT_AGENT || 'claude'
  return handleSetAgent(ctx, defaultKey)
}

async function handleSession(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  const agent = getAgentInfo(session.agent)
  const inactiveMins = Math.round((Date.now() - session.lastActivity) / 60_000)
  const { existsSync } = require('fs')
  const { resolve } = require('path')
  const persisted = existsSync(resolve(__dirname, `../../data/sessions/${ctx.from.id}.json`))

  const ttsVoice = session.ttsVoice
  const ttsVoiceLabel = ttsVoice
    ? (VOICE_CATALOG.flatMap(g => g.voices).find(v => v.id === ttsVoice)?.label ?? ttsVoice)
    : (session.ttsGender === 'fem' ? 'Elena (default)' : 'Tomás (default)')

  await ctx.reply(
    `📋 *Tu sesión*\n\n` +
    `ID: \`${session.id.slice(0, 8)}...\`\n` +
    `${agent?.emoji ?? '🤖'} Agente: *${agent?.name ?? session.agent}*\n` +
    `🧠 autoMode: *${session.autoMode ? 'ON' : 'OFF'}*\n` +
    `🎙️ Modo voz: *${session.voiceMode ? 'ON' : 'OFF'}*\n` +
    `🔊 Botón audio: *${session.ttsButton ? 'ON' : 'OFF'}*\n` +
    `🗣️ Voz TTS: *${ttsVoiceLabel}*\n` +
    `💬 Mensajes en historial: ${session.history.length}\n` +
    `📊 Tareas totales: ${session.taskCount}\n` +
    `💾 Historial persistido: ${persisted ? 'sí' : 'no'}\n` +
    `⏱ Última actividad: hace ${inactiveMins} min`,
    { parse_mode: 'Markdown' }
  )
}

async function handleClearHistory(ctx) {
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)

  // Cancel any active flows
  session.newAgentFlow = null
  session.editAgentFlow = null

  const bg = sessionManager.getBackgroundTask(userId)
  if (bg) {
    if (typeof bg.cancel === 'function') bg.cancel()
    if (bg.statusMsgId) {
      await ctx.telegram.deleteMessage(ctx.chat.id, bg.statusMsgId).catch(() => {})
    }
    if (bg.transitionMsgId) {
      await ctx.telegram.deleteMessage(ctx.chat.id, bg.transitionMsgId).catch(() => {})
    }
    sessionManager.clearBackgroundTask(userId)
  }
  // Clean up any pending file attachment
  const pending = sessionManager.getPendingFile(userId)
  if (pending?.localPath) {
    fileManager.cleanupFile(pending.localPath)
    sessionManager.clearPendingFile(userId)
  }
  sessionManager.clearHistory(userId)
  await ctx.reply('🗑 Historial borrado. La siguiente respuesta comenzará sin contexto previo.')
}

// ─── Soul handlers ─────────────────────────────────────────────────────────────

async function handleSoul(ctx) {
  const userId = ctx.from.id
  const parts = (ctx.message?.text ?? '').trim().split(/\s+/)
  const subcmd = parts[1]?.toLowerCase()

  if (subcmd === 'reset') {
    if (soulManager.soulExists()) {
      // Ask for confirmation via a temporary onboarding state
      const session = sessionManager.getOrCreate(userId)
      session.onboarding = { step: 'awaiting_reset_confirm', answers: {}, pendingMessage: null }
      await ctx.reply(
        '¿Seguro que querés resetear mi alma? Se va a borrar todo lo que sé de vos. (respondé *sí* o *no*)',
        { parse_mode: 'Markdown' }
      )
    } else {
      sessionManager.startOnboarding(userId, null)
      await handleOnboarding(ctx, null)
    }
    return
  }

  const soul = soulManager.get()
  if (!soul) {
    await ctx.reply(
      'No tengo alma todavía 😶 Mandame cualquier mensaje y te pregunto cómo configurarla.',
      { parse_mode: 'Markdown' }
    )
    return
  }

  const preview = soul.length > 3800 ? soul.slice(0, 3800) + '\n...(truncado)' : soul
  await ctx.reply(
    `📄 *Mi alma actual:*\n\n\`\`\`\n${preview}\n\`\`\``,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✏️ Editar soul',           callback_data: 'soul_edit' },
          { text: '🔄 Recargar desde archivo', callback_data: 'soul_reload' },
        ]],
      },
    }
  ).catch(() => ctx.reply(`📄 Mi alma actual:\n\n${preview}`))
}

// ─── Soul inline callback handlers ────────────────────────────────────────────

async function handleSoulEdit(ctx) {
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)
  session.editSoulFlow = true
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {})
  await ctx.reply('✏️ Escribí el nuevo contenido para SOUL.md (se reemplazará por completo):')
  await ctx.answerCbQuery().catch(() => {})
}

async function handleSoulReload(ctx) {
  soulManager.reload()
  const exists = soulManager.soulExists()
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {})
  await ctx.reply(exists ? '🔄 SOUL.md recargado correctamente.' : '⚠️ SOUL.md no encontrado en disco.')
  await ctx.answerCbQuery(exists ? '🔄 Recargado' : '⚠️ No encontrado').catch(() => {})
}

async function handleReloadSoul(ctx) {
  soulManager.reload()
  const exists = soulManager.soulExists()
  await ctx.reply(
    exists ? '🔄 SOUL.md recargado correctamente.' : '⚠️ SOUL.md no encontrado en disco.'
  )
}

async function handleSkip(ctx) {
  const userId = ctx.from.id
  const ob = sessionManager.getOnboarding(userId)
  if (!ob || ob.step !== 'ask_extra') {
    await ctx.reply('(No hay nada que saltear ahora.)')
    return
  }
  // Advance with empty answer
  sessionManager.advanceOnboarding(userId, '')
  await handleOnboarding(ctx, null)
}

// ─── Memory handlers ───────────────────────────────────────────────────────────

async function handleRemember(ctx) {
  const text = ctx.message.text.replace(/^\/remember\s*/i, '').trim()
  if (!text) {
    await ctx.reply('Usá `/remember <texto>` para guardar una memoria.', { parse_mode: 'Markdown' })
    return
  }
  const id = await memoryManager.save(text)
  await ctx.reply(`🧠 Memoria guardada.\n\`${id}\``, { parse_mode: 'Markdown' })
}

async function handleMemories(ctx) {
  const parts = (ctx.message?.text ?? '').trim().split(/\s+/)
  const page = parseInt(parts[1]) || 1
  const memories = await memoryManager.list(page, 10)

  if (memories.length === 0) {
    await ctx.reply(page > 1 ? 'No hay más memorias.' : 'No tenés memorias guardadas.')
    return
  }

  const lines = memories.map((m, i) => {
    const idx = (page - 1) * 10 + i + 1
    const date = m.date ? m.date.slice(0, 10) : '?'
    return `${idx}\\. \\[${date}\\] ${escapeMd(m.preview)}`
  })

  // Build keyboard: one delete button per memory
  const keyboard = memories.map((m) => [
    { text: `🗑 Borrar: ${m.preview.slice(0, 30)}…`, callback_data: `memory_forget:${m.id}` },
  ])

  // Pagination row
  const paginationRow = []
  if (page > 1) paginationRow.push({ text: '← Anterior', callback_data: `memories_page:${page - 1}` })
  paginationRow.push({ text: `Página ${page + 1} →`, callback_data: `memories_page:${page + 1}` })
  keyboard.push(paginationRow)

  await ctx.reply(
    `🧠 *Memorias (página ${page}):*\n\n${lines.join('\n')}`,
    { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } }
  ).catch(() => ctx.reply(`Memorias (página ${page}):\n\n${memories.map((m, i) => `${(page-1)*10+i+1}. ${m.preview}`).join('\n')}`))
}

// ─── Memory inline callback handlers ──────────────────────────────────────────

async function handleMemoryForget(ctx, memId) {
  try {
    const ok = await memoryManager.remove(memId)
    if (!ok) {
      await ctx.answerCbQuery('❌ Memoria no encontrada', { show_alert: true }).catch(() => {})
      return
    }
    // Refresh memories list in same message if possible
    const memories = await memoryManager.list(1, 10)
    if (memories.length === 0) {
      await ctx.editMessageText('🧠 No quedan memorias guardadas.').catch(() => {})
      await ctx.answerCbQuery('🗑 Borrada').catch(() => {})
      return
    }
    const lines = memories.map((m, i) => `${i + 1}\\. \\[${m.date ? m.date.slice(0,10) : '?'}\\] ${escapeMd(m.preview)}`)
    const keyboard = memories.map((m) => [
      { text: `🗑 Borrar: ${m.preview.slice(0, 30)}…`, callback_data: `memory_forget:${m.id}` },
    ])
    keyboard.push([{ text: 'Página 2 →', callback_data: 'memories_page:2' }])
    await ctx.editMessageText(
      `🧠 *Memorias (página 1):*\n\n${lines.join('\n')}`,
      { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } }
    ).catch(() => {})
    await ctx.answerCbQuery('🗑 Memoria borrada').catch(() => {})
  } catch (err) {
    await ctx.answerCbQuery('❌ Error', { show_alert: true }).catch(() => {})
  }
}

async function handleMemoriesPage(ctx, pageStr) {
  const page = Math.max(1, parseInt(pageStr) || 1)
  const memories = await memoryManager.list(page, 10)
  if (memories.length === 0) {
    await ctx.editMessageText(page > 1 ? 'No hay más memorias.' : 'No tenés memorias guardadas.').catch(() => {})
    await ctx.answerCbQuery().catch(() => {})
    return
  }
  const lines = memories.map((m, i) => {
    const idx = (page - 1) * 10 + i + 1
    const date = m.date ? m.date.slice(0, 10) : '?'
    return `${idx}\\. \\[${date}\\] ${escapeMd(m.preview)}`
  })
  const keyboard = memories.map((m) => [
    { text: `🗑 Borrar: ${m.preview.slice(0, 30)}…`, callback_data: `memory_forget:${m.id}` },
  ])
  const paginationRow = []
  if (page > 1) paginationRow.push({ text: '← Anterior', callback_data: `memories_page:${page - 1}` })
  paginationRow.push({ text: `Página ${page + 1} →`, callback_data: `memories_page:${page + 1}` })
  keyboard.push(paginationRow)
  await ctx.editMessageText(
    `🧠 *Memorias (página ${page}):*\n\n${lines.join('\n')}`,
    { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } }
  ).catch(() => {})
  await ctx.answerCbQuery().catch(() => {})
}

async function handleForget(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/)
  const arg = parts[1] || 'last'
  const ok = await memoryManager.remove(arg)
  if (ok) {
    await ctx.reply(`🗑 Memoria borrada.`)
  } else {
    await ctx.reply(`❌ No encontré una memoria con ese ID. Usá /memories para ver los IDs.`)
  }
}

// ─── Custom Agent handlers ─────────────────────────────────────────────────────

async function handleNewAgent(ctx) {
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)
  session.newAgentFlow = { step: 'ask_name', answers: {} }
  await ctx.reply(
    '🤖 *Crear nuevo agente*\n\n¿Cómo se llama este agente? (ej: `python-expert`)\n\nPodés cancelar enviando cualquier comando.',
    { parse_mode: 'Markdown' }
  )
}

async function handleDelAgent(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/)
  const id = parts[1]?.toLowerCase()
  if (!id) {
    await ctx.reply('Usá `/delagent <id>` — ej: `/delagent python-expert`', { parse_mode: 'Markdown' })
    return
  }
  const agent = customAgentManager.get(id)
  if (!agent) {
    await ctx.reply(`❌ No encontré un agente con el nombre "${id}"`)
    return
  }
  await ctx.reply(
    `¿Seguro que querés borrar *${agent.emoji} ${agent.name}*?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Confirmar', callback_data: `delagent_yes:${id}` },
          { text: '❌ Cancelar',  callback_data: 'delagent_no' },
        ]],
      },
    }
  )
}

async function handleEditAgent(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/)
  const id = parts[1]?.toLowerCase()
  if (!id) {
    await ctx.reply('Usá `/editagent <id>` — ej: `/editagent python-expert`', { parse_mode: 'Markdown' })
    return
  }
  const agent = customAgentManager.get(id)
  if (!agent) {
    await ctx.reply(`❌ No encontré un agente con el nombre "${id}"`)
    return
  }
  const session = sessionManager.getOrCreate(ctx.from.id)
  session.editAgentFlow = { targetId: id, field: null }
  await ctx.reply(
    `✏️ Editando *${agent.emoji} ${agent.name}*\n¿Qué querés cambiar?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '📝 Descripción',   callback_data: `editagent_desc:${id}` },
          { text: '🧠 System Prompt', callback_data: `editagent_prompt:${id}` },
          { text: '⚙️ CLI',           callback_data: `editagent_cli:${id}` },
          { text: '🚫 Cancelar',      callback_data: 'editagent_cancel' },
        ]],
      },
    }
  )
}

async function handleAuto(ctx) {
  const text = ctx.message.text.replace(/^\/auto\s*/i, '').trim()
  if (!text) {
    await ctx.reply('Usá `/auto <tarea>` para que el Root Agent elija el mejor agente.\nEj: `/auto revisá este script de bash`', { parse_mode: 'Markdown' })
    return
  }
  const agents = customAgentManager.list()
  if (agents.length === 0) {
    await ctx.reply('No tenés custom agents todavía. Creá uno con /newagent')
    return
  }

  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)
  const routeMsg = await ctx.reply('🧠 Analizando qué agente es mejor para esto...').catch(() => null)

  const selectedId = await routeWithRootAgent(text, session)
  if (routeMsg) await ctx.telegram.deleteMessage(ctx.chat.id, routeMsg.message_id).catch(() => {})

  if (!selectedId) {
    ctx.message.text = text
    return handleTask(ctx)
  }

  if (typeof selectedId === 'object') {
    if (selectedId.type === 'team') {
      const team = teamManager.get(selectedId.teamId)
      if (team) {
        const task = taskManager.create(team.id, text, String(userId), ctx.chat.id)
        await ctx.reply(`🧠 → Equipo *${team.name}*\n✅ *Tarea #${task.id}* creada: _${task.title}_`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[
            { text: '👁 Ver diálogo interno', callback_data: `team_liveview_on:${task.id}` },
            { text: '❌ Cancelar', callback_data: `team_task_cancel:${task.id}` },
          ]]},
        })
        if (team.heartbeatIntervalMin > 0) {
          heartbeatManager.start(task.id, ctx.chat.id, team.id, team.heartbeatIntervalMin, ctx.telegram)
        }
        teamWorkflow.runTask(task.id, ctx.telegram).catch(err => logger.error(`/auto team error: ${err.message}`))
        return
      }
    } else if (selectedId.type === 'ambos') {
      const team = teamManager.get(selectedId.teamId)
      const agentDef = customAgentManager.get(selectedId.agentId)
      if (team && agentDef) {
        session.pendingAutoRoutePrompt  = text
        session.pendingAutoRouteTeamId  = selectedId.teamId
        session.pendingAutoRouteAgentId = selectedId.agentId
        await ctx.reply(
          `🧠 Podría ir para dos lados. ¿Cómo querés resolver esto?\n\n` +
          `*${agentDef.emoji} ${agentDef.name}* — respuesta rápida\n` +
          `*${team.name}* — flujo completo de equipo`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
              { text: `${agentDef.emoji} Agente`, callback_data: `setagent:${selectedId.agentId}` },
              { text: `👥 Equipo`, callback_data: `autoroute_team:${selectedId.teamId}` },
            ]]},
          }
        )
        return
      }
    }
    ctx.message.text = text
    return handleTask(ctx)
  }

  // selectedId is a string agent ID
  const agentDef = customAgentManager.get(selectedId)
  await ctx.reply(`🧠 → *${agentDef?.emoji ?? '🤖'} ${agentDef?.name ?? selectedId}*`, { parse_mode: 'Markdown' })
  ctx.message.text = `@${selectedId} ${text}`
  return handleTask(ctx)
}

async function handleAutoMode(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/)
  const arg = parts[1]?.toLowerCase()
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)

  if (arg === 'on') {
    const agents = customAgentManager.list()
    const teams  = teamManager.list()
    if (agents.length === 0 && teams.length === 0) {
      await ctx.reply('⚠️ No tenés agentes ni equipos. Creá uno con /newagent o /buildteam antes de activar el modo automático.')
      return
    }
    sessionManager.setAutoMode(userId, true)
    await ctx.reply('🧠 *autoMode ON* — De ahora en adelante elijo el mejor agente o equipo para cada tarea.', { parse_mode: 'Markdown' })
  } else if (arg === 'off') {
    sessionManager.setAutoMode(userId, false)
    await ctx.reply('🔒 *autoMode OFF* — Volvés al agente activo de sesión.', { parse_mode: 'Markdown' })
  } else {
    const current = session.autoMode ? 'ON' : 'OFF'
    await ctx.reply(`🧠 autoMode está *${current}*.\nUsá \`/automode on\` o \`/automode off\``, { parse_mode: 'Markdown' })
  }
}

// ─── Inline keyboard callbacks — newAgentFlow ──────────────────────────────────

async function handleNewAgentCliSelect(ctx, cli) {
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)
  if (!session.newAgentFlow || session.newAgentFlow.step !== 'awaiting_cli') {
    await ctx.editMessageText('Este flow ya expiró. Usá /newagent para empezar de nuevo.').catch(() => {})
    return
  }
  const { answers } = session.newAgentFlow
  answers.cli = cli
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {})
  await _saveNewAgent(ctx, session)
}

async function handleNewAgentVoiceLangSelect(ctx, langIdxStr) {
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)
  if (!session.newAgentFlow || session.newAgentFlow.step !== 'awaiting_voice') {
    await ctx.editMessageText('Este flow ya expiró. Usá /newagent para empezar de nuevo.').catch(() => {})
    return
  }
  const langIdx = parseInt(langIdxStr)
  const keyboard = buildVoiceKeyboard(langIdx, 'newagent_vs', `newagent_vback`)
  if (!keyboard) {
    await ctx.editMessageText('Idioma no encontrado.').catch(() => {})
    return
  }
  const group = VOICE_CATALOG[langIdx]
  await ctx.editMessageText(
    `🗣️ *${group.lang}* — elegí la voz del agente:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  ).catch(() => {})
}

async function handleNewAgentVoiceSelect(ctx, voiceName) {
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)
  if (!session.newAgentFlow || session.newAgentFlow.step !== 'awaiting_voice') {
    await ctx.editMessageText('Este flow ya expiró. Usá /newagent para empezar de nuevo.').catch(() => {})
    return
  }
  const entry = VOICE_CATALOG.flatMap(g => g.voices).find(v => v.id === voiceName)
  session.newAgentFlow.answers.ttsVoice = voiceName
  session.newAgentFlow.answers.ttsGender = entry?.gender ?? 'masc'
  session.newAgentFlow.step = 'awaiting_cli'
  const cliStatus = global.__cliStatus ?? {}
  const buttons = ['claude', 'gemini', 'codex'].map(cli => {
    const ok = cliStatus[cli]?.found !== false
    return { text: `${ok ? '✅' : '⚠️'} ${cli}`, callback_data: `newagent_cli:${cli}` }
  })
  await ctx.editMessageText('¿Qué CLI usás como motor?', {
    reply_markup: { inline_keyboard: [buttons] },
  }).catch(async () => {
    await ctx.reply('¿Qué CLI usás como motor?', { reply_markup: { inline_keyboard: [buttons] } })
  })
}

async function _saveNewAgent(ctx, session) {
  const { answers } = session.newAgentFlow
  session.newAgentFlow = null
  try {
    const agent = customAgentManager.create(answers)
    const longPrompt = agent.systemPrompt.length > 8000
    await ctx.reply(
      `✅ Agente *${agent.emoji} ${agent.name}* creado.` +
      (longPrompt ? '\n⚠️ El system prompt es muy largo (>8000 chars) — puede truncarse.' : '') +
      `\n\nUsalo con \`@${agent.id} <tarea>\``,
      { parse_mode: 'Markdown' }
    )
  } catch (err) {
    await ctx.reply(`❌ ${err.message}`)
  }
}

// ─── Inline keyboard callbacks — delagent ──────────────────────────────────────

async function handleDelAgentConfirm(ctx, id) {
  const agent = customAgentManager.get(id)
  if (!agent) {
    await ctx.editMessageText('El agente ya no existe.').catch(() => {})
    return
  }
  customAgentManager.remove(id)
  // If active agent in session → revert to default
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (session.agent === `custom:${id}`) {
    sessionManager.setAgent(ctx.from.id, process.env.DEFAULT_AGENT || 'claude')
  }
  await ctx.editMessageText(
    `🗑 Agente *${agent.emoji} ${agent.name}* borrado.`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
  ).catch(() => {})
}

async function handleDelAgentCancel(ctx) {
  await ctx.editMessageText('Cancelado.', { reply_markup: { inline_keyboard: [] } }).catch(() => {})
}

// ─── Inline keyboard callbacks — editagent ─────────────────────────────────────

async function handleEditAgentFieldSelect(ctx, field, id) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (!session.editAgentFlow || session.editAgentFlow.targetId !== id) {
    await ctx.editMessageText('Este flow ya expiró.').catch(() => {})
    return
  }
  const agent = customAgentManager.get(id)
  if (!agent) {
    await ctx.editMessageText('El agente ya no existe.').catch(() => {})
    session.editAgentFlow = null
    return
  }
  if (field === 'cli') {
    session.editAgentFlow.field = 'cli'
    await ctx.editMessageText(
      `⚙️ CLI actual: *${agent.cli}*\n¿Cuál querés usar?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🤖 Claude', callback_data: 'editagent_cli_val:claude' },
            { text: '✨ Gemini', callback_data: 'editagent_cli_val:gemini' },
            { text: '🧠 Codex',  callback_data: 'editagent_cli_val:codex'  },
          ]],
        },
      }
    ).catch(() => {})
    return
  }
  session.editAgentFlow.field = field
  const fieldLabel = field === 'description' ? 'nueva descripción' : 'nuevo system prompt'
  await ctx.editMessageText(
    `Escribí el ${fieldLabel} para *${agent.emoji} ${agent.name}*:`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
  ).catch(() => ctx.reply(`Escribí el ${fieldLabel}:`))
}

async function handleEditAgentCliValSelect(ctx, cli) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (!session.editAgentFlow || session.editAgentFlow.field !== 'cli') {
    await ctx.editMessageText('Este flow ya expiró.').catch(() => {})
    return
  }
  const { targetId } = session.editAgentFlow
  session.editAgentFlow = null
  const updated = customAgentManager.update(targetId, { cli })
  if (!updated) {
    await ctx.editMessageText('El agente ya no existe.').catch(() => {})
    return
  }
  await ctx.editMessageText(
    `✅ *${updated.emoji} ${updated.name}* actualizado — CLI: *${cli}*`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
  ).catch(() => {})
}

async function handleEditAgentCancel(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  session.editAgentFlow = null
  await ctx.editMessageText('Cancelado.', { reply_markup: { inline_keyboard: [] } }).catch(() => {})
}

// ─── TTS voice picker helpers ──────────────────────────────────────────────────

/**
 * Builds the inline keyboard for language selection.
 * @param {string} cbPrefix  e.g. 'ttsvoice_l' or 'newagent_vl'
 */
function buildLangKeyboard(cbPrefix) {
  const rows = []
  for (let i = 0; i < VOICE_CATALOG.length; i += 2) {
    const row = [{ text: VOICE_CATALOG[i].lang, callback_data: `${cbPrefix}:${i}` }]
    if (VOICE_CATALOG[i + 1]) {
      row.push({ text: VOICE_CATALOG[i + 1].lang, callback_data: `${cbPrefix}:${i + 1}` })
    }
    rows.push(row)
  }
  return { inline_keyboard: rows }
}

/**
 * Builds the inline keyboard for voice selection within a language group.
 * @param {number} langIdx  Index in VOICE_CATALOG
 * @param {string} cbPrefix  e.g. 'ttsvoice_s' or 'newagent_vs'
 * @param {string} backCb    callback_data for the ← Back button
 */
function buildVoiceKeyboard(langIdx, cbPrefix, backCb) {
  const group = VOICE_CATALOG[langIdx]
  if (!group) return null
  const voiceRow = group.voices.map(v => ({
    text: `${v.gender === 'fem' ? '👩' : '🗣️'} ${v.label}`,
    callback_data: `${cbPrefix}:${v.id}`,
  }))
  return { inline_keyboard: [voiceRow, [{ text: '← Volver', callback_data: backCb }]] }
}

// ─── MCP keyboard helper ────────────────────────────────────────────────────────

// ─── TTS helpers & handlers ────────────────────────────────────────────────────

/** Returns the effective TTS voice for a userId (full name or gender fallback). */
function getEffectiveVoice(userId) {
  return sessionManager.getTtsVoice(userId) || sessionManager.getTtsGender(userId)
}

/**
 * Generates TTS audio from text and sends it as a Telegram voice note (OGG Opus).
 * Deletes the temp file after sending (or on error).
 * @param {object} ctx           Telegraf context
 * @param {string} text          Raw text (sanitized inside ttsService)
 * @param {string} [voiceOrGender]  Full voice name or 'masc'/'fem'
 */
async function sendTtsAudio(ctx, text, voiceOrGender) {
  logger.info(`[TTS] generateAudio start — voice=${voiceOrGender} textLen=${text?.length}`)
  const audioPath = await ttsService.generateAudio(text, voiceOrGender)
  logger.info(`[TTS] generateAudio OK — file=${audioPath}`)
  try {
    logger.info(`[TTS] replyWithVoice start`)
    await ctx.replyWithVoice({ source: createReadStream(audioPath) })
    logger.info(`[TTS] replyWithVoice OK`)
  } catch (voiceErr) {
    logger.error(`[TTS] replyWithVoice FAILED: ${voiceErr.message}`)
    throw voiceErr
  } finally {
    await ttsService.deleteAudio(audioPath)
  }
}

async function handleVoiceMode(ctx) {
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)
  const current = session.voiceMode ?? false
  const next = !current
  sessionManager.setVoiceMode(userId, next)
  // If activating voiceMode, disable ttsButton to avoid conflict
  if (next && session.ttsButton) {
    sessionManager.setTtsButton(userId, false)
  }
  await ctx.reply(
    next
      ? '🎙️ *Modo voz ON* — Las respuestas llegarán solo como audio. Usá /voicemode para desactivar.'
      : '💬 *Modo voz OFF* — Volvés a respuestas de texto.',
    { parse_mode: 'Markdown' }
  )
}

async function handleTtsButton(ctx) {
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)
  const current = session.ttsButton ?? false
  const next = !current
  sessionManager.setTtsButton(userId, next)
  // If activating ttsButton, disable voiceMode to avoid conflict
  if (next && session.voiceMode) {
    sessionManager.setVoiceMode(userId, false)
  }
  await ctx.reply(
    next
      ? '🔊 *Botón de audio activado* — Aparecerá un botón 🔊 bajo cada respuesta. Usá /ttsbutton para desactivarlo.'
      : '🔇 *Botón de audio desactivado* — Las respuestas volverán a ser solo texto.',
    { parse_mode: 'Markdown' }
  )
}

async function handleListen(ctx) {
  const userId = ctx.from.id
  const lastResponse = sessionManager.getLastResponse(userId)

  if (!lastResponse) {
    await ctx.reply('No hay respuesta reciente para convertir. Enviá un mensaje primero.')
    return
  }

  const statusMsg = await ctx.reply('🎙️ Generando audio...').catch(() => null)
  try {
    await sendTtsAudio(ctx, lastResponse, getEffectiveVoice(userId))
  } catch (err) {
    logger.error(`TTS /voz failed for user ${userId}: ${err.message}`)
    await ctx.reply(`❌ No pude generar el audio: ${err.message.split('\n')[0].slice(0, 150)}`)
  } finally {
    if (statusMsg) await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
  }
}

async function handleTtsVoice(ctx) {
  const userId = ctx.from.id
  const current = sessionManager.getTtsVoice(userId)
  const currentLabel = current
    ? VOICE_CATALOG.flatMap(g => g.voices).find(v => v.id === current)?.label ?? current
    : (sessionManager.getTtsGender(userId) === 'fem' ? 'Elena' : 'Tomás')
  await ctx.reply(
    `🔊 *Seleccioná el idioma de la voz*\n\nVoz actual: *${currentLabel}*`,
    { parse_mode: 'Markdown', reply_markup: buildLangKeyboard('ttsvoice_l') }
  )
}

async function handleTtsVoiceLangSelect(ctx, langIdxStr) {
  const langIdx = parseInt(langIdxStr)
  const keyboard = buildVoiceKeyboard(langIdx, 'ttsvoice_s', 'ttsvoice_back')
  if (!keyboard) {
    await ctx.editMessageText('Idioma no encontrado.').catch(() => {})
    return
  }
  const group = VOICE_CATALOG[langIdx]
  await ctx.editMessageText(
    `🗣️ *${group.lang}* — elegí una voz:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  ).catch(() => {})
}

async function handleTtsVoiceSelect(ctx, voiceName) {
  const userId = ctx.from.id
  const entry = VOICE_CATALOG.flatMap(g => g.voices).find(v => v.id === voiceName)
  if (!entry) {
    await ctx.editMessageText('Voz no encontrada.').catch(() => {})
    return
  }
  sessionManager.setTtsVoice(userId, voiceName)
  sessionManager.setTtsGender(userId, entry.gender)
  await ctx.editMessageText(
    `✅ Voz activada: *${entry.label}* (${voiceName})`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } }
  ).catch(async () => {
    await ctx.reply(`✅ Voz activada: *${entry.label}*`, { parse_mode: 'Markdown' })
  })
}

async function handleTtsCallback(ctx) {
  const userId = ctx.from.id
  const lastResponse = sessionManager.getLastResponse(userId)
  if (!lastResponse) {
    await ctx.answerCbQuery('No hay respuesta para convertir', { show_alert: true }).catch(() => {})
    return
  }
  await ctx.answerCbQuery('Generando audio...').catch(() => {})
  try {
    await sendTtsAudio(ctx, lastResponse, getEffectiveVoice(userId))
  } catch (err) {
    logger.error(`TTS callback failed for user ${userId}: ${err.message}`)
    await ctx.reply(`❌ No pude generar el audio: ${err.message.split('\n')[0].slice(0, 150)}`)
  }
}

// ─── Main task handler ─────────────────────────────────────────────────────────

async function handleTask(ctx, forcedText) {
  const text = (forcedText ?? ctx.message?.text)?.trim()
  if (!text) return

  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)

  // Handle reset confirmation
  if (session.onboarding?.step === 'awaiting_reset_confirm') {
    const answer = text.toLowerCase()
    if (answer === 'sí' || answer === 'si' || answer === 's') {
      sessionManager.startOnboarding(userId, null)
      await handleOnboarding(ctx, null)
    } else {
      sessionManager.clearOnboarding(userId)
      await ctx.reply('Ok, cancelado. Mi alma sigue igual. 🐙')
    }
    return
  }

  // If onboarding is active, route to it
  if (session.onboarding) {
    return handleOnboarding(ctx, text)
  }

  // If no SOUL.md, start onboarding and save this message as pending
  if (!soulManager.soulExists()) {
    sessionManager.startOnboarding(userId, text)
    return handleOnboarding(ctx, null)
  }

  // ─── newAgentFlow text steps ───────────────────────────────────────────────

  if (session.newAgentFlow) {
    const flow = session.newAgentFlow
    if (flow.step === 'ask_name') {
      flow.answers.name = text
      flow.step = 'ask_description'
      await ctx.reply('Dame una descripción corta de qué hace este agente:')
      return
    }
    if (flow.step === 'ask_description') {
      flow.answers.description = text
      flow.step = 'ask_system_prompt'
      await ctx.reply('Ahora el system prompt completo (la "personalidad" del agente):')
      return
    }
    if (flow.step === 'ask_system_prompt') {
      flow.answers.systemPrompt = text
      flow.step = 'awaiting_voice'
      await ctx.reply(
        '🔊 *¿Qué voz usará este agente?*\nElegí el idioma:',
        { parse_mode: 'Markdown', reply_markup: buildLangKeyboard('newagent_vl') }
      )
      return
    }
    // awaiting_voice / awaiting_cli — user must press a button
    await ctx.reply('Tocá uno de los botones de arriba, o enviá un comando para cancelar.')
    return
  }

  // ─── editSoulFlow text step ────────────────────────────────────────────────

  if (session.editSoulFlow) {
    session.editSoulFlow = null
    try {
      await soulManager.writeSoul(text)
      soulManager.reload()
      await ctx.reply('✅ Soul actualizado y recargado.')
    } catch (err) {
      await ctx.reply(`❌ No se pudo guardar el soul: ${err.message.slice(0, 100)}`)
    }
    return
  }

  // ─── editAgentFlow text step ───────────────────────────────────────────────

  if (session.editAgentFlow?.field && session.editAgentFlow.field !== 'cli') {
    const { targetId, field } = session.editAgentFlow
    session.editAgentFlow = null
    const updated = customAgentManager.update(targetId, { [field]: text })
    if (!updated) {
      await ctx.reply('❌ El agente ya no existe.')
      return
    }
    await ctx.reply(`✅ *${updated.emoji} ${updated.name}* actualizado.`, { parse_mode: 'Markdown' })
    return
  }

  // T9: If a background task is already running, route this message to the
  // continuity agent so the user isn't left hanging.
  const existingBg = sessionManager.getBackgroundTask(userId)
  if (existingBg) {
    let contStatusMsg = null
    try {
      const contAgent = getAgentInfo(session.agent)
      contStatusMsg = await ctx.reply(
        `${contAgent.emoji} Procesando con *${contAgent.name}*...`,
        { parse_mode: 'Markdown' }
      ).catch(() => null)

      const response = await dispatch(session.agent, text, session)
      sessionManager.addToHistory(userId, 'user', text)
      sessionManager.addToHistory(userId, 'assistant', response)

      const chunks = splitMessage(response, MAX_RESPONSE_LENGTH)
      for (const chunk of chunks) {
        await sendWithFallback(ctx, chunk)
      }
    } catch (err) {
      logger.error(`Continuity task failed for user ${userId}: ${err.message}`)
      await ctx.reply(`❌ ${(err.message ?? 'Error').split('\n')[0].slice(0, 200)}`).catch(() => {})
    } finally {
      if (contStatusMsg) {
        await ctx.telegram.deleteMessage(ctx.chat.id, contStatusMsg.message_id).catch(() => {})
      }
    }
    return
  }

  // ─── Parse "@alias task" mention ──────────────────────────────────────────

  let agentKey = null
  let prompt = text

  const match = text.match(MENTION_RE)
  if (match) {
    const alias = match[1]
    const resolved = resolveAgent(alias)
    if (resolved) {
      agentKey = resolved
      prompt = match[2].trim()
      logger.debug(`Mention resolved: @${alias} → ${resolved}`)
    } else {
      // Check if it's a team
      const team = teamManager.get(alias)
      if (team) {
        const taskDesc = match[2].trim()
        const task = taskManager.create(team.id, taskDesc, String(userId), ctx.chat.id)
        await ctx.reply(
          `👥 *${team.name}*\n✅ Tarea *#${task.id}* iniciada: _${task.title}_`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
            { text: '👁 Ver diálogo interno', callback_data: `team_liveview_on:${task.id}` },
            { text: '❌ Cancelar', callback_data: `team_task_cancel:${task.id}` },
          ]]}}
        )
        if (team.heartbeatIntervalMin > 0) {
          heartbeatManager.start(task.id, ctx.chat.id, team.id, team.heartbeatIntervalMin, ctx.telegram)
        }
        teamWorkflow.runTask(task.id, ctx.telegram).catch(err =>
          logger.error(`@mention team dispatch error: ${err.message}`)
        )
        return
      }
      // Unknown alias
      await ctx.reply(`❌ No encontré un agente ni equipo con el ID \`${alias}\`.`, { parse_mode: 'Markdown' })
      return
    }
  }

  // ─── autoMode: root agent routing ─────────────────────────────────────────

  let derivedAgentName = null
  if (session.autoMode && !agentKey) {
    const tempMsg = await ctx.reply('🧠 Analizando el mejor agente para tu tarea...').catch(() => null)
    try {
      const currentId = session.agent.startsWith('custom:') ? session.agent.slice(7) : null
      const selectedId = await routeWithRootAgent(prompt, session)

      // selectedId can be: string (agent), { type:'team', teamId }, { type:'ambos', agentId, teamId }
      if (selectedId && typeof selectedId === 'object') {
        if (tempMsg) await ctx.telegram.deleteMessage(ctx.chat.id, tempMsg.message_id).catch(() => {})

        if (selectedId.type === 'team') {
          const team = teamManager.get(selectedId.teamId)
          if (team) {
            const task = taskManager.create(team.id, prompt, String(userId), ctx.chat.id)
            await ctx.reply(
              `🧠 → Equipo *${team.name}*\n✅ *Tarea #${task.id}* creada: _${task.title}_`,
              { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
                { text: '👁 Ver diálogo interno', callback_data: `team_liveview_on:${task.id}` },
                { text: '❌ Cancelar', callback_data: `team_task_cancel:${task.id}` },
              ]]}}
            )
            if (team.heartbeatIntervalMin > 0) {
              heartbeatManager.start(task.id, ctx.chat.id, team.id, team.heartbeatIntervalMin, ctx.telegram)
            }
            teamWorkflow.runTask(task.id, ctx.telegram).catch(err =>
              logger.error(`autoMode team routing error: ${err.message}`)
            )
            return  // task dispatched to team, skip regular agent dispatch
          }
        } else if (selectedId.type === 'ambos') {
          const team = teamManager.get(selectedId.teamId)
          const agentDef = customAgentManager.get(selectedId.agentId)
          if (team && agentDef) {
            session.pendingAutoRoutePrompt  = prompt
            session.pendingAutoRouteTeamId  = selectedId.teamId
            session.pendingAutoRouteAgentId = selectedId.agentId
            await ctx.reply(
              `🧠 Podría ir para dos lados. ¿Cómo querés resolver esto?\n\n` +
              `*${agentDef.emoji} ${agentDef.name}* — respuesta rápida\n` +
              `*${team.name}* — flujo completo de equipo`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[
                    { text: `${agentDef.emoji} Agente`, callback_data: `setagent:${selectedId.agentId}` },
                    { text: `👥 Equipo`, callback_data: `autoroute_team:${selectedId.teamId}` },
                  ]],
                },
              }
            )
            return  // wait for user button press
          }
        }
      } else if (selectedId && typeof selectedId === 'string' && selectedId !== currentId) {
        agentKey = `custom:${selectedId}`
        const def = customAgentManager.get(selectedId)
        derivedAgentName = def ? `${def.emoji} ${def.name}` : selectedId
      }
    } catch (err) {
      logger.warn(`autoMode routing failed: ${err.message}`)
    } finally {
      if (tempMsg) await ctx.telegram.deleteMessage(ctx.chat.id, tempMsg.message_id).catch(() => {})
    }
  }

  // ─── File attachment handling ──────────────────────────────────────────────

  const pendingFile = sessionManager.getPendingFile(userId)
  let fileOpts = {}
  let pendingFileForCleanup = null

  if (pendingFile) {
    pendingFileForCleanup = pendingFile
    sessionManager.clearPendingFile(userId)

    if (pendingFile.fileType === 'text') {
      try {
        const ext = pendingFile.originalName.split('.').pop()?.toLowerCase()
        let content
        if (ext === 'doc' || ext === 'docx') {
          content = await fileManager.readWordFile(pendingFile.localPath, 50_000)
        } else if (ext === 'xls' || ext === 'xlsx') {
          content = fileManager.readExcelFile(pendingFile.localPath, 50_000)
        } else if (ext === 'ppt' || ext === 'pptx') {
          content = await fileManager.readPptxFile(pendingFile.localPath, 50_000)
        } else {
          content = fileManager.readTextFile(pendingFile.localPath, 50_000)
        }
        fileOpts = { fileContent: content, fileName: pendingFile.originalName }
      } catch (err) {
        logger.warn(`No se pudo leer el archivo ${pendingFile.originalName}: ${err.message}`)
        await ctx.reply(
          `⚠️ No pude leer *${pendingFile.originalName}*. Continúo sin él.`,
          { parse_mode: 'Markdown' }
        )
        fileManager.cleanupFile(pendingFile.localPath)
        pendingFileForCleanup = null
      }
    } else {
      // image or binary (PDF) — determine actual CLI backend
      const activeKey = agentKey || session.agent
      let actualCli = activeKey
      if (activeKey.startsWith('custom:')) {
        const def = customAgentManager.get(activeKey.slice(7))
        actualCli = def?.cli ?? 'claude'
      }
      if (actualCli !== 'claude') {
        await ctx.reply(
          '⚠️ Solo Claude puede procesar imágenes y PDFs.\n' +
          'Cambiá a Claude con /claude o usá un agente con motor Claude.'
        )
        fileManager.cleanupFile(pendingFile.localPath)
        return
      }
      fileOpts = { filePath: pendingFile.localPath, fileName: pendingFile.originalName }
    }
  }

  // T8: 3-phase timer system
  const controller = new AbortController()
  const { signal } = controller

  let statusMsg = null
  let vibePhaseTimer = null
  let vibeInterval = null
  let bgPhaseTimer = null
  let lastVibeIdx = -1

  // Streaming state
  let streamingText = ''
  let streamingStarted = false
  let lastStreamEdit = 0
  let streamEditScheduled = false
  const STREAM_EDIT_INTERVAL = 1500 // ms between Telegram edits

  const clearAllTimers = () => {
    clearTimeout(vibePhaseTimer)
    clearInterval(vibeInterval)
    clearTimeout(bgPhaseTimer)
  }

  try {
    const activeAgent = getAgentInfo(agentKey || session.agent)
    const statusText = session.voiceMode
      ? '🎙️ Generando respuesta...'
      : derivedAgentName
        ? `🧠 → *${derivedAgentName}* · Procesando...`
        : `${activeAgent.emoji} Procesando con *${activeAgent.name}*...`

    statusMsg = await ctx.reply(statusText, { parse_mode: 'Markdown' }).catch(() => null)

    // Set background task immediately
    sessionManager.setBackgroundTask(userId, {
      agentKey: agentKey || session.agent,
      statusMsgId: statusMsg?.message_id,
      transitionMsgId: null,
      cancel: () => controller.abort(),
      startTime: Date.now(),
      originalPrompt: prompt,
    })

    // Phase 2 (60s): Start rotating vibe phrases every 15s
    vibePhaseTimer = setTimeout(() => {
      const showVibe = async () => {
        if (streamingStarted) return
        const phrase = randomVibe(lastVibeIdx)
        lastVibeIdx = VIBE_PHRASES.indexOf(phrase)
        if (statusMsg) {
          await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, undefined,
            `${activeAgent.emoji} ${phrase}`,
            { parse_mode: 'Markdown' }
          ).catch(() => {})
        }
      }
      showVibe()
      vibeInterval = setInterval(showVibe, 15_000)

      // Phase 3 (120s total): Send transition message and mark bg mode active
      bgPhaseTimer = setTimeout(async () => {
        clearInterval(vibeInterval)
        vibeInterval = null

        const bg = sessionManager.getBackgroundTask(userId)
        if (!bg) return

        let transitionMsg = null
        try {
          transitionMsg = await ctx.reply(
            `${activeAgent.emoji} *${activeAgent.name}* sigue trabajando en tu tarea. Mientras tanto, podés seguir hablando conmigo.`,
            { parse_mode: 'Markdown' }
          )
        } catch {}

        if (transitionMsg) bg.transitionMsgId = transitionMsg.message_id
      }, 60_000)
    }, 60_000)

    // Streaming callback: throttle edits to avoid Telegram rate limits
    const scheduleStreamEdit = () => {
      if (streamEditScheduled) return
      const delay = Math.max(0, STREAM_EDIT_INTERVAL - (Date.now() - lastStreamEdit))
      streamEditScheduled = true
      setTimeout(async () => {
        streamEditScheduled = false
        lastStreamEdit = Date.now()
        if (statusMsg) {
          const preview = streamingText.length > 3800
            ? '...' + streamingText.slice(-3800)
            : streamingText
          await ctx.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, undefined, preview
          ).catch(() => {})
        }
      }, delay)
    }

    const onStreamChunk = (chunk) => {
      streamingText += chunk
      if (!streamingStarted) streamingStarted = true
      // In voiceMode, don't stream text to Telegram — wait for full response
      if (!session.voiceMode) scheduleStreamEdit()
    }

    const response = await dispatchStreaming(agentKey, prompt, session, signal, onStreamChunk, fileOpts)
    clearAllTimers()

    const effectiveAgent = agentKey || session.agent
    sessionManager.addToHistory(userId, 'user', prompt, effectiveAgent)
    sessionManager.addToHistory(userId, 'assistant', response, effectiveAgent)

    // If a custom agent was invoked (via @mention or autoMode), make it the active
    // session agent so the conversation continues with it by default.
    if (agentKey?.startsWith('custom:') && agentKey !== session.agent) {
      sessionManager.setAgent(userId, agentKey)
    }

    // Prefix with agent attribution when a custom agent or explicit mention is used,
    // so the user knows which agent answered.
    const activeKey = agentKey || session.agent
    const agentPrefix = activeKey.startsWith('custom:') || agentKey
      ? `${activeAgent.emoji} *${activeAgent.name}*:\n`
      : ''

    // Save last response for TTS callbacks (always, regardless of mode)
    sessionManager.setLastResponse(userId, response)

    logger.info(`[TTS] post-response: voiceMode=${session.voiceMode} ttsButton=${session.ttsButton} for user ${userId}`)

    // ── voiceMode: send audio only, no text ──────────────────────────────────
    if (session.voiceMode) {
      logger.info(`[TTS] voiceMode branch triggered for user ${userId}`)
      const finalMsgId = statusMsg?.message_id
      statusMsg = null
      if (finalMsgId) await ctx.telegram.deleteMessage(ctx.chat.id, finalMsgId).catch(() => {})
      sessionManager.clearBackgroundTask(userId)
      try {
        await sendTtsAudio(ctx, response, getEffectiveVoice(userId))
      } catch (ttsErr) {
        logger.error(`TTS voiceMode failed for user ${userId}: ${ttsErr.message}`)
        await ctx.reply('⚠️ TTS falló, mostrando texto:').catch(() => {})
        const chunks = splitMessage(response, MAX_RESPONSE_LENGTH)
        for (const chunk of chunks) await sendWithFallback(ctx, chunk)
      }
      return
    }

    // ── Normal text delivery ─────────────────────────────────────────────────
    let lastSentMsgId = null
    const bg = sessionManager.getBackgroundTask(userId)
    if (bg?.transitionMsgId) {
      const prefix = `✅ *${activeAgent.name}* terminó:\n\n`
      const chunks = splitMessage(prefix + response, MAX_RESPONSE_LENGTH)
      for (const chunk of chunks) {
        const sent = await sendWithFallback(ctx, chunk)
        if (sent?.message_id) lastSentMsgId = sent.message_id
      }
      await ctx.telegram.deleteMessage(ctx.chat.id, bg.transitionMsgId).catch(() => {})
    } else {
      const finalResponse = agentPrefix + response
      const chunks = splitMessage(finalResponse, MAX_RESPONSE_LENGTH)

      // Null statusMsg BEFORE the first await so any pending stream edit timer
      // sees null and won't overwrite our final edit.
      const finalMsgId = statusMsg?.message_id
      statusMsg = null

      if (finalMsgId) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, finalMsgId, undefined,
          chunks[0], { parse_mode: 'Markdown' }
        ).catch(async () => {
          await ctx.telegram.editMessageText(
            ctx.chat.id, finalMsgId, undefined, chunks[0]
          ).catch(() => {})
        })
        lastSentMsgId = finalMsgId
      } else {
        const sent = await sendWithFallback(ctx, chunks[0])
        if (sent?.message_id) lastSentMsgId = sent.message_id
      }

      for (let i = 1; i < chunks.length; i++) {
        const sent = await sendWithFallback(ctx, chunks[i])
        if (sent?.message_id) lastSentMsgId = sent.message_id
      }
    }
    sessionManager.clearBackgroundTask(userId)

    // ── TTS button (if enabled by user) ─────────────────────────────────────
    logger.info(`[TTS] ttsButton=${session.ttsButton} for user ${userId}`)
    if (session.ttsButton) {
      logger.info(`[TTS] sending tts_last button for user ${userId}`)
      const ttsKeyboard = { inline_keyboard: [[{ text: '🔊 Escuchar', callback_data: 'tts_last' }]] }
      try {
        if (lastSentMsgId) {
          await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, lastSentMsgId, undefined, ttsKeyboard)
        } else {
          await ctx.reply('🔊 Escuchar', { reply_markup: ttsKeyboard })
        }
        logger.info(`[TTS] tts_last button sent OK for user ${userId}`)
      } catch (btnErr) {
        logger.error(`[TTS] tts_last button FAILED for user ${userId}: ${btnErr.message}`)
      }
    }
  } catch (err) {
    clearAllTimers()

    const bgOnError = sessionManager.getBackgroundTask(userId)
    if (bgOnError?.transitionMsgId) {
      await ctx.telegram.deleteMessage(ctx.chat.id, bgOnError.transitionMsgId).catch(() => {})
    }
    if (bgOnError) sessionManager.clearBackgroundTask(userId)

    if (err.cancelled) return

    logger.error(`Task failed for user ${userId}: ${err.message}`)
    const agentName = getAgentInfo(agentKey || session.agent)?.name ?? 'Agente'
    const shortMsg = (err.message ?? 'Error desconocido').split('\n')[0].slice(0, 200)
    try {
      await ctx.reply(`❌ *${agentName}* falló:\n${shortMsg}`, { parse_mode: 'Markdown' })
    } catch {
      await ctx.reply(`❌ ${agentName} falló: ${shortMsg}`)
    }
  } finally {
    clearAllTimers()
    if (statusMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
    }
    if (pendingFileForCleanup?.localPath) {
      fileManager.cleanupFile(pendingFileForCleanup.localPath)
    }
  }
}

// ─── Photo / document handlers ────────────────────────────────────────────────

async function handlePhoto(ctx) {
  const userId = ctx.from?.id
  if (!userId) return

  const photo = ctx.message.photo?.at(-1)
  if (!photo) return

  if (photo.file_size && photo.file_size > fileManager.getMaxFileSizeBytes()) {
    return ctx.reply(
      `⚠️ La imagen supera el límite de ${process.env.MAX_FILE_SIZE_MB || 20} MB.`
    )
  }

  // Clean up previous pending file if any
  const existing = sessionManager.getPendingFile(userId)
  if (existing?.localPath) fileManager.cleanupFile(existing.localPath)

  await ctx.sendChatAction('upload_photo').catch(() => {})

  let downloadResult
  try {
    downloadResult = await fileManager.downloadTelegramFile(
      ctx.telegram, photo.file_id, userId, 'photo.jpg'
    )
  } catch (err) {
    logger.error(`Error descargando foto para user ${userId}: ${err.message}`)
    return ctx.reply('❌ No pude descargar la imagen. Intentá de nuevo.')
  }

  sessionManager.setPendingFile(userId, {
    localPath: downloadResult.localPath,
    originalName: 'photo.jpg',
    fileType: 'image',
    size: downloadResult.size,
    savedAt: new Date().toISOString(),
  })

  const caption = ctx.message.caption?.trim()
  if (caption) return handleTask(ctx, caption)
  await ctx.reply('📎 Imagen recibida. ¿Qué querés que haga con ella?')
}

async function handleDocument(ctx) {
  const userId = ctx.from?.id
  if (!userId) return

  const doc = ctx.message.document
  if (!doc) return

  const validation = fileManager.validateFile(doc.mime_type, doc.file_name ?? '')
  if (!validation.ok) {
    return ctx.reply(
      `⚠️ ${validation.reason}\n\n` +
      `Formatos soportados: imágenes (jpg, png, webp, gif), PDF, y archivos de texto/código ` +
      `(py, js, ts, json, csv, yaml, md, txt, etc.)`
    )
  }

  if (doc.file_size && doc.file_size > fileManager.getMaxFileSizeBytes()) {
    return ctx.reply(
      `⚠️ El archivo supera el límite de ${process.env.MAX_FILE_SIZE_MB || 20} MB.`
    )
  }

  // Clean up previous pending file if any
  const existing = sessionManager.getPendingFile(userId)
  if (existing?.localPath) fileManager.cleanupFile(existing.localPath)

  await ctx.sendChatAction('upload_document').catch(() => {})

  let downloadResult
  try {
    downloadResult = await fileManager.downloadTelegramFile(
      ctx.telegram, doc.file_id, userId, doc.file_name ?? 'archivo'
    )
  } catch (err) {
    logger.error(`Error descargando documento para user ${userId}: ${err.message}`)
    return ctx.reply('❌ No pude descargar el archivo. Intentá de nuevo.')
  }

  sessionManager.setPendingFile(userId, {
    localPath: downloadResult.localPath,
    originalName: doc.file_name ?? 'archivo',
    fileType: validation.fileType,
    size: downloadResult.size,
    savedAt: new Date().toISOString(),
  })

  const emoji = fileManager.fileEmoji(doc.file_name ?? '')
  const sizeStr = fileManager.formatSize(downloadResult.size)

  const caption = ctx.message.caption?.trim()
  if (caption) return handleTask(ctx, caption)
  await ctx.reply(
    `${emoji} Recibí *${doc.file_name}* (${sizeStr}). ¿Qué querés que haga con él?`,
    { parse_mode: 'Markdown' }
  )
}

// ─── Voice / audio handler ────────────────────────────────────────────────────

async function handleVoice(ctx) {
  const userId = ctx.from.id
  const session = sessionManager.getOrCreate(userId)
  const voiceOrAudio = ctx.message.voice || ctx.message.audio
  if (!voiceOrAudio) return

  // Early size check (avoids download if Telegram already sent file_size)
  const maxMb = parseFloat(process.env.MAX_AUDIO_SIZE_MB) || 25
  if (voiceOrAudio.file_size && voiceOrAudio.file_size > maxMb * 1024 * 1024) {
    await ctx.reply(`⚠️ El audio supera el límite de ${maxMb} MB. Enviá un audio más corto.`)
    return
  }

  let statusMsg = null
  let heartbeatInterval = null

  try {
    statusMsg = await ctx.reply('🎙️ Transcribiendo...')

    const startTime = Date.now()
    heartbeatInterval = setInterval(async () => {
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      if (statusMsg) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, statusMsg.message_id, undefined,
          `🎙️ Transcribiendo... (${elapsed}s)`
        ).catch(() => {})
      }
    }, 10_000)

    const transcript = await transcribe(ctx.telegram, voiceOrAudio.file_id)
    clearInterval(heartbeatInterval)
    heartbeatInterval = null

    // Delete the status message — transcript passes internally, not shown to user
    if (statusMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
      statusMsg = null
    }

    const response = await dispatch(null, transcript, session)
    sessionManager.addToHistory(userId, 'user', transcript)
    sessionManager.addToHistory(userId, 'assistant', response)
    sessionManager.setLastResponse(userId, response)

    if (session.voiceMode) {
      try {
        await sendTtsAudio(ctx, response, getEffectiveVoice(userId))
      } catch (ttsErr) {
        logger.error(`TTS voiceMode (voice handler) failed for user ${userId}: ${ttsErr.message}`)
        await ctx.reply('⚠️ TTS falló, mostrando texto:').catch(() => {})
        const chunks = splitMessage(response, MAX_RESPONSE_LENGTH)
        for (const chunk of chunks) await sendWithFallback(ctx, chunk)
      }
    } else {
      const chunks = splitMessage(response, MAX_RESPONSE_LENGTH)
      let lastSentMsgId = null
      for (const chunk of chunks) {
        const sent = await sendWithFallback(ctx, chunk)
        if (sent?.message_id) lastSentMsgId = sent.message_id
      }
      // TTS button: attach inline keyboard to last message
      if (session.ttsButton && lastSentMsgId) {
        const ttsKeyboard = { inline_keyboard: [[{ text: '🔊 Escuchar', callback_data: 'tts_last' }]] }
        await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, lastSentMsgId, undefined, ttsKeyboard).catch(() => {})
      }
    }
  } catch (err) {
    clearInterval(heartbeatInterval)
    logger.error(`Audio transcription failed for user ${userId}: ${err.message}`)

    let msg = '❌ Error al transcribir el audio.'
    if (err.isEnoent) {
      msg = '⚠️ El motor de transcripción no está instalado. Pedile al operador que instale mlx-whisper.'
    } else if (err.isSizeLimit) {
      msg = err.message
    } else if (err.isEmpty) {
      msg = '⚠️ No se pudo transcribir el audio. Verificá que haya voz clara en el mensaje.'
    }

    await ctx.reply(msg)

    if (statusMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
    }
  }
}

// ─── Ping / health-check ───────────────────────────────────────────────────────

async function handlePing(ctx, agentKeyArg) {
  const { AGENTS, dispatch } = require('../agents/router')

  // Special case: /ping whisper
  if (agentKeyArg === 'whisper') {
    const { found, latencyMs } = await checkWhisper()
    const status = found
      ? `✅ mlx_whisper encontrado (latencia: ${latencyMs}ms)`
      : `❌ mlx_whisper no encontrado — instalá con: \`pip install mlx-whisper\``
    await ctx.reply(`🎙️ *Whisper status:*\n${status}`, { parse_mode: 'Markdown' })
    return
  }

  const targets = agentKeyArg
    ? [agentKeyArg].filter((k) => AGENTS[k])
    : Object.keys(AGENTS)

  if (targets.length === 0) {
    await ctx.reply(`❌ Agente desconocido: "${agentKeyArg}"`)
    return
  }

  const lines = []
  for (const key of targets) {
    const agent = AGENTS[key]
    const found = global.__cliStatus?.[key]?.found ?? false

    if (!found) {
      lines.push(`${agent.emoji} *${agent.name}*: ❌ CLI no encontrado`)
      continue
    }

    const session = { agent: key, history: [], userId: ctx.from.id }
    const start = Date.now()
    try {
      const reply = await dispatch(key, 'responde únicamente con la palabra OK', session)
      const ms = Date.now() - start
      lines.push(`${agent.emoji} *${agent.name}*: ✅ OK (${ms}ms)\n  \`${reply.slice(0, 100).trim()}\``)
    } catch (err) {
      const ms = Date.now() - start
      lines.push(`${agent.emoji} *${agent.name}*: ❌ ${err.message.slice(0, 80)} (${ms}ms)`)
    }
  }

  // TTS status
  const ttsStatus = global.__ttsEngine
  const ttsVoice = process.env.TTS_VOICE || 'es-AR-TomasNeural'
  if (ttsStatus === 'edge-tts') {
    lines.push(`🔊 *TTS*: edge-tts ✅ (${ttsVoice})`)
  } else if (ttsStatus === 'say') {
    const { getSayVoice } = require('../utils/ttsService')
    lines.push(`🔊 *TTS*: say ✅ fallback (${getSayVoice()})`)
  } else {
    lines.push(`🔊 *TTS*: ❌ no disponible`)
  }

  await ctx.reply(lines.join('\n\n'), { parse_mode: 'Markdown' })
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text]

  const chunks = []
  let remaining = text

  while (remaining.length > maxLength) {
    let cutAt = remaining.lastIndexOf('\n', maxLength)
    if (cutAt < maxLength * 0.5) cutAt = maxLength
    chunks.push(remaining.slice(0, cutAt))
    remaining = remaining.slice(cutAt).trimStart()
  }

  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

async function sendWithFallback(ctx, text) {
  try {
    return await ctx.reply(text, { parse_mode: 'Markdown' })
  } catch {
    return await ctx.reply(text)
  }
}

// ─── Teams ────────────────────────────────────────────────────────────────────

async function handleBuildTeam(ctx) {
  await buildTeamWizard.startWizard(ctx)
}

// ─── Teams list helpers ────────────────────────────────────────────────────────

function buildTeamsMessage(teams) {
  const lines = teams.map(t => {
    const workers = t.workers.join(', ')
    const reviewer = t.reviewer ? `✅ *Reviewer:* \`${escapeMd(t.reviewer)}\`` : ''
    return (
      `*${escapeMd(t.name)}* — \`${t.id}\`\n` +
      `_${escapeMd(t.description)}_\n` +
      `🎯 Coordinator: \`${escapeMd(t.coordinator)}\`\n` +
      `👷 Workers: \`${escapeMd(workers)}\`\n` +
      (reviewer ? reviewer + '\n' : '') +
      `🔁 Review: ${t.reviewMode} | ⏱ Heartbeat: ${t.heartbeatIntervalMin}min`
    )
  })
  return `👥 *Equipos (${teams.length})*\n\n${lines.join('\n\n')}`
}

function buildTeamsKeyboard(teams) {
  const keyboard = []
  for (const t of teams) {
    keyboard.push([
      { text: '📋 Detalle', callback_data: `team_detail:${t.id}` },
      { text: '✏️ Editar',  callback_data: `team_edit_btn:${t.id}` },
      { text: '🗑 Borrar',  callback_data: `team_delete_btn:${t.id}` },
    ])
  }
  keyboard.push([{ text: '➕ Nuevo equipo', callback_data: 'team_new' }])
  return { inline_keyboard: keyboard }
}

async function handleListTeams(ctx) {
  const teams = teamManager.list()
  if (teams.length === 0) {
    return ctx.reply('No hay equipos creados todavía. Usá /buildteam para crear uno.')
  }
  const text = buildTeamsMessage(teams)
  const keyboard = buildTeamsKeyboard(teams)
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard })
}

// ─── Teams inline callback handlers ───────────────────────────────────────────

async function handleTeamDetailBtn(ctx, teamId) {
  const team = teamManager.get(teamId)
  if (!team) {
    await ctx.answerCbQuery('❌ Equipo no encontrado', { show_alert: true }).catch(() => {})
    return
  }
  const activeTasks = taskManager.listByTeam(teamId).filter(t =>
    ['pending','assigned','in_progress','in_review','awaiting_user_review','changes_requested'].includes(t.status)
  )
  const workers = team.workers.join(', ')
  const reviewer = team.reviewer ? `✅ Reviewer: \`${escapeMd(team.reviewer)}\`\n` : ''
  let text =
    `📋 *${escapeMd(team.name)}* — \`${team.id}\`\n` +
    `_${escapeMd(team.description)}_\n\n` +
    `🎯 Coordinator: \`${escapeMd(team.coordinator)}\`\n` +
    `👷 Workers: \`${escapeMd(workers)}\`\n` +
    reviewer +
    `🔁 Review: ${team.reviewMode}\n` +
    `⏱ Heartbeat: ${team.heartbeatIntervalMin}min\n` +
    `🔢 Máx iteraciones: ${team.maxIterations ?? 5}`
  if (activeTasks.length > 0) {
    text += `\n\n*Tareas activas (${activeTasks.length}):*\n`
    text += activeTasks.map(t => `  ${taskManager.statusEmoji(t.status)} \`#${t.id}\` _${escapeMd(t.title.slice(0,40))}_`).join('\n')
  }
  await ctx.reply(text, { parse_mode: 'Markdown' })
  await ctx.answerCbQuery().catch(() => {})
}

async function handleTeamEditBtn(ctx, teamId) {
  const team = teamManager.get(teamId)
  if (!team) {
    await ctx.answerCbQuery('❌ Equipo no encontrado', { show_alert: true }).catch(() => {})
    return
  }
  await ctx.reply(
    `✏️ *${escapeMd(team.name)}* — ¿Qué querés editar?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔁 Modo de review',      callback_data: `team_edit_reviewmode:${teamId}` }],
          [{ text: '⏱ Intervalo heartbeat',  callback_data: `team_edit_heartbeat:${teamId}` }],
          [{ text: '🔢 Máx. iteraciones',    callback_data: `team_edit_maxiter:${teamId}` }],
          [{ text: '❌ Cancelar',             callback_data: 'action_cancel' }],
        ],
      },
    }
  )
  await ctx.answerCbQuery().catch(() => {})
}

async function handleTeamDeleteBtn(ctx, teamId) {
  const team = teamManager.get(teamId)
  if (!team) {
    await ctx.answerCbQuery('❌ Equipo no encontrado', { show_alert: true }).catch(() => {})
    return
  }
  await ctx.editMessageText(
    `⚠️ ¿Eliminar el equipo *${escapeMd(team.name)}*?\n_Esta acción no elimina los sub-agentes._`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Sí, borrar', callback_data: `team_delete_confirm:${teamId}` },
          { text: '❌ Cancelar',   callback_data: 'team_list_refresh' },
        ]],
      },
    }
  ).catch(() => {})
  await ctx.answerCbQuery().catch(() => {})
}

async function handleTeamDeleteConfirmBtn(ctx, teamId) {
  try {
    teamManager.remove(teamId, taskManager)
    const teams = teamManager.list()
    if (teams.length === 0) {
      await ctx.editMessageText('✅ Equipo eliminado. No hay más equipos.').catch(() => {})
    } else {
      const text = buildTeamsMessage(teams)
      const keyboard = buildTeamsKeyboard(teams)
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {})
    }
    await ctx.answerCbQuery('🗑 Equipo eliminado').catch(() => {})
  } catch (err) {
    await ctx.editMessageText(`❌ ${err.message}`).catch(() => {})
    await ctx.answerCbQuery('❌ Error', { show_alert: true }).catch(() => {})
  }
}

async function handleTeamListRefresh(ctx) {
  const teams = teamManager.list()
  if (teams.length === 0) {
    await ctx.editMessageText('No hay equipos creados todavía. Usá /buildteam para crear uno.').catch(() => {})
  } else {
    const text = buildTeamsMessage(teams)
    const keyboard = buildTeamsKeyboard(teams)
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {})
  }
  await ctx.answerCbQuery().catch(() => {})
}

async function handleTeamNewBtn(ctx) {
  await ctx.answerCbQuery().catch(() => {})
  await ctx.reply('Usá /buildteam para crear un nuevo equipo.')
}

async function handleDelTeam(ctx) {
  const id = ctx.message.text.split(/\s+/)[1]?.trim()
  if (!id) return ctx.reply('Uso: /delteam <team-id>')
  const team = teamManager.get(id)
  if (!team) return ctx.reply(`❌ Team \`${id}\` no encontrado.`, { parse_mode: 'Markdown' })

  await ctx.reply(
    `¿Eliminar el equipo *${team.name}*?\n_Esta acción no elimina los sub-agentes._`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Confirmar', callback_data: `team_delteam_confirm:${id}` },
          { text: '❌ Cancelar',  callback_data: 'team_delteam_cancel' },
        ]],
      },
    }
  )
}

async function handleEditTeam(ctx) {
  const id = ctx.message.text.split(/\s+/)[1]?.trim()
  if (!id) return ctx.reply('Uso: /editteam <team-id>')
  const team = teamManager.get(id)
  if (!team) return ctx.reply(`❌ Team \`${id}\` no encontrado.`, { parse_mode: 'Markdown' })

  await ctx.reply(
    `✏️ *${team.name}* — ¿Qué querés editar?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔁 Modo de review', callback_data: `team_edit_reviewmode:${id}` }],
          [{ text: '⏱ Intervalo heartbeat', callback_data: `team_edit_heartbeat:${id}` }],
          [{ text: '🔢 Máx. iteraciones', callback_data: `team_edit_maxiter:${id}` }],
          [{ text: '❌ Cancelar', callback_data: 'team_delteam_cancel' }],
        ],
      },
    }
  )
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

async function handleCreateTask(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/)
  // /task <team-id> <description...>
  const teamId = parts[1]
  if (!teamId) return ctx.reply('Uso: /task <team-id> <descripción de la tarea>')

  const team = teamManager.get(teamId)
  if (!team) return ctx.reply(`❌ Team \`${teamId}\` no encontrado. Usá /teams para ver los equipos disponibles.`, { parse_mode: 'Markdown' })

  const description = parts.slice(2).join(' ').trim()
  if (!description) return ctx.reply('Describí la tarea después del team-id.\nEj: `/task marketing-team "redactar email de bienvenida"`', { parse_mode: 'Markdown' })

  const userId = String(ctx.from.id)
  const chatId = ctx.chat.id
  const task = taskManager.create(teamId, description, userId, chatId)

  await ctx.reply(
    `✅ *Tarea #${task.id} creada* para el equipo *${team.name}*\n_${task.title}_\n\nIniciando flujo...`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📋 Ver estado',  callback_data: `team_task_detail:${task.id}` },
            { text: '❌ Cancelar',    callback_data: `team_task_cancel:${task.id}` },
          ],
          [
            { text: '👁 Ver diálogo interno', callback_data: `team_liveview_on:${task.id}` },
          ],
        ],
      },
    }
  )

  // Start heartbeat if configured
  if (team.heartbeatIntervalMin > 0) {
    heartbeatManager.start(task.id, chatId, teamId, team.heartbeatIntervalMin, ctx.telegram)
  }

  // Fire and forget
  teamWorkflow.runTask(task.id, ctx.telegram).catch(err => {
    logger.error(`handleCreateTask: unhandled workflow error for task ${task.id}: ${err.message}`)
  })
}

// ─── Tasks list helpers ────────────────────────────────────────────────────────

const TASKS_PAGE_SIZE = 10
const ACTIVE_STATUSES = ['pending','assigned','in_progress','in_review','awaiting_user_review','changes_requested']

function buildTasksMessage(tasks, showAll, teamId, page) {
  const groups = {
    active:  tasks.filter(t => ACTIVE_STATUSES.includes(t.status)),
    done:    tasks.filter(t => t.status === 'done'),
    failed:  tasks.filter(t => ['failed','interrupted','cancelled'].includes(t.status)),
  }

  function formatTask(t) {
    const elapsed = taskManager.elapsedMinutes(t)
    const time = elapsed > 0 ? ` ⏱ ${elapsed}min` : ''
    const teamLabel = !teamId ? ` _[${escapeMd(teamManager.get(t.teamId)?.name ?? t.teamId)}]_` : ''
    return `${taskManager.statusEmoji(t.status)} \`#${t.id}\`${teamLabel} ${escapeMd(t.title)}${time}`
  }

  let text = teamId
    ? `📋 *Tareas — ${escapeMd(teamManager.get(teamId)?.name ?? teamId)}*`
    : showAll ? `📋 *Todas las tareas*` : `📋 *Tareas activas*`

  if (page > 1) text += ` _(página ${page})_`

  if (groups.active.length)  text += `\n\n*En curso:*\n` + groups.active.map(formatTask).join('\n')
  if (groups.done.length)    text += `\n\n*Completadas:*\n` + groups.done.map(formatTask).join('\n')
  if (groups.failed.length)  text += `\n\n*Fallidas / canceladas:*\n` + groups.failed.map(formatTask).join('\n')

  return text
}

function buildTasksKeyboard(tasks, showAll, page, totalTasks) {
  const keyboard = []

  // Per-task buttons
  for (const t of tasks) {
    const isActive = ACTIVE_STATUSES.includes(t.status)
    const row = [{ text: `🔍 #${t.id}`, callback_data: `task_detail:${t.id}` }]
    if (isActive) row.push({ text: '❌ Cancelar', callback_data: `task_cancel:${t.id}` })
    keyboard.push(row)
  }

  // History and pagination row
  const bottomRow = []
  if (!showAll) bottomRow.push({ text: '📚 Ver historial completo', callback_data: 'tasks_history' })
  keyboard.push(bottomRow)

  // Pagination
  const totalPages = Math.ceil(totalTasks / TASKS_PAGE_SIZE)
  if (totalPages > 1) {
    const navRow = []
    if (page > 1) navRow.push({ text: '← Anterior', callback_data: `tasks_page:${page - 1}` })
    if (page < totalPages) navRow.push({ text: 'Siguiente →', callback_data: `tasks_page:${page + 1}` })
    if (navRow.length > 0) keyboard.push(navRow)
  }

  return { inline_keyboard: keyboard }
}

async function handleListTasks(ctx) {
  const parts = (ctx.message?.text ?? '').trim().split(/\s+/)
  const arg = parts[1] ?? null
  const showAll = arg === 'all' || arg === 'todas'
  const teamId = (!showAll && arg) ? arg : null
  const page = 1

  let allTasks
  if (teamId) {
    const team = teamManager.get(teamId)
    if (!team) return ctx.reply(`❌ Team \`${teamId}\` no encontrado.`, { parse_mode: 'Markdown' })
    allTasks = taskManager.listAll(teamId)
  } else if (showAll) {
    allTasks = taskManager.listAll()
  } else {
    allTasks = [...taskManager.listActive(), ...taskManager.listCompletedToday()]
      .filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)
  }

  if (allTasks.length === 0) {
    return ctx.reply(
      teamId ? `No hay tareas para el equipo \`${teamId}\`.` : 'No hay tareas registradas.',
      { parse_mode: 'Markdown' }
    )
  }

  const tasks = allTasks.slice(0, TASKS_PAGE_SIZE)
  const text = buildTasksMessage(tasks, showAll, teamId, page)
  const keyboard = buildTasksKeyboard(tasks, showAll, page, allTasks.length)

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard })
}

// ─── Task inline callback handlers ────────────────────────────────────────────

async function handleTaskDetail(ctx, taskId) {
  const task = taskManager.get(taskId.toUpperCase())
  if (!task) {
    await ctx.answerCbQuery('❌ Tarea no encontrada', { show_alert: true }).catch(() => {})
    return
  }
  const team = teamManager.get(task.teamId)
  const teamName = team?.name ?? task.teamId
  const elapsed = taskManager.elapsedMinutes(task)
  const historyLines = task.history.slice(-8).map(h => {
    const ts = new Date(h.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    return `  ${ts} — ${escapeMd(h.event)}${h.note ? ` (${escapeMd(h.note.slice(0, 60))})` : ''}`
  })
  let text =
    `${taskManager.statusEmoji(task.status)} *Tarea #${task.id}*\n` +
    `_${escapeMd(task.title)}_\n\n` +
    `🏢 Equipo: ${escapeMd(teamName)}\n` +
    `📊 Estado: ${task.status}\n` +
    (task.assignedTo ? `👷 Worker: \`${escapeMd(task.assignedTo)}\`\n` : '') +
    (elapsed > 0 ? `⏱ Tiempo: ${elapsed} min\n` : '') +
    `🔄 Iteraciones: ${task.iterations}\n\n` +
    `📜 *Historial:*\n${historyLines.join('\n')}`
  if (task.output) {
    const preview = task.output.slice(0, 600)
    text += `\n\n📄 *Output:*\n${escapeMd(preview)}${task.output.length > 600 ? '\n_(truncado...)_' : ''}`
  }
  await ctx.reply(text, { parse_mode: 'Markdown' })
  await ctx.answerCbQuery().catch(() => {})
}

async function handleTaskCancelPrompt(ctx, taskId) {
  const task = taskManager.get(taskId.toUpperCase())
  if (!task) {
    await ctx.answerCbQuery('❌ Tarea no encontrada', { show_alert: true }).catch(() => {})
    return
  }
  if (!ACTIVE_STATUSES.includes(task.status)) {
    await ctx.answerCbQuery('La tarea ya no está activa', { show_alert: true }).catch(() => {})
    return
  }
  await ctx.reply(
    `⚠️ ¿Cancelar la tarea *#${task.id}* — _${escapeMd(task.title)}_?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Sí, cancelar', callback_data: `task_cancel_confirm:${task.id}` },
          { text: '❌ No',           callback_data: 'action_cancel' },
        ]],
      },
    }
  )
  await ctx.answerCbQuery().catch(() => {})
}

async function handleTaskCancelConfirm(ctx, taskId) {
  try {
    taskManager.cancel(taskId.toUpperCase(), String(ctx.from.id))
    teamWorkflow.cancelRunning(taskId.toUpperCase())
    heartbeatManager.stop(taskId.toUpperCase())
    await ctx.editMessageText(`✅ Tarea *#${taskId.toUpperCase()}* cancelada.`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {})
    await ctx.answerCbQuery('✅ Cancelada').catch(() => {})
  } catch (err) {
    await ctx.editMessageText(`❌ ${err.message}`).catch(() => {})
    await ctx.answerCbQuery('❌ Error', { show_alert: true }).catch(() => {})
  }
}

async function handleTasksHistory(ctx) {
  const allTasks = taskManager.listAll()
  if (allTasks.length === 0) {
    await ctx.answerCbQuery('No hay tareas registradas').catch(() => {})
    return
  }
  const tasks = allTasks.slice(0, TASKS_PAGE_SIZE)
  const text = buildTasksMessage(tasks, true, null, 1)
  const keyboard = buildTasksKeyboard(tasks, true, 1, allTasks.length)
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard })
  await ctx.answerCbQuery().catch(() => {})
}

async function handleTasksPage(ctx, pageStr) {
  const page = Math.max(1, parseInt(pageStr) || 1)
  const allTasks = taskManager.listAll()
  if (allTasks.length === 0) {
    await ctx.answerCbQuery('No hay tareas').catch(() => {})
    return
  }
  const start = (page - 1) * TASKS_PAGE_SIZE
  const tasks = allTasks.slice(start, start + TASKS_PAGE_SIZE)
  if (tasks.length === 0) {
    await ctx.answerCbQuery('No hay más tareas').catch(() => {})
    return
  }
  const text = buildTasksMessage(tasks, true, null, page)
  const keyboard = buildTasksKeyboard(tasks, true, page, allTasks.length)
  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => {})
  await ctx.answerCbQuery().catch(() => {})
}

async function handleActionCancel(ctx) {
  await ctx.editMessageText('Operación cancelada.').catch(() => {})
  await ctx.answerCbQuery().catch(() => {})
}

async function handleTaskStatus(ctx) {
  const taskId = ctx.message.text.split(/\s+/)[1]?.toUpperCase()
  if (!taskId) return ctx.reply('Uso: /taskstatus <task-id>')

  const task = taskManager.get(taskId)
  if (!task) return ctx.reply(`❌ Tarea \`${taskId}\` no encontrada.`, { parse_mode: 'Markdown' })

  const team = teamManager.get(task.teamId)
  const teamName = team?.name ?? task.teamId
  const elapsed = taskManager.elapsedMinutes(task)

  const historyLines = task.history.slice(-8).map(h => {
    const ts = new Date(h.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    return `  ${ts} — ${h.event}${h.note ? ` (${h.note.slice(0, 60)})` : ''}`
  })

  let text =
    `${taskManager.statusEmoji(task.status)} *Tarea #${task.id}*\n` +
    `_${task.title}_\n\n` +
    `🏢 Equipo: ${teamName}\n` +
    `📊 Estado: ${task.status}\n` +
    (task.assignedTo ? `👷 Worker: \`${task.assignedTo}\`\n` : '') +
    (elapsed > 0 ? `⏱ Tiempo: ${elapsed} min\n` : '') +
    `🔄 Iteraciones: ${task.iterations}\n\n` +
    `📜 *Historial:*\n${historyLines.join('\n')}`

  if (task.output) {
    const preview = task.output.slice(0, 600)
    text += `\n\n📄 *Output:*\n${preview}${task.output.length > 600 ? '\n_(truncado...)_' : ''}`
  }

  await ctx.reply(text, { parse_mode: 'Markdown' })
}

async function handleCancelTask(ctx) {
  const taskId = ctx.message.text.split(/\s+/)[1]?.toUpperCase()
  if (!taskId) return ctx.reply('Uso: /canceltask <task-id>')

  const task = taskManager.get(taskId)
  if (!task) return ctx.reply(`❌ Tarea \`${taskId}\` no encontrada.`, { parse_mode: 'Markdown' })

  try {
    taskManager.cancel(taskId, String(ctx.from.id))
    teamWorkflow.cancelRunning(taskId)
    heartbeatManager.stop(taskId)
    await ctx.reply(`✅ Tarea *#${taskId}* cancelada.`, { parse_mode: 'Markdown' })
  } catch (err) {
    await ctx.reply(`❌ ${err.message}`)
  }
}

async function handleTeamStatus(ctx) {
  const parts = ctx.message.text.trim().split(/\s+/)
  const teamId = parts[1] ?? null

  const teams = teamId ? [teamManager.get(teamId)].filter(Boolean) : teamManager.list()
  if (teams.length === 0) {
    return ctx.reply(teamId ? `❌ Team \`${teamId}\` no encontrado.` : 'No hay equipos creados todavía.', { parse_mode: 'Markdown' })
  }

  const sections = []
  for (const team of teams) {
    const active    = taskManager.listByTeam(team.id).filter(t => ['in_progress', 'in_review', 'awaiting_user_review', 'assigned'].includes(t.status))
    const pending   = taskManager.listByTeam(team.id).filter(t => t.status === 'pending')
    const doneToday = taskManager.listCompletedToday(team.id)

    let block = `📊 *${team.name}*\n`

    if (active.length > 0) {
      block += `\n🟡 *ACTIVAS (${active.length}):*\n`
      for (const t of active) {
        const elapsed = taskManager.elapsedMinutes(t)
        block += `  ${taskManager.statusEmoji(t.status)} \`#${t.id}\` _${t.title.slice(0, 40)}_\n`
        block += `     ${t.assignedTo ?? '—'} ⏱ ${elapsed}min\n`
      }
    }

    if (pending.length > 0) {
      block += `\n⏳ *EN COLA (${pending.length}):*\n`
      for (const t of pending) {
        block += `  ⏳ \`#${t.id}\` _${t.title.slice(0, 40)}_\n`
      }
    }

    if (active.length === 0 && pending.length === 0) {
      block += `\n_Sin tareas activas._`
    }

    if (doneToday.length > 0) {
      block += `\n✅ *COMPLETADAS HOY (${doneToday.length}):*\n`
      for (const t of doneToday.slice(0, 5)) {
        const elapsed = Math.round((new Date(t.completedAt) - new Date(t.startedAt ?? t.createdAt)) / 60000)
        block += `  ✅ \`#${t.id}\` _${t.title.slice(0, 40)}_ — ${elapsed}min\n`
      }
      if (doneToday.length > 5) block += `  _...y ${doneToday.length - 5} más_\n`
    }

    sections.push(block)
  }

  await ctx.reply(sections.join('\n─────────────────\n'), { parse_mode: 'Markdown' })
}

// ─── Team callback handlers (called from handleCallbackQuery) ─────────────────

async function handleTeamCallback(ctx, data) {
  // team_review_approve:<taskId>
  if (data.startsWith('team_review_approve:')) {
    const taskId = data.split(':')[1]
    await teamWorkflow.resumeAfterUserReview(taskId, 'approved', null, ctx.telegram)
    await ctx.answerCbQuery('✅ Aprobado')
    return true
  }

  // team_review_changes:<taskId>  — prompt for feedback text
  if (data.startsWith('team_review_changes:')) {
    const taskId = data.split(':')[1]
    sessionManager.getOrCreate(ctx.from.id).pendingReviewFeedback = taskId
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {})
    await ctx.reply(`🔄 Escribí el feedback para la tarea *#${taskId}*:`, { parse_mode: 'Markdown' })
    await ctx.answerCbQuery()
    return true
  }

  // team_task_detail:<taskId>
  if (data.startsWith('team_task_detail:')) {
    const taskId = data.split(':')[1].toUpperCase()
    const task = taskManager.get(taskId)
    if (!task) { await ctx.answerCbQuery('Tarea no encontrada'); return true }
    const raw = task.output ?? null
    if (!raw) {
      await ctx.reply(`📋 *#${taskId}* — sin output todavía.`, { parse_mode: 'Markdown' })
    } else {
      const preview = raw.slice(0, 3800) + (raw.length > 3800 ? '\n…' : '')
      await ctx.reply(`📋 *Output de #${taskId}*\n\n${escapeMd(preview)}`, { parse_mode: 'Markdown' })
    }
    await ctx.answerCbQuery()
    return true
  }

  // team_liveview_on:<taskId>
  if (data.startsWith('team_liveview_on:')) {
    const taskId = data.split(':')[1].toUpperCase()
    const task = taskManager.get(taskId)
    if (!task) { await ctx.answerCbQuery('Tarea no encontrada'); return true }
    taskManager.setLiveView(taskId, true)
    await ctx.answerCbQuery('👁 Diálogo activado')
    // If there are already entries in the log, show them
    const log = task.dialogLog ?? []
    if (log.length > 0) {
      const lines = log.map(e => {
        const icon = e.role === 'coordinator' ? '🧠' : e.role === 'reviewer' ? '🔍' : '👷'
        return `${icon} *${escapeMd(e.agentName)}*\n${escapeMd((e.body ?? '').slice(0, 300))}`
      }).join('\n\n')
      await ctx.reply(`🖥 *Diálogo #${taskId}* (hasta ahora)\n\n${lines}`, { parse_mode: 'Markdown' })
    } else {
      await ctx.reply(`👁 *Diálogo #${taskId}* activado — verás cada paso a medida que ocurra.`, { parse_mode: 'Markdown' })
    }
    return true
  }

  // team_task_cancel:<taskId>
  if (data.startsWith('team_task_cancel:')) {
    const taskId = data.split(':')[1].toUpperCase()
    try {
      taskManager.cancel(taskId, String(ctx.from.id))
      teamWorkflow.cancelRunning(taskId)
      heartbeatManager.stop(taskId)
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {})
      await ctx.reply(`✅ Tarea *#${taskId}* cancelada.`, { parse_mode: 'Markdown' })
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`)
    }
    await ctx.answerCbQuery()
    return true
  }

  // team_delteam_confirm:<id>
  if (data.startsWith('team_delteam_confirm:')) {
    const id = data.split(':')[1]
    try {
      teamManager.remove(id, taskManager)
      await ctx.editMessageText(`✅ Equipo \`${id}\` eliminado.`, { parse_mode: 'Markdown' })
    } catch (err) {
      await ctx.editMessageText(`❌ ${err.message}`)
    }
    await ctx.answerCbQuery()
    return true
  }

  // team_delteam_cancel
  if (data === 'team_delteam_cancel') {
    await ctx.editMessageText('Operación cancelada.').catch(() => {})
    await ctx.answerCbQuery()
    return true
  }

  // buildteam_domain:<domain>
  if (data.startsWith('buildteam_domain:')) {
    const domain = data.split(':')[1]
    await buildTeamWizard.handleDomainSelected(ctx, domain)
    await ctx.answerCbQuery()
    return true
  }

  // buildteam_confirm
  if (data === 'buildteam_confirm') {
    await buildTeamWizard.handleConfirm(ctx)
    await ctx.answerCbQuery()
    return true
  }

  // buildteam_retry
  if (data === 'buildteam_retry') {
    await buildTeamWizard.handleRetry(ctx)
    await ctx.answerCbQuery()
    return true
  }

  // buildteam_customize
  if (data === 'buildteam_customize') {
    await buildTeamWizard.handleCustomize(ctx)
    await ctx.answerCbQuery()
    return true
  }

  // autoroute_team:<teamId>
  if (data.startsWith('autoroute_team:')) {
    const teamId = data.split(':')[1]
    const team = teamManager.get(teamId)
    if (!team) { await ctx.answerCbQuery('Team no encontrado'); return true }
    const _autorouteSession = sessionManager.getOrCreate(ctx.from.id)
    const pendingPrompt = _autorouteSession.pendingAutoRoutePrompt
    if (!pendingPrompt) { await ctx.answerCbQuery(); return true }
    delete _autorouteSession.pendingAutoRoutePrompt
    delete _autorouteSession.pendingAutoRouteTeamId
    delete _autorouteSession.pendingAutoRouteAgentId

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {})
    const task = taskManager.create(teamId, pendingPrompt, String(ctx.from.id), ctx.chat.id)
    await ctx.reply(
      `✅ *Tarea #${task.id}* enviada al equipo *${team.name}*\n_${task.title}_`,
      { parse_mode: 'Markdown' }
    )
    if (team.heartbeatIntervalMin > 0) {
      heartbeatManager.start(task.id, ctx.chat.id, teamId, team.heartbeatIntervalMin, ctx.telegram)
    }
    teamWorkflow.runTask(task.id, ctx.telegram).catch(err =>
      logger.error(`autoroute_team workflow error: ${err.message}`)
    )
    await ctx.answerCbQuery()
    return true
  }

  return false
}

/**
 * Handle review feedback text from user (when pendingReviewFeedback is set in session).
 * Returns true if handled.
 */
async function handlePendingReviewFeedback(ctx) {
  const _reviewSession = sessionManager.getOrCreate(ctx.from.id)
  const taskId = _reviewSession.pendingReviewFeedback
  if (!taskId) return false
  delete _reviewSession.pendingReviewFeedback
  const comment = ctx.message?.text ?? ''
  await teamWorkflow.resumeAfterUserReview(taskId, 'changes_requested', comment, ctx.telegram)
  return true
}

module.exports = {
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
  handleTextIfActive: buildTeamWizard.handleTextIfActive,
}
