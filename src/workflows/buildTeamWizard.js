'use strict'

const logger               = require('../utils/logger')
const teamManager          = require('../utils/teamManager')
const customAgentManager   = require('../utils/customAgentManager')
const sessionManager       = require('../utils/sessionManager')
const { dispatchWithRole } = require('../agents/router')

const WIZARD_TTL_MS = 30 * 60 * 1000  // 30 minutes

// ─── Domain catalog ────────────────────────────────────────────────────────────

const DOMAINS = [
  { id: 'development',    label: '💻 Desarrollo' },
  { id: 'marketing',      label: '📣 Marketing' },
  { id: 'sales',          label: '💰 Ventas' },
  { id: 'legal',          label: '⚖️ Legal' },
  { id: 'finance',        label: '📊 Finanzas' },
  { id: 'education',      label: '🎓 Educación' },
  { id: 'support',        label: '🛎️ Atención al cliente' },
  { id: 'research',       label: '🔬 Investigación' },
  { id: 'productivity',   label: '📋 Productividad' },
  { id: 'assistant',      label: '🤝 Asistente personal' },
  { id: 'social_media',   label: '📱 Redes sociales' },
  { id: 'content_seo',    label: '✍️ Contenido / SEO' },
  { id: 'operations',     label: '🏗️ Operaciones' },
  { id: 'design',         label: '🎨 Diseño / Creatividad' },
  { id: 'security',       label: '🔒 Seguridad' },
  { id: 'ecommerce',      label: '📦 E-commerce' },
  { id: 'health',         label: '🏥 Salud' },
  { id: 'compliance',     label: '🏛️ Gobierno / Compliance' },
  { id: 'gaming',         label: '🎮 Gaming / Entretenimiento' },
  { id: 'custom',         label: '🔧 Personalizado ✏️' },
]

// ─── Keyboard builders ─────────────────────────────────────────────────────────

function buildModelKeyboard() {
  const cliStatus = global.__cliStatus ?? {}
  const buttons = ['claude', 'gemini', 'codex']
    .filter(c => cliStatus[c]?.found !== false)
    .map(c => ({ text: `✅ ${c}`, callback_data: `buildteam_model:${c}` }))
  return { inline_keyboard: [buttons] }
}

function buildDomainKeyboard() {
  const buttons = DOMAINS.map(d => ({ text: d.label, callback_data: `buildteam_domain:${d.id}` }))
  const rows = []
  for (let i = 0; i < buttons.length - 1; i += 2) {
    rows.push([buttons[i], buttons[i + 1]])
  }
  // Last item (Personalizado) spans full width
  rows.push([buttons[buttons.length - 1]])
  return { inline_keyboard: rows }
}

// ─── TTL check ─────────────────────────────────────────────────────────────────

function checkTtl(session) {
  if (!session.buildTeamFlow) return false
  if (Date.now() - session.buildTeamFlow.ttl > WIZARD_TTL_MS) {
    delete session.buildTeamFlow
    return false
  }
  return true
}

function _refreshTtl(session) {
  session.buildTeamFlow.ttl = Date.now()
}

// ─── IA recommendation ─────────────────────────────────────────────────────────

async function _generateRecommendation(domain, objective) {
  const domainLabel = DOMAINS.find(d => d.id === domain)?.label ?? domain

  const wizardPrompt =
    `Diseñá un equipo de agentes de IA para el dominio "${domainLabel}".\n` +
    `Objetivo del equipo: "${objective}"\n\n` +
    `Respondé ÚNICAMENTE con este JSON (sin texto extra, sin markdown):\n` +
    `{\n` +
    `  "teamName": "Nombre con emoji",\n` +
    `  "domain": "${domain}",\n` +
    `  "description": "Una línea describiendo el equipo",\n` +
    `  "coordinator": {\n` +
    `    "name": "Nombre con emoji",\n` +
    `    "description": "Qué hace el coordinator",\n` +
    `    "systemPrompt": "Prompt completo del agente coordinator"\n` +
    `  },\n` +
    `  "workers": [\n` +
    `    {\n` +
    `      "name": "Nombre con emoji",\n` +
    `      "description": "Qué hace este worker",\n` +
    `      "systemPrompt": "Prompt completo del worker"\n` +
    `    }\n` +
    `  ],\n` +
    `  "reviewer": {\n` +
    `    "name": "Nombre con emoji",\n` +
    `    "description": "Qué revisa",\n` +
    `    "systemPrompt": "Prompt completo del reviewer"\n` +
    `  },\n` +
    `  "reviewMode": "auto"\n` +
    `}`

  // Use the root CLI agent for the recommendation
  const rootCliKey = process.env.ROOT_AGENT_CLI || 'claude'
  const { AGENTS, runCLI } = _getRunCLI()
  const base = AGENTS[rootCliKey] ?? AGENTS.claude

  const flags = [
    base.cli,
    base.printFlag,
    '--dangerously-skip-permissions',
    '--no-session-persistence',
    '--disable-slash-commands',
    ...(process.env.CLAUDE_MODEL ? ['--model', process.env.CLAUDE_MODEL] : []),
    wizardPrompt,
  ]

  const raw = await runCLI(flags, undefined, undefined)
  const clean = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('La IA no devolvió un JSON válido')
  return JSON.parse(match[0])
}

