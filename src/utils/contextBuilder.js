const soulManager = require('./soulManager')
const memoryManager = require('./memoryManager')

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
  const soul = soulManager.get()
  const memoryMode = getMemoryMode()

  let memoriesText = ''
  if (memoryMode !== 'none') {
    memoriesText = await memoryManager.getRecent(5, getMemoryLimit())
  }

  const historyBlock  = buildHistoryBlock(session.history)
  const soulBlock     = soul ? `[SOUL]\n${soul}\n[/SOUL]` : ''
  const agentBlock    = options.inlineSystemPrompt
    ? `[INSTRUCCIONES DEL AGENTE]\n${options.inlineSystemPrompt}\n[/INSTRUCCIONES DEL AGENTE]`
    : ''
  const memoriesBlock = memoriesText ? `[MEMORIES]\n${memoriesText}\n[/MEMORIES]` : ''

  const blocks = [soulBlock, agentBlock, memoriesBlock, historyBlock].filter(Boolean)
  const suffix = `---\nTarea: ${prompt}`

  let full = blocks.length > 0
    ? `${blocks.join('\n\n')}\n\n${suffix}`
    : prompt

  // If over the hard limit, drop memories first, then trim soul
  if (full.length > PROMPT_HARD_LIMIT) {
    const blocksNoMemory = [soulBlock, agentBlock, historyBlock].filter(Boolean)
    full = blocksNoMemory.length > 0
      ? `${blocksNoMemory.join('\n\n')}\n\n${suffix}`
      : prompt

    if (full.length > PROMPT_HARD_LIMIT) {
      const trimmedSoul = soul ? soul.slice(0, 1000) : ''
      const trimmedSoulBlock = trimmedSoul ? `[SOUL]\n${trimmedSoul}\n[/SOUL]` : ''
      const blocksMinimal = [trimmedSoulBlock, agentBlock, historyBlock].filter(Boolean)
      full = blocksMinimal.length > 0
        ? `${blocksMinimal.join('\n\n')}\n\n${suffix}`
        : prompt
    }
  }

  return full
}

module.exports = { build }
