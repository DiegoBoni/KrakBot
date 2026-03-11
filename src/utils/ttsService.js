/**
 * ttsService.js
 * Text-to-speech engine with edge-tts (primary) and macOS say (fallback).
 * Generates audio files compatible with Telegram sendVoice.
 */

const { spawn, spawnSync } = require('child_process')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')
const { sanitize } = require('./textSanitizer')
const logger = require('./logger')

const TTS_TEMP_DIR = '/tmp/krak-tts'
const TTS_TIMEOUT_MS = 30_000
const DEFAULT_EDGE_VOICE = 'es-AR-TomasNeural'
const DEFAULT_SAY_VOICE = 'Paulina'

// Cache detected say voice (set once at runtime)
let _cachedSayVoice = null

function getTtsEngine() {
  return process.env.TTS_ENGINE || 'auto'
}

function getEdgeVoice() {
  return process.env.TTS_VOICE || DEFAULT_EDGE_VOICE
}

/**
 * Detects the best available Spanish voice for `say` by querying the system.
 * Falls back to DEFAULT_SAY_VOICE if none detected.
 * Result is cached after first call.
 * @returns {string}
 */
function getSayVoice() {
  if (_cachedSayVoice) return _cachedSayVoice
  try {
    const result = spawnSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 5000 })
    const voices = result.stdout || ''
    // Prefer es_MX then es_ES
    const mxMatch = voices.match(/^(\S+)\s+es_MX/m)
    if (mxMatch) { _cachedSayVoice = mxMatch[1]; return _cachedSayVoice }
    const esMatch = voices.match(/^(\S+)\s+es_ES/m)
    if (esMatch) { _cachedSayVoice = esMatch[1]; return _cachedSayVoice }
  } catch {}
  _cachedSayVoice = DEFAULT_SAY_VOICE
  return _cachedSayVoice
}

/**
 * Ensures the TTS temp directory exists.
 */
async function ensureTempDir() {
  await fs.promises.mkdir(TTS_TEMP_DIR, { recursive: true })
}

/**
 * Runs a command via spawn, returns stdout on success, throws on failure/timeout.
 * @param {string} bin
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function spawnAsync(bin, args, timeoutMs = TTS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    let stderr = ''

    const child = spawn(bin, args, { shell: false })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 1000)
      reject(new Error(`Timeout: ${bin} tardó más de ${timeoutMs / 1000}s`))
    }, timeoutMs)

    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.stdout.resume()
    child.stdin.end()

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`${bin} salió con código ${code}: ${stderr.slice(0, 200)}`))
      } else {
        resolve()
      }
    })
  })
}

/**
 * Generates audio using edge-tts.
 * @param {string} text  Pre-sanitized text
 * @param {string} outBase  Base path without extension
 * @returns {Promise<string>}  Path to generated .mp3 file
 */
async function _runEdgeTts(text, outBase) {
  const outPath = `${outBase}.mp3`
  const voice = getEdgeVoice()
  await spawnAsync('edge-tts', ['-t', text, '-v', voice, '--write-media', outPath])
  return outPath
}

/**
 * Generates audio using macOS `say` + ffmpeg conversion.
 * @param {string} text  Pre-sanitized text
 * @param {string} outBase  Base path without extension
 * @returns {Promise<string>}  Path to generated .ogg file
 */
async function _runSay(text, outBase) {
  const aiffPath = `${outBase}.aiff`
  const oggPath = `${outBase}.ogg`
  const voice = getSayVoice()

  await spawnAsync('say', ['-v', voice, '-o', aiffPath, text])
  await spawnAsync('ffmpeg', ['-y', '-i', aiffPath, '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', oggPath])
  // Clean up intermediate aiff
  await fs.promises.unlink(aiffPath).catch(() => {})
  return oggPath
}

/**
 * Generates a voice audio file from text.
 * Sanitizes the text, picks the engine, and returns the path to the audio file.
 * Caller is responsible for deleting the file after use.
 *
 * @param {string} rawText  Raw (possibly markdown) text
 * @returns {Promise<string>}  Absolute path to audio file (.mp3 or .ogg)
 */
async function generateAudio(rawText) {
  const text = sanitize(rawText)
  if (!text) throw new Error('El texto quedó vacío después de sanitizar')

  await ensureTempDir()
  const outBase = path.join(TTS_TEMP_DIR, `krak-tts-${uuidv4()}`)
  const engine = getTtsEngine()

  if (engine === 'say') {
    return _runSay(text, outBase)
  }

  if (engine === 'edge-tts') {
    return _runEdgeTts(text, outBase)
  }

  // auto: try edge-tts, fallback to say
  try {
    return await _runEdgeTts(text, outBase)
  } catch (err) {
    logger.warn(`edge-tts falló (${err.message}), usando say como fallback`)
    return _runSay(text, outBase)
  }
}

/**
 * Deletes a generated audio temp file. Never throws.
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function deleteAudio(filePath) {
  if (!filePath) return
  await fs.promises.unlink(filePath).catch(() => {})
}

/**
 * Probes available TTS engines.
 * @returns {Promise<{ engine: 'edge-tts'|'say'|null, voice: string }>}
 */
async function checkTTS() {
  const forceEngine = getTtsEngine()

  // Check edge-tts
  const edgeResult = spawnSync('edge-tts', ['--version'], { timeout: 5000, encoding: 'utf8' })
  const edgeTtsAvailable = edgeResult.error == null

  // say is always available on macOS
  const sayResult = spawnSync('say', ['--version'], { timeout: 3000, encoding: 'utf8' })
  const sayAvailable = sayResult.error == null

  if (forceEngine === 'edge-tts') {
    return edgeTtsAvailable
      ? { engine: 'edge-tts', voice: getEdgeVoice() }
      : { engine: null, voice: '' }
  }

  if (forceEngine === 'say') {
    return sayAvailable
      ? { engine: 'say', voice: getSayVoice() }
      : { engine: null, voice: '' }
  }

  // auto
  if (edgeTtsAvailable) return { engine: 'edge-tts', voice: getEdgeVoice() }
  if (sayAvailable)     return { engine: 'say', voice: getSayVoice() }
  return { engine: null, voice: '' }
}

module.exports = { generateAudio, deleteAudio, checkTTS, getSayVoice }