function _getRunCLI() {
  const runner = require('../agents/runner')
  const router = require('../agents/router')
  return { AGENTS: router.AGENTS, runCLI: runner.runCLI }
}

// ─── Format recommendation for display ────────────────────────────────────────

function formatRecommendation(rec) {
  const workers = rec.workers.map(w => `   · *${w.name}* — ${w.description}`).join('\n')
  const reviewer = rec.reviewer
    ? `\n✅ *Reviewer:* ${rec.reviewer.name}\n   → ${rec.reviewer.description}`
    : '\n_(Sin revisor — reviewMode: none)_'

  return (
    `💡 *Equipo recomendado:*\n\n` +
    `🎯 *${rec.teamName}*\n` +
    `_${rec.description}_\n\n` +
    `👤 *Coordinator:* ${rec.coordinator.name}\n` +
    `   → ${rec.coordinator.description}\n\n` +
    `👷 *Workers:*\n${workers}` +
    reviewer
  )
}

function confirmKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Crear así', callback_data: 'buildteam_confirm' },
        { text: '✏️ Personalizar', callback_data: 'buildteam_customize' },
      ],
      [{ text: '🔄 Sugerir otra estructura', callback_data: 'buildteam_retry' }],
    ],
  }
}

// ─── Wizard steps ──────────────────────────────────────────────────────────────

async function startWizard(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  session.buildTeamFlow = { step: 'domain', ttl: Date.now() }
  await ctx.reply(
    '¿Para qué área querés armar tu equipo?',
    { reply_markup: buildDomainKeyboard() }
  )
}

async function handleDomainSelected(ctx, domain) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (!checkTtl(session)) {
    await ctx.reply('El wizard expiró. Escribí /buildteam para empezar de nuevo.')
    return
  }
  _refreshTtl(session)
  session.buildTeamFlow.domain = domain

  if (domain === 'custom') {
    session.buildTeamFlow.step = 'objective'
    await ctx.editMessageText(
      '🔧 *Personalizado*\n\nContame brevemente qué hace este equipo y qué tipo de tareas va a resolver.\n_(Ej: "Gestión de contratos de alquiler con revisión legal automatizada")_',
      { parse_mode: 'Markdown' }
    ).catch(() => ctx.reply('Contame qué tipo de tareas va a resolver este equipo.'))
  } else {
    const domainLabel = DOMAINS.find(d => d.id === domain)?.label ?? domain
    session.buildTeamFlow.step = 'objective'
    await ctx.editMessageText(
      `${domainLabel} ✓\n\nContame en una oración qué tipo de tareas va a resolver este equipo.`,
      { parse_mode: 'Markdown' }
    ).catch(() => ctx.reply(`Dominio: ${domainLabel}\n\n¿Qué tipo de tareas va a resolver este equipo?`))
  }
}

async function handleObjectiveReceived(ctx, objective) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (!checkTtl(session)) {
    await ctx.reply('El wizard expiró. Escribí /buildteam para empezar de nuevo.')
    return
  }
  _refreshTtl(session)
  session.buildTeamFlow.objective = objective
  session.buildTeamFlow.step = 'confirm'

  const thinking = await ctx.reply('🤔 Generando recomendación...')

  try {
    const rec = await _generateRecommendation(session.buildTeamFlow.domain, objective)
    session.buildTeamFlow.recommendation = rec

    await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {})
    await ctx.reply(
      formatRecommendation(rec) + '\n\n¿Te parece bien este equipo?',
      { parse_mode: 'Markdown', reply_markup: confirmKeyboard() }
    )
  } catch (err) {
    logger.error(`buildTeamWizard: generation failed — ${err.message}`)
    await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {})
    await ctx.reply(
      '❌ No se pudo generar la recomendación. Intentá de nuevo con /buildteam.',
      { parse_mode: 'Markdown' }
    )
    delete session.buildTeamFlow
  }
}

