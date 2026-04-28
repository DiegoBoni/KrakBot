const logger     = require('./logger')
const ltmManager = require('./ltmManager')

function _isEnabled() {
  const v = process.env.LTM_ENABLED
  return v === undefined || v === '' || v === 'true' || v === '1'
}

function _maxChars() {
  return parseInt(process.env.LTM_MAX_CHARS) || 4000
}

function _timeoutMs() {
  return (parseInt(process.env.LTM_COMPACT_TIMEOUT_SECONDS) || 30) * 1000
}

function _buildCompactPrompt(evictedMessages, currentLtm) {
  const ltmSection = currentLtm || '(vacía)'
  const msgSection = evictedMessages.map((m) => {
    const label = m.role === 'user' ? 'Usuario' : 'Asistente'
    return `${label}: ${m.content}`
  }).join('\n')
  return [
    'Sos un asistente de memoria. Resumí de forma concisa los siguientes mensajes de conversación,',
    'extrayendo solo los hechos, decisiones y contexto importante. El resumen debe integrarse con',
    'la memoria existente sin duplicar información. Respondé SOLO el texto del resumen actualizado,',
    'sin explicaciones ni formato extra.',
    '',
    '[MEMORIA ACTUAL]',
    ltmSection,
    '[/MEMORIA ACTUAL]',
    '',
    '[MENSAJES A COMPACTAR]',
    msgSection,
    '[/MENSAJES A COMPACTAR]',
  ].join('\n')
}

function _buildRecompactPrompt(ltmContent) {
  return [
    'Resumí el siguiente bloque de memoria de forma más concisa, conservando los hechos y decisiones',
    'más importantes. Respondé SOLO el texto del resumen, sin explicaciones ni formato extra.',
    '',
    ltmContent,
  ].join('\n')
}

function _resolveCli(agentKey) {
  const { AGENTS } = require('../agents/router')
  if (!agentKey) return AGENTS.claude
  if (agentKey.startsWith('custom:')) {
    const customAgentManager = require('./customAgentManager')
    const def = customAgentManager.get(agentKey.slice(7))
    return def ? (AGENTS[def.cli] ?? AGENTS.claude) : AGENTS.claude
  }
  return AGENTS[agentKey] ?? AGENTS.claude
}

async function compact(evictedMessages, userId, agentKey) {
  if (!_isEnabled()) return
  if (!evictedMessages || evictedMessages.length === 0) return

  const { runCLI } = require('../agents/runner')

  const cli        = _resolveCli(agentKey)
  const currentLtm = ltmManager.read(userId)
  const prompt     = _buildCompactPrompt(evictedMessages, currentLtm)

  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), _timeoutMs())

  try {
    const raw = await runCLI(
      [cli.cli, cli.printFlag, ...(cli.extraFlags ?? []), prompt],
      undefined,
      controller.signal
    )
    clearTimeout(timer)

    const summary = raw.trim()
    if (!summary) {
      logger.warn(`LTM compact: empty response from agent for user ${userId}`)
      return
    }

    let newLtm = summary
    if (newLtm.length > _maxChars()) {
      logger.debug(`LTM for user ${userId} exceeds max (${newLtm.length} chars) — re-summarizing`)
      try {
        const recompact = await runCLI(
          [cli.cli, cli.printFlag, ...(cli.extraFlags ?? []), _buildRecompactPrompt(newLtm)],
          undefined,
          undefined
        )
        newLtm = recompact.trim() || newLtm.slice(0, _maxChars())
      } catch (reErr) {
        logger.warn(`LTM re-summarization failed for user ${userId}: ${reErr.message} — truncating`)
        newLtm = newLtm.slice(0, _maxChars())
      }
    }

    ltmManager.write(userId, newLtm)
    logger.debug(`LTM compaction done for user ${userId}`)
  } catch (err) {
    clearTimeout(timer)
    const isCancelled = controller.signal.aborted || err.cancelled || (err.message || '').includes('cancelled')
    logger.warn(`LTM compact ${isCancelled ? 'timed out' : 'failed'} for user ${userId}: ${err.message}`)
  }
}

module.exports = { compact }
