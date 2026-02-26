const { dispatch, resolveAgent, getAgentInfo, listAgents } = require('../agents/router')
const sessionManager = require('../utils/sessionManager')
const soulManager = require('../utils/soulManager')
const memoryManager = require('../utils/memoryManager')
const logger = require('../utils/logger')
const { transcribe, checkWhisper } = require('../utils/audioTranscriber')

const MAX_RESPONSE_LENGTH = parseInt(process.env.MAX_RESPONSE_LENGTH) || 4000

// Regex to detect "@agentAlias task" at the start of a message
const MENTION_RE = /^@(\w+)\s+([\s\S]+)$/

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
        `Listo, *${humanName}*! 🐙⚡ Ya sé quién sos. ¿En qué te ayudo?`,
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
    `/sesion — info de tu sesión\n` +
    `/limpiar — borrar historial\n` +
    `/soul — ver o configurar mi personalidad\n` +
    `/remember — guardar una memoria\n` +
    `/ayuda — instrucciones detalladas\n\n` +
    `💡 También podés mencionar un agente al inicio del mensaje:\n` +
    `\`@claude explicá este código\`\n` +
    `\`@gemini resumí este texto\`\n` +
    `\`@codex generá este script\``,
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
    `También funcionan los aliases: \`@cc\`, \`@gem\`, \`@g\`, \`@gpt\`, etc.\n\n` +
    `*Cambiar agente activo:*\n` +
    `/claude · /gemini · /codex\n\n` +
    `*Personalización:*\n` +
    `/soul — ver mi alma (personalidad y contexto)\n` +
    `/soul reset — reconfigurar desde cero\n` +
    `/reloadsoul — recargar SOUL.md sin reiniciar\n\n` +
    `*Memorias:*\n` +
    `/remember <texto> — guardar una memoria\n` +
    `/memories — listar memorias guardadas\n` +
    `/forget last|<id> — borrar una memoria\n\n` +
    `*Historial:*\n` +
    `Todos los agentes reciben las últimas 6 entradas como contexto.\n` +
    `/limpiar para borrar el historial.\n\n` +
    `*Límite de respuesta:* ${MAX_RESPONSE_LENGTH} caracteres por mensaje (se divide automáticamente).`,
    { parse_mode: 'Markdown' }
  )
}

async function handleListAgents(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  const agents = listAgents()

  const lines = agents.map((a) => {
    const active  = a.key === session.agent ? ' ← activo' : ''
    const cliOk   = global.__cliStatus?.[a.key]?.found !== false
    const badge   = cliOk ? '' : ' ⚠️ CLI no encontrado'
    return `${a.emoji} *${a.name}*${active}${badge}\n  /${a.key} — ${a.description}`
  })

  await ctx.reply(
    `🤖 *Agentes disponibles:*\n\n${lines.join('\n\n')}`,
    { parse_mode: 'Markdown' }
  )
}

async function handleSetAgent(ctx, agentKey) {
  const agent = getAgentInfo(agentKey)
  if (!agent) {
    await ctx.reply(`❌ Agente desconocido: "${agentKey}"`)
    return
  }
  sessionManager.setAgent(ctx.from.id, agentKey)
  await ctx.reply(`${agent.emoji} Agente cambiado a *${agent.name}*`, { parse_mode: 'Markdown' })
}

async function handleSession(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  const agent = getAgentInfo(session.agent)
  const inactiveMins = Math.round((Date.now() - session.lastActivity) / 60_000)

  await ctx.reply(
    `📋 *Tu sesión*\n\n` +
    `ID: \`${session.id.slice(0, 8)}...\`\n` +
    `${agent?.emoji ?? '🤖'} Agente: *${agent?.name ?? session.agent}*\n` +
    `💬 Mensajes en historial: ${session.history.length}\n` +
    `📊 Tareas totales: ${session.taskCount}\n` +
    `⏱ Última actividad: hace ${inactiveMins} min`,
    { parse_mode: 'Markdown' }
  )
}

async function handleClearHistory(ctx) {
  const userId = ctx.from.id
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
  sessionManager.clearHistory(userId)
  await ctx.reply('🗑 Historial borrado. La siguiente respuesta comenzará sin contexto previo.')
}

// ─── Soul handlers ─────────────────────────────────────────────────────────────

