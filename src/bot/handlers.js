const { dispatch, resolveAgent, getAgentInfo, listAgents } = require('../agents/router')
const sessionManager = require('../utils/sessionManager')
const logger = require('../utils/logger')

const MAX_RESPONSE_LENGTH = parseInt(process.env.MAX_RESPONSE_LENGTH) || 4000

// Regex to detect "@agentAlias task" at the start of a message
const MENTION_RE = /^@(\w+)\s+([\s\S]+)$/

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
    `/ayuda — instrucciones detalladas\n\n` +
    `💡 También podés mencionar un agente al inicio del mensaje:\n` +
    `\`@claude explicá este código\`\n` +
    `\`@gemini resumí este texto\`\n` +
    `\`@codex generá este script\``,
    { parse_mode: 'Markdown' }
  )
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
    `*Historial:*\n` +
    `Claude recibe las últimas 6 entradas del historial como contexto.\n` +
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
  sessionManager.clearHistory(ctx.from.id)
  await ctx.reply('🗑 Historial borrado. La siguiente respuesta comenzará sin contexto previo.')
}

// ─── Main task handler ─────────────────────────────────────────────────────────

async function handleTask(ctx) {
  const text = ctx.message.text?.trim()
  if (!text) return

  const session = sessionManager.getOrCreate(ctx.from.id)

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
    // If alias doesn't resolve to a known agent, treat the whole message as the prompt
  }

  // Show "processing..." status message
  let statusMsg
  let heartbeatInterval
  try {
    const activeAgent = getAgentInfo(agentKey || session.agent)
    statusMsg = await ctx.reply(
      `${activeAgent.emoji} Procesando con *${activeAgent.name}*...`,
      { parse_mode: 'Markdown' }
    )
    // Edit status every 30 s so the user knows we're still working
    let elapsed = 0
    heartbeatInterval = setInterval(async () => {
      elapsed += 30
      if (statusMsg) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `⏳ *${activeAgent.name}* procesando... (${elapsed}s)`,
          { parse_mode: 'Markdown' }
        ).catch(() => {})
      }
    }, 30_000)
  } catch {
    // If status message fails, continue anyway
  }

  try {
    const response = await dispatch(agentKey, prompt, session)
    clearInterval(heartbeatInterval)

    // Save to history (only for the session's active agent, not one-off mentions)
    if (!agentKey) {
      sessionManager.addToHistory(ctx.from.id, 'user', prompt)
      sessionManager.addToHistory(ctx.from.id, 'assistant', response)
    }

    // Split response if needed and send
    const chunks = splitMessage(response, MAX_RESPONSE_LENGTH)
    for (const chunk of chunks) {
      await sendWithFallback(ctx, chunk)
    }
  } catch (err) {
    clearInterval(heartbeatInterval)
    logger.error(`Task failed for user ${ctx.from.id}: ${err.message}`)
    const agentName = getAgentInfo(agentKey || session.agent)?.name ?? 'Agente'
    const shortMsg = (err.message ?? 'Error desconocido').split('\n')[0].slice(0, 200)
    try {
      await ctx.reply(`❌ *${agentName}* falló:\n${shortMsg}`, { parse_mode: 'Markdown' })
    } catch {
      await ctx.reply(`❌ ${agentName} falló: ${shortMsg}`)
    }
  } finally {
    clearInterval(heartbeatInterval)
    if (statusMsg) {
      await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
    }
  }
}

// ─── Ping / health-check ───────────────────────────────────────────────────────

async function handlePing(ctx, agentKeyArg) {
  const { AGENTS, dispatch } = require('../agents/router')
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

/**
 * Splits a long text into chunks of at most maxLength characters.
 * Tries to break on newlines to avoid splitting mid-sentence.
 */
function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text]

  const chunks = []
  let remaining = text

  while (remaining.length > maxLength) {
    let cutAt = remaining.lastIndexOf('\n', maxLength)
    if (cutAt < maxLength * 0.5) cutAt = maxLength // no good newline found
    chunks.push(remaining.slice(0, cutAt))
    remaining = remaining.slice(cutAt).trimStart()
  }

  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

/**
 * Sends a message wrapped in a code block (Markdown).
 * Falls back to plain text if Telegram rejects the parse_mode.
 */
async function sendWithFallback(ctx, text) {
  try {
    await ctx.reply(`\`\`\`\n${text}\n\`\`\``, { parse_mode: 'Markdown' })
  } catch {
    // Markdown parse error — send as plain text
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
  handlePing,
}
