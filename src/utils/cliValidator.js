const { spawnSync } = require('child_process')
const logger = require('./logger')

/**
 * Probes a binary by running `bin --version`.
 * Returns true if the binary is found (no ENOENT).
 * Authentication is handled by the CLI itself on the host machine.
 * @param {string} bin
 * @returns {boolean}
 */
function binaryExists(bin) {
  const result = spawnSync(bin, ['--version'], {
    timeout: 5000,
    shell: false,
    stdio: 'pipe',
    encoding: 'utf8',
  })
  return result.error == null
}

/**
 * Validates all agent CLIs at startup.
 * Logs warnings for missing binaries.
 * Returns a status map: { [agentKey]: { found: boolean } }
 * @param {object} agents  The AGENTS registry from router.js
 * @returns {object}
 */
function validateAll(agents) {
  const status = {}

  for (const [key, agent] of Object.entries(agents)) {
    const found = binaryExists(agent.cli)
    status[key] = { found }

    if (!found) {
      logger.warn(`[cliValidator] CLI no encontrado: "${agent.cli}" (agente: ${key}). Configurá ${key.toUpperCase()}_CLI_PATH en .env`)
    } else {
      logger.info(`[cliValidator] CLI OK: "${agent.cli}" (agente: ${key})`)
    }
  }

  return status
}

module.exports = { validateAll, binaryExists }
