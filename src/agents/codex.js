const { runCLI } = require('./runner')
const { AGENTS } = require('./router')
const contextBuilder = require('../utils/contextBuilder')

async function run(prompt, session) {
  const agent = AGENTS.codex
  const fullPrompt = await contextBuilder.build(prompt, session)
  return runCLI([agent.cli, agent.printFlag, ...(agent.extraFlags ?? []), fullPrompt])
}

module.exports = { run }
