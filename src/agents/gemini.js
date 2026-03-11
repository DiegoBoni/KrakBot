const { runCLI, runCLIStreaming } = require('./runner')
const { AGENTS } = require('./router')
const contextBuilder = require('../utils/contextBuilder')

async function run(prompt, session, signal, fileOpts = {}) {
  const agent = AGENTS.gemini
  // Gemini CLI has no native file flag — only text files are supported (embedded via fileBlock).
  // Binary files (images/PDFs) are rejected before reaching this function.
  const fullPrompt = await contextBuilder.build(prompt, session, {
    fileContent: fileOpts.fileContent,
    fileName: fileOpts.fileName,
  })
  return runCLI([agent.cli, agent.printFlag, fullPrompt, ...(agent.extraFlags ?? [])], undefined, signal)
}

async function runStreaming(prompt, session, signal, onChunk, fileOpts = {}) {
  const agent = AGENTS.gemini
  const fullPrompt = await contextBuilder.build(prompt, session, {
    fileContent: fileOpts.fileContent,
    fileName: fileOpts.fileName,
  })
  return runCLIStreaming([agent.cli, agent.printFlag, fullPrompt, ...(agent.extraFlags ?? [])], undefined, signal, onChunk)
}

module.exports = { run, runStreaming }
