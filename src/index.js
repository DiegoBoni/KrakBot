require('dotenv').config()

const { mkdirSync } = require('fs')
const path = require('path')
const { createBot } = require('./bot/index')
const sessionManager = require('./utils/sessionManager')
const logger = require('./utils/logger')
const { validateAll } = require('./utils/cliValidator')
const { AGENTS } = require('./agents/router')
const { ensureTempDir, checkWhisper } = require('./utils/audioTranscriber')
const updateChecker = require('./utils/updateChecker')
const customAgentManager = require('./utils/customAgentManager')
const fileManager = require('./utils/fileManager')
const ttsService = require('./utils/ttsService')

async function main() {
  logger.info('🚀 Telegram AI Gateway arrancando...')

  // Ensure persistent session storage directory exists (non-fatal).
  const sessionsDir = path.resolve(__dirname, '../data/sessions')
  try {
    mkdirSync(sessionsDir, { recursive: true })
    logger.debug(`Sessions dir ready: ${sessionsDir}`)
  } catch (err) {
    logger.error(`No se pudo crear data/sessions/: ${err.message}`)
  }

  // Ensure uploads directory exists (non-fatal).
  const uploadsDir = path.resolve(__dirname, '../data/uploads')
  try {
    mkdirSync(uploadsDir, { recursive: true })
    logger.debug(`Uploads dir ready: ${uploadsDir}`)
  } catch (err) {
    logger.warn(`No se pudo crear data/uploads/: ${err.message}`)
  }

  // Initialize custom agent store (creates data/custom-agents.json if needed)
  customAgentManager.init()

  // Validate CLI binaries and API key env vars before accepting requests.
  // Non-fatal: bot still launches even if some CLIs are missing.
  global.__cliStatus = validateAll(AGENTS)

  // Ensure audio temp dir exists and check whisper availability (non-fatal).
  await ensureTempDir()
  const whisper = await checkWhisper()
  if (whisper.found) {
    logger.info('🎙️ mlx_whisper encontrado — transcripción de audio disponible')
  } else {
    logger.warn('mlx_whisper no encontrado — transcripción de audio no disponible')
  }

  // Check TTS availability
  const ttsStatus = await ttsService.checkTTS()
  if (ttsStatus.engine) {
    logger.info(`🔊 TTS disponible: ${ttsStatus.engine} (voz: ${ttsStatus.voice})`)
  } else {
    logger.warn('TTS no disponible — ni edge-tts ni say encontrados')
  }
  global.__ttsEngine = ttsStatus.engine ?? null

  const bot = createBot()

  // Init auto-updater with bot instance (must happen before bot.launch)
  updateChecker.init(bot)

  // Periodic cleanup of stale sessions and expired uploads (every hour)
  const cleanupInterval = setInterval(async () => {
    sessionManager.cleanup()
    await fileManager.cleanupExpiredUploads()
    logger.debug(`Active sessions: ${sessionManager.size}`)
  }, 60 * 60 * 1000)

  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info(`${signal} recibido — apagando bot...`)
    clearInterval(cleanupInterval)
    bot.stop(signal)
    process.exit(0)
  }

  process.once('SIGINT',  () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  await bot.launch({
    dropPendingUpdates: true,
  })

  // Register the "/" command menu visible in Telegram clients
  await bot.telegram.setMyCommands([
    { command: 'start',     description: 'Bienvenida e instrucciones' },
    { command: 'agentes',   description: 'Ver agentes disponibles' },
    { command: 'claude',    description: 'Cambiar agente a Claude' },
    { command: 'gemini',    description: 'Cambiar agente a Gemini' },
    { command: 'codex',     description: 'Cambiar agente a Codex' },
    { command: 'newagent',  description: 'Crear un agente personalizado' },
    { command: 'delagent',  description: 'Borrar un custom agent' },
    { command: 'editagent', description: 'Editar un custom agent' },
    { command: 'setagent',  description: 'Activar un custom agent' },
    { command: 'default',   description: 'Volver al agente por defecto' },
    { command: 'auto',      description: 'Root Agent: elige el mejor agente' },
    { command: 'automode',  description: 'Activar/desactivar routing automático' },
    { command: 'sesion',    description: 'Info de la sesión actual' },
    { command: 'limpiar',   description: 'Borrar historial de la sesión' },
    { command: 'ayuda',     description: 'Instrucciones de uso' },
    { command: 'ping',      description: 'Health check de los agentes' },
    { command: 'update',     description: 'Chequear actualizaciones disponibles' },
    { command: 'voicemode',  description: 'Solo audio: activar/desactivar respuestas en voz' },
    { command: 'ttsbutton',  description: 'Activar/desactivar botón 🔊 en respuestas' },
    { command: 'voz',        description: 'Convertir última respuesta a audio' },
  ])

  logger.info(`✅ Bot corriendo: @${bot.botInfo?.username ?? 'unknown'}`)

  // Check for success message from a previous auto-update restart
  await updateChecker.checkPendingUpdate()

  // Schedule periodic update checks (first check after 30s, then every N hours)
  updateChecker.start()
}

main().catch((err) => {
  console.error('💥 Error fatal al arrancar:', err.message)
  process.exit(1)
})
