const { runCLI } = require('./runner')
const { AGENTS } = require('./router')

/**
 * Runs a prompt through Gemini CLI.
 *
 * @param {string} prompt
 * @param {object} session
 * @returns {Promise<string>}
 */
async function run(prompt, session) {
  const agent = AGENTS.gemini
  return runCLI([agent.cli, agent.printFlag, prompt, ...(agent.extraFlags ?? [])])
}

module.exports = { run }
