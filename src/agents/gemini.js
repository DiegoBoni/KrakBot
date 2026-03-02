const { runCLI, runCLIStreaming } = require('./runner')
const { AGENTS } = require('./router')
const contextBuilder = require('../utils/contextBuilder')

async function run(prompt, session, signal) {
  const agent = AGENTS.gemini
  const fullPrompt = await contextBuilder.build(prompt, session)
  return runCLI([agent.cli, agent.printFlag, fullPrompt, ...(agent.extraFlags ?? [])], undefined, signal)
}

async function runStreaming(prompt, session, signal, onChunk) {
  const agent = AGENTS.gemini
  const fullPrompt = await contextBuilder.build(prompt, session)
  return runCLIStreaming([agent.cli, agent.printFlag, fullPrompt, ...(agent.extraFlags ?? [])], undefined, signal, onChunk)
}

module.exports = { run, runStreaming }
