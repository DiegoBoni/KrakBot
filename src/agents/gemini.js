const { runCLI } = require('./runner')
const { AGENTS } = require('./router')
const contextBuilder = require('../utils/contextBuilder')

async function run(prompt, session, signal) {
  const agent = AGENTS.gemini
  const fullPrompt = await contextBuilder.build(prompt, session)
  return runCLI([agent.cli, agent.printFlag, fullPrompt, ...(agent.extraFlags ?? [])], undefined, signal)
}

module.exports = { run }
