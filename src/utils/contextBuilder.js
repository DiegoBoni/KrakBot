const soulManager   = require('./soulManager')
const memoryManager = require('./memoryManager')
const policyManager = require('./policyManager')

const HISTORY_ENTRY_MAX = 500
const PROMPT_HARD_LIMIT = 12000

function getHistoryWindow() {
  const n = parseInt(process.env.HISTORY_WINDOW)
  return isNaN(n) || n < 0 ? 6 : n
}

function getMemoryLimit() {
  return parseInt(process.env.MEMORY_INJECT_LIMIT) || 2000
}

function getMemoryMode() {
  return process.env.MEMORY_INJECT || 'recent'
}

function buildHistoryBlock(history) {
  if (!history || history.length === 0) return ''
  const win = getHistoryWindow()
  if (win === 0) return ''
  const recent = history.slice(-win * 2)
  if (recent.length === 0) return ''
  const lines = recent.map(({ role, content }) => {
    const label = role === 'user' ? 'Usuario' : 'Asistente'
    return `${label}: ${content.slice(0, HISTORY_ENTRY_MAX)}`
  })
  return `[HISTORIAL]\n${lines.join('\n')}\n[/HISTORIAL]`
}

async function build(prompt, session, options = {}) {
  const soul      = soulManager.get()
  const agentKey  = options.agentKey ?? session?.agent ?? null
  const policy    = policyManager.get(agentKey)
  const memoryMode = getMemoryMode()

  let memoriesText = ''
  if (memoryMode !== 'none') {
    memoriesText = await memoryManager.getRecent(5, getMemoryLimit())
  }

  const historyBlock  = buildHistoryBlock(session.history)
  const soulBlock     = soul   ? `[SOUL]\n${soul}\n[/SOUL]` : ''
  const policyBlock   = policy ? `[POLICY]\n${policy}\n[/POLICY]` : ''
  const agentBlock    = options.inlineSystemPrompt
    ? `[INSTRUCCIONES DEL AGENTE]\n${options.inlineSystemPrompt}\n[/INSTRUCCIONES DEL AGENTE]`
    : ''
  const memoriesBlock = memoriesText ? `[MEMORIES]\n${memoriesText}\n[/MEMORIES]` : ''
  const fileBlock     = options.fileContent
    ? `[ARCHIVO: ${options.fileName ?? 'archivo'}]\n${options.fileContent}\n[/ARCHIVO]`
    : ''

  // Priority order: SOUL → POLICY → AGENT → MEMORIES → HISTORY → FILE → Task
  const blocks = [soulBlock, policyBlock, agentBlock, memoriesBlock, historyBlock, fileBlock].filter(Boolean)
  const suffix = `---\nTarea: ${prompt}`

  let full = blocks.length > 0
    ? `${blocks.join('\n\n')}\n\n${suffix}`
    : prompt

  // If over the hard limit: drop memories first, then trim soul (policy + file preserved)
  if (full.length > PROMPT_HARD_LIMIT) {
    const blocksNoMemory = [soulBlock, policyBlock, agentBlock, historyBlock, fileBlock].filter(Boolean)
    full = blocksNoMemory.length > 0
      ? `${blocksNoMemory.join('\n\n')}\n\n${suffix}`
      : prompt

    if (full.length > PROMPT_HARD_LIMIT) {
      const trimmedSoul      = soul ? soul.slice(0, 1000) : ''
      const trimmedSoulBlock = trimmedSoul ? `[SOUL]\n${trimmedSoul}\n[/SOUL]` : ''
      const blocksMinimal    = [trimmedSoulBlock, policyBlock, agentBlock, historyBlock, fileBlock].filter(Boolean)
      full = blocksMinimal.length > 0
        ? `${blocksMinimal.join('\n\n')}\n\n${suffix}`
        : prompt
    }
  }

  return full
}

module.exports = { build }
