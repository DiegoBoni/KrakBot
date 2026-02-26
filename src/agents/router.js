const logger = require('../utils/logger')

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
 * Resolves an alias (e.g. "cc", "gem") to a canonical agent key.
 * Returns null if not found.
 * @param {string} alias
 * @returns {string|null}
 */
function resolveAgent(alias) {
  return _aliasMap.get(alias.toLowerCase()) ?? null
}

/**
 * Returns the agent config for a canonical key, or null.
 * @param {string} key
 * @returns {object|null}
 */
function getAgentInfo(key) {
  return AGENTS[key] ?? null
}

/**
 * Returns an array of all agent configs.
 * @returns {object[]}
 */
function listAgents() {
  return Object.values(AGENTS)
}

/**
 * Dispatches a prompt to the specified agent.
 * Falls back to the session's agent if agentKey is null/undefined.
 *
 * @param {string}      agentKey  Canonical agent key
 * @param {string}      prompt    The user's task
 * @param {object}      session   Session object from sessionManager
 * @returns {Promise<string>}
 */
async function dispatch(agentKey, prompt, session, signal) {
  const key = agentKey || session.agent
  const agent = getAgentInfo(key)

  if (!agent) {
    throw new Error(`Agente desconocido: "${key}"`)
  }

  logger.info(`Dispatching to ${agent.name} | user=${session.userId} | prompt="${prompt.slice(0, 60)}..."`)

  // Require the agent module lazily to keep the dispatch function agnostic
  const agentModule = require(`./${key}`)
  return agentModule.run(prompt, session, signal)
}

module.exports = { AGENTS, dispatch, resolveAgent, getAgentInfo, listAgents }
