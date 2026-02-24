const { runCLI } = require('./runner')
const { AGENTS } = require('./router')

const HISTORY_LIMIT = 6 // last N history entries sent as context

/**
 * Runs a prompt through Claude Code CLI.
 * Prepends the last HISTORY_LIMIT session history entries as context.
 *
 * @param {string} prompt
 * @param {object} session
 * @returns {Promise<string>}
 */
async function run(prompt, session) {
  const agent = AGENTS.claude
  const fullPrompt = buildPrompt(prompt, session.history)
  return runCLI([agent.cli, agent.printFlag, ...(agent.extraFlags ?? []), fullPrompt])
}

/**
 * Builds the full prompt string, optionally prefixing recent history as context.
 */
function buildPrompt(prompt, history) {
  if (!history || history.length === 0) return prompt

  const recent = history.slice(-HISTORY_LIMIT)
  const contextLines = recent.map(({ role, content }) => {
    const label = role === 'user' ? 'Usuario' : 'Asistente'
    // Truncate each history entry to avoid bloating the prompt
    return `${label}: ${content.slice(0, 500)}`
  })

  return `Contexto de la conversación previa:\n${contextLines.join('\n')}\n\n---\nTarea actual: ${prompt}`
}

module.exports = { run }