async function handleSoul(ctx) {
  const userId = ctx.from.id
  const parts = ctx.message.text.trim().split(/\s+/)
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
  await ctx.reply(`📄 *Mi alma actual:*\n\n\`\`\`\n${preview}\n\`\`\``, { parse_mode: 'Markdown' })
    .catch(() => ctx.reply(`📄 Mi alma actual:\n\n${preview}`))
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
  const parts = ctx.message.text.trim().split(/\s+/)
  const page = parseInt(parts[1]) || 1
  const memories = await memoryManager.list(page, 10)

  if (memories.length === 0) {
    await ctx.reply(page > 1 ? 'No hay más memorias.' : 'No tenés memorias guardadas.')
    return
  }

  const lines = memories.map((m, i) => {
    const idx = (page - 1) * 10 + i + 1
    const date = m.date ? m.date.slice(0, 10) : '?'
    return `${idx}. [${date}] ${m.preview}`
  })

  await ctx.reply(
    `🧠 *Memorias (página ${page}):*\n\n${lines.join('\n')}\n\nUsá \`/memories ${page + 1}\` para ver más.`,
    { parse_mode: 'Markdown' }
  ).catch(() => ctx.reply(`Memorias (página ${page}):\n\n${lines.join('\n')}`))
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

// ─── Main task handler ─────────────────────────────────────────────────────────

async function handleTask(ctx) {
  const text = ctx.message.text?.trim()
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

  // T9: If a background task is already running, route this message to the
  // continuity agent so the user isn't left hanging. The original task keeps
  // running and will deliver its response when it finishes.
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

  // Parse "@alias task" mention at the start of the message
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

  const clearAllTimers = () => {
    clearTimeout(vibePhaseTimer)
    clearInterval(vibeInterval)
    clearTimeout(bgPhaseTimer)
  }

  try {
    const activeAgent = getAgentInfo(agentKey || session.agent)
    statusMsg = await ctx.reply(
      `${activeAgent.emoji} Procesando con *${activeAgent.name}*...`,
      { parse_mode: 'Markdown' }
    ).catch(() => null)

    // Set background task immediately so any message the user sends while
    // this task runs is routed to the continuity agent — not a duplicate dispatch.
    sessionManager.setBackgroundTask(userId, {
      agentKey: agentKey || session.agent,
      statusMsgId: statusMsg?.message_id,
      transitionMsgId: null, // populated at 120s if task is still running
      cancel: () => controller.abort(),
      startTime: Date.now(),
      originalPrompt: prompt,
    })

    // Phase 2 (60s): Start rotating vibe phrases every 15s
    vibePhaseTimer = setTimeout(() => {
      const showVibe = async () => {
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
        if (!bg) return // task already completed before 120s — skip transition

        let transitionMsg = null
        try {
          transitionMsg = await ctx.reply(
            `🐙⚡ *${activeAgent.name}* sigue trabajando en tu tarea. Mientras tanto, podés seguir hablando conmigo.`,
            { parse_mode: 'Markdown' }
          )
        } catch {}

        if (transitionMsg) bg.transitionMsgId = transitionMsg.message_id
      }, 60_000) // 60s after phase 2 = 120s total
    }, 60_000)

    const response = await dispatch(agentKey, prompt, session, signal)
    clearAllTimers()

    if (!agentKey) {
      sessionManager.addToHistory(userId, 'user', prompt)
      sessionManager.addToHistory(userId, 'assistant', response)
    }

    // Deliver response — prefix only if the transition message was shown (120s mark was reached)
    const bg = sessionManager.getBackgroundTask(userId)
    if (bg?.transitionMsgId) {
      const prefix = `✅ *${activeAgent.name}* terminó:\n\n`
      const chunks = splitMessage(prefix + response, MAX_RESPONSE_LENGTH)
      for (const chunk of chunks) {
        await sendWithFallback(ctx, chunk)
      }
      await ctx.telegram.deleteMessage(ctx.chat.id, bg.transitionMsgId).catch(() => {})
    } else {
      const chunks = splitMessage(response, MAX_RESPONSE_LENGTH)
      for (const chunk of chunks) {
        await sendWithFallback(ctx, chunk)
      }
    }
    sessionManager.clearBackgroundTask(userId)
  } catch (err) {
    clearAllTimers()

    // Clean up background task if it was set before the error
    const bgOnError = sessionManager.getBackgroundTask(userId)
    if (bgOnError?.transitionMsgId) {
      await ctx.telegram.deleteMessage(ctx.chat.id, bgOnError.transitionMsgId).catch(() => {})
    }
    if (bgOnError) sessionManager.clearBackgroundTask(userId)

    // Cancelled by /limpiar — cleanup already done there
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
  }
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
    statusMsg = await ctx.reply('🎙️ Transcribiendo audio...')

    const startTime = Date.now()
    heartbeatInterval = setInterval(async () => {
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      if (statusMsg) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, statusMsg.message_id, undefined,
          `🎙️ Transcribiendo audio... (${elapsed}s)`
        ).catch(() => {})
      }
    }, 10_000)

    const transcript = await transcribe(ctx.telegram, voiceOrAudio.file_id)
    clearInterval(heartbeatInterval)
    heartbeatInterval = null

    // Show transcript in the status message (plain text to avoid Markdown parse errors)
    await ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, undefined,
      `📝 Transcripción:\n${transcript}`
    ).catch(() => {})
    statusMsg = null // keep it visible — don't delete

    // Dispatch transcript to the active AI agent
    const response = await dispatch(null, transcript, session)
    sessionManager.addToHistory(userId, 'user', transcript)
    sessionManager.addToHistory(userId, 'assistant', response)

    const chunks = splitMessage(response, MAX_RESPONSE_LENGTH)
    for (const chunk of chunks) {
      await sendWithFallback(ctx, chunk)
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

    // Delete the "Transcribiendo..." status message if still up
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
    await ctx.reply(`\`\`\`\n${text}\n\`\`\``, { parse_mode: 'Markdown' })
  } catch {
    await ctx.reply(text)
  }
}

module.exports = {
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
}
