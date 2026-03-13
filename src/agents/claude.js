const { runCLI, runCLIStreaming } = require('./runner')
const { AGENTS } = require('./router')
const contextBuilder = require('../utils/contextBuilder')

async function run(prompt, session, signal, fileOpts = {}) {
  const agent = AGENTS.claude
  // For binary files (images/PDFs): prepend @/path so Claude reads the file natively.
  // For text files: fileContent is embedded via contextBuilder's fileBlock.
  const effectivePrompt = fileOpts.filePath ? `@${fileOpts.filePath}\n${prompt}` : prompt
  const fullPrompt = await contextBuilder.build(effectivePrompt, session, {
    fileContent: fileOpts.fileContent,
    fileName: fileOpts.fileName,
  })
  return runCLI([agent.cli, agent.printFlag, ...(agent.extraFlags ?? []), fullPrompt], undefined, signal)
}

async function runStreaming(prompt, session, signal, onChunk, fileOpts = {}) {
  const agent = AGENTS.claude
  const effectivePrompt = fileOpts.filePath ? `@${fileOpts.filePath}\n${prompt}` : prompt
  const fullPrompt = await contextBuilder.build(effectivePrompt, session, {
    fileContent: fileOpts.fileContent,
    fileName: fileOpts.fileName,
  })
  return runCLIStreaming([agent.cli, agent.printFlag, ...(agent.extraFlags ?? []), fullPrompt], undefined, signal, onChunk)
}

module.exports = { run, runStreaming }
