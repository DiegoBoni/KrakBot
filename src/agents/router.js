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
      ...(process.env.CODEX_MODEL ? ['-m', process.env.CODEX_MODEL] : []),
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
async function runCustomAgent(customDef, prompt, session, signal, onChunk) {
  const base = AGENTS[customDef.cli]
  if (!base) throw new Error(`CLI del agente "${customDef.cli}" no está configurado`)

  if (customDef.cli === 'claude') {
    const fullPrompt = await contextBuilder.build(prompt, session)
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
    const fullPrompt = await contextBuilder.build(prompt, session, {
      inlineSystemPrompt: customDef.systemPrompt,
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
  if (agents.length === 0) return null

  const agentList = agents.map(a => `${a.id} — ${a.description}`).join('\n')
  const metaPrompt =
    `Tenés estas herramientas disponibles (nombre: descripción):\n${agentList}\n\n` +
    `Tarea del usuario: "${prompt}"\n\n` +
    `Respondé ÚNICAMENTE con el ID del agente más adecuado para esta tarea.\n` +
    `Si ninguno aplica claramente, respondé: none\n` +
    `No agregues explicación. Solo el ID o "none".`

  const rootCliKey = process.env.ROOT_AGENT_CLI || 'claude'
  const base = AGENTS[rootCliKey] ?? AGENTS.claude

  try {
    const result = await runCLI(
      [base.cli, base.printFlag, ...(base.extraFlags ?? []), metaPrompt],
      undefined,
      undefined
    )
    const id = result.trim().split(/\s+/)[0].toLowerCase()
    if (!id || id === 'none') return null
    if (!customAgentManager.get(id)) {
      logger.warn(`routeWithRootAgent: unknown ID returned: "${id}"`)
      return null
    }
    return id
  } catch (err) {
    logger.warn(`routeWithRootAgent: routing call failed — ${err.message}`)
    return null
  }
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
async function dispatch(agentKey, prompt, session, signal) {
  const key = agentKey || session.agent

  if (key.startsWith('custom:')) {
    const id = key.slice(7)
    const def = customAgentManager.get(id)
    if (!def) throw new Error(`Agente custom no encontrado: "${id}"`)
    logger.info(`Dispatching to custom:${id} (${def.cli}) | user=${session.userId} | prompt="${prompt.slice(0, 60)}..."`)
    return runCustomAgent(def, prompt, session, signal, null)
  }

  const agent = getAgentInfo(key)
  if (!agent) throw new Error(`Agente desconocido: "${key}"`)

  logger.info(`Dispatching to ${agent.name} | user=${session.userId} | prompt="${prompt.slice(0, 60)}..."`)
  const agentModule = require(`./${key}`)
  return agentModule.run(prompt, session, signal)
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
 * @returns {Promise<string>}   Full stdout when done
 */
async function dispatchStreaming(agentKey, prompt, session, signal, onChunk) {
  const key = agentKey || session.agent

  if (key.startsWith('custom:')) {
    const id = key.slice(7)
    const def = customAgentManager.get(id)
    if (!def) throw new Error(`Agente custom no encontrado: "${id}"`)
    logger.info(`Streaming dispatch to custom:${id} (${def.cli}) | user=${session.userId} | prompt="${prompt.slice(0, 60)}..."`)
    return runCustomAgent(def, prompt, session, signal, onChunk)
  }

  const agent = getAgentInfo(key)
  if (!agent) throw new Error(`Agente desconocido: "${key}"`)

  logger.info(`Streaming dispatch to ${agent.name} | user=${session.userId} | prompt="${prompt.slice(0, 60)}..."`)
  const agentModule = require(`./${key}`)
  if (typeof agentModule.runStreaming === 'function') {
    return agentModule.runStreaming(prompt, session, signal, onChunk)
  }
  return agentModule.run(prompt, session, signal)
}

module.exports = { AGENTS, dispatch, dispatchStreaming, resolveAgent, getAgentInfo, listAgents, routeWithRootAgent }
