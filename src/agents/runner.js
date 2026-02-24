const { spawn } = require('child_process')
const logger = require('../utils/logger')

const DEFAULT_TIMEOUT = 120_000

/**
 * Runs a CLI command with the given arguments, feeding input via stdin.
 * Captures stdout and stderr, enforces a configurable timeout.
 *
 * @param {string[]} command  [executable, ...args]
 * @param {string}   input    Text to write to stdin
 * @returns {Promise<string>} stdout of the process
 */
function runCLI(command, input) {
  const timeout = parseInt(process.env.CLI_TIMEOUT) || DEFAULT_TIMEOUT
  const [bin, ...args] = command

  return new Promise((resolve, reject) => {
    logger.debug(`Spawning: ${bin} ${args.join(' ')} (timeout: ${timeout}ms)`)

    let stdout = ''
    let stderr = ''
    let settled = false

    const childEnv = { ...process.env, TERM: 'xterm-256color' }
    delete childEnv.CLAUDECODE  // allow spawning claude CLI from inside a Claude session

    const child = spawn(bin, args, {
      env: childEnv,
      // No shell — avoids injection; the caller must split the command array
      shell: false,
      // Run from home dir so CLIs don't pick up project files (CLAUDE.md, etc.)
      // that would make them behave as development tools instead of chat assistants.
      cwd: process.env.HOME || require('os').tmpdir(),
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      // Hard kill after 2s if SIGTERM wasn't enough
      setTimeout(() => child.kill('SIGKILL'), 2000)
      reject(Object.assign(new Error(`Timeout: el agente tardó más de ${timeout / 1000}s.`), { timedOut: true }))
    }, timeout)

    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      // Log stderr in real time but truncated to avoid log spam
      logger.debug(`[stderr] ${chunk.toString().slice(0, 120).trimEnd()}`)
    })

    // Always close stdin so CLIs that read from it (e.g. Gemini) receive EOF
    // and proceed instead of hanging indefinitely.
    if (input) {
      child.stdin.write(input)
    }
    child.stdin.end()

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const msg = err.code === 'ENOENT'
        ? `El CLI "${bin}" no está instalado o no está en PATH. Pedile al operador que configure ${bin.toUpperCase()}_CLI_PATH.`
        : `No se pudo iniciar el CLI "${bin}": ${err.message}`
      reject(Object.assign(new Error(msg), { cause: err, isEnoent: err.code === 'ENOENT' }))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code === 0 || stdout.trim()) {
        // Exit 0 — or process failed but left useful output anyway
        resolve(stdout || '(sin respuesta)')
        return
      }

      // Non-zero exit with no usable stdout — build a short error
      const shortError = buildShortError(stderr, code)
      reject(Object.assign(new Error(shortError), { exitCode: code, stderr }))
    })
  })
}

/**
 * Extracts a short, readable error message from stderr + exit code.
 */
function buildShortError(stderr, code) {
  if (stderr.includes('429') || stderr.includes('rateLimitExceeded')) {
    return 'Rate limit alcanzado (429). Esperá un momento y reintentá.'
  }
  if (stderr.includes('MODEL_CAPACITY_EXHAUSTED') || stderr.includes('No capacity available for model')) {
    return 'Sin capacidad disponible en el modelo. Reintentá en unos minutos.'
  }
  if (stderr.includes('QUOTA_EXCEEDED') || stderr.includes('quota')) {
    return 'Cuota de API agotada. Revisá tu cuenta o esperá al próximo ciclo.'
  }
  if (stderr.includes('UNAUTHENTICATED') || stderr.includes('API key') || stderr.includes('auth')) {
    return 'Error de autenticación. Verificá las credenciales del CLI.'
  }

  // Last non-empty line of stderr, max 200 chars
  if (stderr) {
    const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean)
    const last = lines[lines.length - 1] ?? ''
    if (last.length > 0) return last.slice(0, 200)
  }

  return `El CLI terminó con código ${code}.`
}

module.exports = { runCLI }
