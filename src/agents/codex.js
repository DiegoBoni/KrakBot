const { runCLI } = require('./runner')
const { AGENTS } = require('./router')

/**
 * Runs a prompt through OpenAI Codex CLI.
 *
 * @param {string} prompt
 * @param {object} session
 * @returns {Promise<string>}
 */
async function run(prompt, session) {
  const agent = AGENTS.codex
  return runCLI([agent.cli, agent.printFlag, ...(agent.extraFlags ?? []), prompt])
}

module.exports = { run }