async function handleRetry(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (!checkTtl(session)) {
    await ctx.reply('El wizard expiró. Escribí /buildteam para empezar de nuevo.')
    return
  }
  const { domain, objective } = session.buildTeamFlow
  session.buildTeamFlow.step = 'confirm'

  await ctx.editMessageText('🔄 Generando otra estructura...').catch(() => {})

  try {
    const rec = await _generateRecommendation(domain, objective + ' (sugerí una estructura diferente a la anterior)')
    session.buildTeamFlow.recommendation = rec
    await ctx.reply(
      formatRecommendation(rec) + '\n\n¿Te parece bien este equipo?',
      { parse_mode: 'Markdown', reply_markup: confirmKeyboard() }
    )
  } catch (err) {
    logger.error(`buildTeamWizard: retry generation failed — ${err.message}`)
    await ctx.reply('❌ No se pudo generar otra estructura. Intentá de nuevo con /buildteam.')
    delete session.buildTeamFlow
  }
}

async function handleCustomize(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (!checkTtl(session)) {
    await ctx.reply('El wizard expiró. Escribí /buildteam para empezar de nuevo.')
    return
  }
  session.buildTeamFlow.step = 'customize'
  await ctx.editMessageText(
    '✏️ *Personalización*\n\nPodés ajustar:\n' +
    '• Nombre del equipo\n• Remover un worker\n• Cambiar reviewer\n• Modo de review (auto/manual/none)\n\n' +
    'Escribí qué querés cambiar o escribí *listo* para crear el equipo como está.',
    { parse_mode: 'Markdown' }
  ).catch(() => ctx.reply('¿Qué querés modificar del equipo?'))
}

async function handleCustomizeInput(ctx, text) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (!checkTtl(session)) {
    await ctx.reply('El wizard expiró. Escribí /buildteam para empezar de nuevo.')
    return
  }
  const lower = text.trim().toLowerCase()
  if (lower === 'listo' || lower === 'ok' || lower === 'confirmar') {
    return handleConfirm(ctx)
  }

  const rec = session.buildTeamFlow.recommendation
  if (!rec) return handleConfirm(ctx)

  // Simple text-based customizations
  const reviewModeMatch = text.match(/reviewmode[:\s]+(\w+)/i)
  if (reviewModeMatch) {
    const mode = reviewModeMatch[1].toLowerCase()
    if (['auto', 'manual', 'none'].includes(mode)) {
      rec.reviewMode = mode
      session.buildTeamFlow.recommendation = rec
      await ctx.reply(`✓ Modo de review cambiado a *${mode}*. Escribí *listo* para crear el equipo.`, { parse_mode: 'Markdown' })
      return
    }
  }

  if (/sin\s+revisor|no\s+revisor|remove\s+reviewer/i.test(text)) {
    rec.reviewer = null
    rec.reviewMode = 'none'
    session.buildTeamFlow.recommendation = rec
    await ctx.reply('✓ Revisor removido. Escribí *listo* para crear el equipo.', { parse_mode: 'Markdown' })
    return
  }

  await ctx.reply(
    formatRecommendation(rec) + '\n\n_Escribí *listo* para crear el equipo o seguí ajustando._',
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard() }
  )
}

async function handleConfirm(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (!checkTtl(session)) {
    await ctx.reply('El wizard expiró. Escribí /buildteam para empezar de nuevo.')
    return
  }

  const rec = session.buildTeamFlow?.recommendation
  if (!rec) {
    delete session.buildTeamFlow
    await ctx.reply('No hay recomendación activa. Escribí /buildteam para empezar.')
    return
  }

  _refreshTtl(session)

  // Go straight to per-agent model selection
  session.buildTeamFlow.step         = 'select_model_per_agent'
  session.buildTeamFlow.perAgentClis = {}
  session.buildTeamFlow.pendingAgentQueue = [
    rec.coordinator.name,
    ...rec.workers.map(w => w.name),
    ...(rec.reviewer ? [rec.reviewer.name] : []),
  ]
  session.buildTeamFlow.currentAgentIdx = 0

  return _promptNextAgentModel(ctx)
}

async function handleModelSelected(ctx, choice) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  if (!checkTtl(session)) {
    await ctx.reply('El wizard expiró. Escribí /buildteam para empezar de nuevo.')
    return
  }
  const flow = session.buildTeamFlow
  if (!flow || flow.step !== 'select_model_per_agent') return
  _refreshTtl(session)

  const agentName = flow.pendingAgentQueue[flow.currentAgentIdx]
  if (agentName) {
    flow.perAgentClis[agentName] = choice
    flow.currentAgentIdx++
  }
  return _promptNextAgentModel(ctx)
}

async function _promptNextAgentModel(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  const flow = session.buildTeamFlow
  const agentName = flow.pendingAgentQueue[flow.currentAgentIdx]
  if (!agentName) {
    flow.step = 'select_model'
    return _commitTeam(ctx)
  }
  await ctx.reply(
    `🤖 Modelo para *${agentName}*:`,
    { parse_mode: 'Markdown', reply_markup: buildModelKeyboard() }
  )
}

