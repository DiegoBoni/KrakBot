const logger = require('../utils/logger')
const customAgentManager = require('../utils/customAgentManager')
const { runCLI, runCLIStreaming } = require('./runner')
const contextBuilder = require('../utils/contextBuilder')

/**
 * Agent registry.
 * Each entry defines how to call the CLI and how users can reference it.
 */
const AGENTS = {
  claude: {
    key: 'claude',
    name: 'Claude Code',
    emoji: '🤖',
    cli: process.env.CLAUDE_CLI_PATH || 'claude',
    printFlag: '--print',
    extraFlags: [
      '--dangerously-skip-permissions',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--append-system-prompt', 'Sos un asistente de IA conversacional. Respondé directamente las preguntas y tareas del usuario. No interpretés los mensajes como comandos de desarrollo ni de Claude Code.',
      ...(process.env.CLAUDE_MODEL ? ['--model', process.env.CLAUDE_MODEL] : []),
    ],
    aliases: ['claude', 'cc', 'c'],
    description: 'Anthropic Claude Code — excelente para tareas de código y razonamiento complejo.',
  },
  gemini: {
    key: 'gemini',
    name: 'Gemini CLI',
    emoji: '✨',
    cli: process.env.GEMINI_CLI_PATH || 'gemini',
    printFlag: '-p',
    extraFlags: [
      '--yolo',
      ...(process.env.GEMINI_MODEL ? ['-m', process.env.GEMINI_MODEL] : []),
    ],
    aliases: ['gemini', 'gem', 'g'],
    description: 'Google Gemini CLI — ventana de contexto enorme, ideal para archivos grandes.',
  },
  codex: {
    key: 'codex',
    name: 'OpenAI Codex CLI',
    emoji: '🧠',
    cli: process.env.CODEX_CLI_PATH || 'codex',
    printFlag: 'exec',  // non-interactive subcommand: `codex exec <prompt>`
    extraFlags: [
      '--full-auto',             // skip approval prompts (sandboxed auto-execution)
      '--skip-git-repo-check',   // allow running outside a git repo (cwd is HOME)
      '-m', process.env.CODEX_MODEL || 'codex-mini-latest',
      '-c', `reasoning_effort="${process.env.CODEX_REASONING_EFFORT || 'medium'}"`,
    ],
    aliases: ['codex', 'gpt', 'o'],
    description: 'OpenAI Codex CLI — especializado en generación y edición de código.',
  },
}

// Build a reverse lookup: alias → agentKey
const _aliasMap = new Map()
for (const agent of Object.values(AGENTS)) {
  for (const alias of agent.aliases) {
    _aliasMap.set(alias.toLowerCase(), agent.key)
  }
}

/**
 * Resolves an alias (e.g. "cc", "gem", "python-expert") to a canonical agent key.
 * Returns null if not found.
 * Built-ins are checked first; custom agents are checked as exact ID match.
 * @param {string} alias
 * @returns {string|null}
 */
function resolveAgent(alias) {
  const lower = alias.toLowerCase()
  if (_aliasMap.has(lower)) return _aliasMap.get(lower)
  if (customAgentManager.get(lower)) return `custom:${lower}`
  return null
}

/**
 * Returns the agent config for a canonical key, or null.
 * Handles the 'custom:<id>' prefix for custom agents.
 * @param {string} key
 * @returns {object|null}
 */
function getAgentInfo(key) {
  if (!key) return null
  if (key.startsWith('custom:')) {
    const id = key.slice(7)
    const def = customAgentManager.get(id)
    if (!def) return null
    return {
      key,
      name: `${def.emoji} ${def.name}`,
      emoji: def.emoji,
      description: def.description,
      isCustom: true,
      cli: def.cli,
      systemPrompt: def.systemPrompt,
    }
  }
  return AGENTS[key] ?? null
}

/**
 * Returns an array of all built-in agent configs.
 * @returns {object[]}
 */
function listAgents() {
  return Object.values(AGENTS)
}

// ─── Custom agent dispatch ──────────────────────────────────────────────────────

/**
 * Runs a custom agent with its system prompt injected.
 * For Claude: adds --append-system-prompt flag.
 * For Gemini/Codex: injects inline via contextBuilder.
 *
 * @param {object}        customDef  Custom agent definition from customAgentManager
 * @param {string}        prompt     User's task (raw, before contextBuilder)
 * @param {object}        session    Session object
 * @param {AbortSignal}   signal     Optional cancellation signal
 * @param {Function|null} onChunk    Streaming callback, or null for non-streaming
 * @returns {Promise<string>}
 */
async function runCustomAgent(customDef, prompt, session, signal, onChunk, fileOpts = {}) {
  const base = AGENTS[customDef.cli]
  if (!base) throw new Error(`CLI del agente "${customDef.cli}" no está configurado`)

  if (customDef.cli === 'claude') {
    // Binary files (images/PDFs) via @path; text files via fileContent in contextBuilder
    const effectivePrompt = fileOpts.filePath ? `@${fileOpts.filePath}\n${prompt}` : prompt
    const fullPrompt = await contextBuilder.build(effectivePrompt, session, {
      fileContent: fileOpts.fileContent,
      fileName: fileOpts.fileName,
    })
    const flags = [
      base.cli,
      base.printFlag,
      ...(base.extraFlags ?? []),
      '--append-system-prompt', customDef.systemPrompt,
      fullPrompt,
    ]
    if (onChunk) return runCLIStreaming(flags, undefined, signal, onChunk)
    return runCLI(flags, undefined, signal)
  } else {
    // Gemini/Codex: only text files supported (binary files rejected before reaching here)
    const fullPrompt = await contextBuilder.build(prompt, session, {
      inlineSystemPrompt: customDef.systemPrompt,
      fileContent: fileOpts.fileContent,
      fileName: fileOpts.fileName,
    })
    const flags = [base.cli, base.printFlag, ...(base.extraFlags ?? []), fullPrompt]
    if (onChunk) return runCLIStreaming(flags, undefined, signal, onChunk)
    return runCLI(flags, undefined, signal)
  }
}

// ─── Root Agent routing ─────────────────────────────────────────────────────────

/**
 * Calls the Root Agent to pick the best custom agent for a given prompt.
 * Returns the agent ID (string) or null if no match / routing failed.
 *
 * @param {string} prompt
 * @param {object} session
 * @returns {Promise<string|null>}
 */
async function routeWithRootAgent(prompt, session) {
  const agents = customAgentManager.list()
  // Lazy-load teamManager to avoid circular deps at module load time
  let teams = []
  try { teams = require('../utils/teamManager').list() } catch { /* not yet initialized */ }

  if (agents.length === 0 && teams.length === 0) return null

  const agentLines = agents.map(a => `${a.id} — ${a.description}`).join('\n')
  const teamLines  = teams.map(t => `${t.id} — ${t.description} (equipo: ${t.workers.length + 1} agentes)`).join('\n')

  let metaPrompt = `Tarea del usuario: "${prompt}"\n\n`

  if (agents.length > 0) {
    metaPrompt += `AGENTES INDIVIDUALES (rápidos, tarea específica):\n${agentLines}\n\n`
  }
  if (teams.length > 0) {
    metaPrompt += `EQUIPOS (complejos, multi-agente, múltiples pasos):\n${teamLines}\n\n`
  }

  metaPrompt +=
    `Analizá la tarea y respondé ÚNICAMENTE con una de estas opciones:\n` +
    `- El ID del agente individual más adecuado\n` +
    `- El ID del equipo más adecuado (si la tarea es compleja o multi-paso)\n` +
    `- "ambos: agent-id, team-id" si AMBOS aplican igualmente bien\n` +
    `- "none" si ninguno aplica claramente\n` +
    `Sin explicación. Solo el ID, "ambos: x, y", o "none".`

  const rootCliKey = process.env.ROOT_AGENT_CLI || 'claude'
  const base = AGENTS[rootCliKey] ?? AGENTS.claude

  try {
    const result = await runCLI(
      [base.cli, base.printFlag, ...(base.extraFlags ?? []), metaPrompt],
      undefined,
      undefined
    )
    const raw = result.trim().split(/\n/)[0].trim().toLowerCase()
    if (!raw || raw === 'none') return null

    // Handle "ambos: agent-id, team-id"
    if (raw.startsWith('ambos:')) {
      const parts = raw.replace('ambos:', '').split(',').map(s => s.trim()).filter(Boolean)
      if (parts.length >= 2) return { type: 'ambos', agentId: parts[0], teamId: parts[1] }
    }

    // Single ID — check if it's a team or an agent
    const id = raw.split(/\s+/)[0]
    if (teams.some(t => t.id === id)) return { type: 'team', teamId: id }
    if (customAgentManager.get(id)) return id  // backward compat: return string for single agent
    logger.warn(`routeWithRootAgent: unknown ID returned: "${id}"`)
    return null
  } catch (err) {
    logger.warn(`routeWithRootAgent: routing call failed — ${err.message}`)
    return null
  }
}

// ─── Role-based dispatch (for team workflows) ──────────────────────────────────