async function _commitTeam(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  const flow = session.buildTeamFlow
  const rec = flow.recommendation

  function resolveCli(agentName) {
    return flow.perAgentClis?.[agentName] ?? flow.selectedCli ?? 'claude'
  }

  const creating = await ctx.reply('⚙️ Creando agentes y equipo...').catch(() => null)

  try {
    // Create coordinator if not exists
    const coordId = customAgentManager.generateId(rec.coordinator.name)
    if (!customAgentManager.exists(coordId)) {
      customAgentManager.create({
        name:         rec.coordinator.name,
        description:  rec.coordinator.description,
        systemPrompt: rec.coordinator.systemPrompt,
        cli:          resolveCli(rec.coordinator.name),
      })
    }

    // Create workers
    const workerIds = []
    for (const w of rec.workers) {
      const wId = customAgentManager.generateId(w.name)
      if (!customAgentManager.exists(wId)) {
        customAgentManager.create({
          name:         w.name,
          description:  w.description,
          systemPrompt: w.systemPrompt,
          cli:          resolveCli(w.name),
        })
      }
      workerIds.push(wId)
    }

    // Create reviewer if present
    let reviewerId = null
    if (rec.reviewer) {
      reviewerId = customAgentManager.generateId(rec.reviewer.name)
      if (!customAgentManager.exists(reviewerId)) {
        customAgentManager.create({
          name:         rec.reviewer.name,
          description:  rec.reviewer.description,
          systemPrompt: rec.reviewer.systemPrompt,
          cli:          resolveCli(rec.reviewer.name),
        })
      }
    }

    // Create team
    const team = teamManager.create({
      name:        rec.teamName,
      domain:      rec.domain,
      description: rec.description,
      coordinator: coordId,
      workers:     workerIds,
      reviewer:    reviewerId,
      reviewMode:  rec.reviewMode ?? 'auto',
    })

    delete session.buildTeamFlow
    if (creating) await ctx.telegram.deleteMessage(ctx.chat.id, creating.message_id).catch(() => {})

    // Build summary lines
    const allAgents = [
      { def: rec.coordinator, id: coordId, role: '🎯' },
      ...rec.workers.map((w, i) => ({ def: w, id: workerIds[i], role: '👷' })),
      ...(rec.reviewer ? [{ def: rec.reviewer, id: reviewerId, role: '✅' }] : []),
    ]
    const agentLines = allAgents.map(({ def, id, role }) => {
      const cli = resolveCli(def.name)
      return `${role} \`${id}\` → ${cli}`
    }).join('\n')

    await ctx.reply(
      `✅ *Equipo "${team.name}" creado* con ${allAgents.length} agentes.\n\n` +
      `${agentLines}\n\n` +
      `Usá:\n\`/task ${team.id} descripción de la tarea\`\npara empezar a trabajar.`,
      { parse_mode: 'Markdown' }
    )
    logger.info(`buildTeamWizard: team "${team.id}" created — cli=${flow.selectedCli ?? 'per-agent'}`)
  } catch (err) {
    logger.error(`buildTeamWizard: commit failed — ${err.message}`)
    if (creating) await ctx.telegram.deleteMessage(ctx.chat.id, creating.message_id).catch(() => {})
    await ctx.reply(`❌ Error creando el equipo: ${err.message}`)
    delete session.buildTeamFlow
  }
}

// ─── Dispatch from session ─────────────────────────────────────────────────────

/**
 * Route an incoming text message through the wizard if a flow is active.
 * Returns true if the message was handled by the wizard.
 */
async function handleTextIfActive(ctx) {
  const session = sessionManager.getOrCreate(ctx.from.id)
  const flow = session.buildTeamFlow
  if (!flow) return false
  if (!checkTtl(session)) {
    await ctx.reply('El wizard expiró. Escribí /buildteam para empezar de nuevo.')
    return true
  }

  const text = ctx.message?.text ?? ''

  if (flow.step === 'objective') {
    await handleObjectiveReceived(ctx, text)
    return true
  }

  if (flow.step === 'customize') {
    await handleCustomizeInput(ctx, text)
    return true
  }

  // select_model_per_agent — user must press a button
  if (flow.step === 'select_model_per_agent') {
    await ctx.reply('Tocá uno de los botones de arriba para continuar.')
    return true
  }

  return false
}

module.exports = {
  startWizard,
  handleDomainSelected,
  handleObjectiveReceived,
  handleRetry,
  handleCustomize,
  handleCustomizeInput,
  handleConfirm,
  handleModelSelected,
  handleTextIfActive,
  checkTtl,
}