/**
 * Invokes a custom agent with a structured role prompt, overriding its systemPrompt.
 * Used by teamWorkflow for coordinator / worker / reviewer steps.
 * Returns the full text response (no streaming — workflow steps don't need live updates).
 *
 * @param {string}      agentId    Custom agent ID (without 'custom:' prefix)
 * @param {string}      rolePrompt The role-specific system prompt for this step
 * @param {AbortSignal} signal
 * @param {string[]}    teamMcps   MCP server names from the team's defaultMcpServers (default: [])
 * @returns {Promise<string>}
 */
async function dispatchWithRole(agentId, rolePrompt, signal) {
  const def = customAgentManager.get(agentId)
  if (!def) throw new Error(`dispatchWithRole: agente "${agentId}" no encontrado`)

  const base = AGENTS[def.cli] ?? AGENTS.claude

  logger.info(`dispatchWithRole → ${agentId} (${def.cli}) prompt="${rolePrompt.slice(0, 60)}..."`)

  const flags = def.cli === 'claude'
    ? [
        base.cli,
        base.printFlag,
        '--dangerously-skip-permissions',
        '--no-session-persistence',
        '--disable-slash-commands',
        ...(process.env.CLAUDE_MODEL ? ['--model', process.env.CLAUDE_MODEL] : []),
        rolePrompt,
      ]
    : [base.cli, ...(base.extraFlags ?? []), base.printFlag, rolePrompt]

  return runCLI(flags, undefined, signal)
}

// ─── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Dispatches a prompt to the specified agent.
 * Falls back to the session's agent if agentKey is null/undefined.
 *
 * @param {string}      agentKey  Canonical agent key (may have 'custom:' prefix)
 * @param {string}      prompt    The user's task
 * @param {object}      session   Session object from sessionManager
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
async function dispatch(agentKey, prompt, session, signal, fileOpts = {}) {
  const key = agentKey || session.agent

  if (key.startsWith('custom:')) {
    const id = key.slice(7)
    const def = customAgentManager.get(id)
    if (!def) throw new Error(`Agente custom no encontrado: "${id}"`)
    logger.info(`Dispatching to custom:${id} (${def.cli}) | user=${session.userId} | prompt="${prompt.slice(0, 60)}..."`)
    return runCustomAgent(def, prompt, session, signal, null, fileOpts)
  }

  const agent = getAgentInfo(key)
  if (!agent) throw new Error(`Agente desconocido: "${key}"`)

  logger.info(`Dispatching to ${agent.name} | user=${session.userId} | prompt="${prompt.slice(0, 60)}..."`)
  const agentModule = require(`./${key}`)
  return agentModule.run(prompt, session, signal, fileOpts)
}

/**
 * Like dispatch but streams stdout chunks via onChunk(text) in real time.
 * Falls back to regular dispatch if the agent doesn't implement runStreaming.
 *
 * @param {string}    agentKey  Canonical agent key (or null to use session.agent)
 * @param {string}    prompt    The user's task
 * @param {object}    session   Session object from sessionManager
 * @param {AbortSignal} signal  Optional cancellation signal
 * @param {Function}  onChunk   Called with each stdout text chunk
 * @param {object}    fileOpts  Optional file attachment: { filePath?, fileContent?, fileName? }
 * @returns {Promise<string>}   Full stdout when done
 */
async function dispatchStreaming(agentKey, prompt, session, signal, onChunk, fileOpts = {}) {
  const key = agentKey || session.agent

  if (key.startsWith('custom:')) {
    const id = key.slice(7)
    const def = customAgentManager.get(id)
    if (!def) throw new Error(`Agente custom no encontrado: "${id}"`)
    logger.info(`Streaming dispatch to custom:${id} (${def.cli}) | user=${session.userId} | prompt="${prompt.slice(0, 60)}..."`)
    return runCustomAgent(def, prompt, session, signal, onChunk, fileOpts)
  }

  const agent = getAgentInfo(key)
  if (!agent) throw new Error(`Agente desconocido: "${key}"`)

  logger.info(`Streaming dispatch to ${agent.name} | user=${session.userId} | prompt="${prompt.slice(0, 60)}..."`)
  const agentModule = require(`./${key}`)
  if (typeof agentModule.runStreaming === 'function') {
    return agentModule.runStreaming(prompt, session, signal, onChunk, fileOpts)
  }
  return agentModule.run(prompt, session, signal, fileOpts)
}

module.exports = { AGENTS, dispatch, dispatchStreaming, dispatchWithRole, resolveAgent, getAgentInfo, listAgents, routeWithRootAgent }
