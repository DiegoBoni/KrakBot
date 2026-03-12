/**
 * ttsService.js
 * Text-to-speech engine with edge-tts (primary) and macOS say (fallback).
 * Always produces OGG Opus output — required by Telegram sendVoice.
 */

const { spawn, spawnSync } = require('child_process')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')
const { sanitize } = require('./textSanitizer')
const logger = require('./logger')

const TTS_TEMP_DIR = '/tmp/krak-tts'
const TTS_TIMEOUT_MS = 30_000

// edge-tts voice pairs (Argentine Spanish preferred)
const EDGE_VOICES = {
  masc: 'es-AR-TomasNeural',
  fem:  'es-AR-ElenaNeural',
}

// Curated voice catalog by language — shown in the Telegram voice picker
const VOICE_CATALOG = [
  { lang: '🇦🇷 Español (Argentina)', voices: [
    { id: 'es-AR-TomasNeural',    label: 'Tomás',     gender: 'masc' },
    { id: 'es-AR-ElenaNeural',    label: 'Elena',     gender: 'fem'  },
  ]},
  { lang: '🇪🇸 Español (España)', voices: [
    { id: 'es-ES-AlvaroNeural',   label: 'Álvaro',    gender: 'masc' },
    { id: 'es-ES-ElviraNeural',   label: 'Elvira',    gender: 'fem'  },
  ]},
  { lang: '🇲🇽 Español (México)', voices: [
    { id: 'es-MX-JorgeNeural',    label: 'Jorge',     gender: 'masc' },
    { id: 'es-MX-DaliaNeural',    label: 'Dalia',     gender: 'fem'  },
  ]},
  { lang: '🇺🇸 English (US)', voices: [
    { id: 'en-US-GuyNeural',      label: 'Guy',       gender: 'masc' },
    { id: 'en-US-JennyNeural',    label: 'Jenny',     gender: 'fem'  },
  ]},
  { lang: '🇬🇧 English (UK)', voices: [
    { id: 'en-GB-RyanNeural',     label: 'Ryan',      gender: 'masc' },
    { id: 'en-GB-SoniaNeural',    label: 'Sonia',     gender: 'fem'  },
  ]},
  { lang: '🇧🇷 Português (Brasil)', voices: [
    { id: 'pt-BR-AntonioNeural',  label: 'Antônio',   gender: 'masc' },
    { id: 'pt-BR-FranciscaNeural',label: 'Francisca', gender: 'fem'  },
  ]},
  { lang: '🇵🇹 Português (Portugal)', voices: [
    { id: 'pt-PT-DuarteNeural',   label: 'Duarte',    gender: 'masc' },
    { id: 'pt-PT-RaquelNeural',   label: 'Raquel',    gender: 'fem'  },
  ]},
  { lang: '🇫🇷 Français', voices: [
    { id: 'fr-FR-HenriNeural',    label: 'Henri',     gender: 'masc' },
    { id: 'fr-FR-DeniseNeural',   label: 'Denise',    gender: 'fem'  },
  ]},
  { lang: '🇩🇪 Deutsch', voices: [
    { id: 'de-DE-ConradNeural',   label: 'Conrad',    gender: 'masc' },
    { id: 'de-DE-KatjaNeural',    label: 'Katja',     gender: 'fem'  },
  ]},
  { lang: '🇮🇹 Italiano', voices: [
    { id: 'it-IT-DiegoNeural',    label: 'Diego',     gender: 'masc' },
    { id: 'it-IT-ElsaNeural',     label: 'Elsa',      gender: 'fem'  },
  ]},
  { lang: '🇯🇵 日本語', voices: [
    { id: 'ja-JP-KeitaNeural',    label: 'Keita',     gender: 'masc' },
    { id: 'ja-JP-NanamiNeural',   label: 'Nanami',    gender: 'fem'  },
  ]},
  { lang: '🇨🇳 中文 (普通话)', voices: [
    { id: 'zh-CN-YunxiNeural',    label: 'Yunxi',     gender: 'masc' },
    { id: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao',  gender: 'fem'  },
  ]},
]

// say voice priority lists for gender detection
const SAY_MASC_VOICES = ['Reed', 'Grandpa', 'Rocko', 'Eddy']
const SAY_FEM_VOICES  = ['Paulina', 'Mónica', 'Monica', 'Shelley', 'Flo', 'Grandma', 'Sandy']

// Cache detected say voices per gender
const _sayVoiceCache = { masc: null, fem: null }

function getTtsEngine() {
  return process.env.TTS_ENGINE || 'auto'
}

// Speech rate multiplier — change here to adjust speed (1.0 = normal, 1.2 = 20% faster)
const TTS_RATE     = 1.2
const TTS_EDGE_RATE = `+${Math.round((TTS_RATE - 1) * 100)}%`  // '+20%'
const TTS_SAY_WPM  = Math.round(175 * TTS_RATE)                 // 210

function getTtsRate() {
  return { edgeRate: TTS_EDGE_RATE, sayWpm: TTS_SAY_WPM }
}

/**
 * Returns the edge-tts voice name for a given gender.
 * Falls back to env TTS_VOICE if set (overrides gender selection).
 * @param {'masc'|'fem'} gender
 * @returns {string}
 */
function getEdgeVoice(gender) {
  if (process.env.TTS_VOICE) return process.env.TTS_VOICE
  return EDGE_VOICES[gender] ?? EDGE_VOICES.masc
}

/**
 * Detects the best available `say` voice for a given gender.
 * Result is cached after first call.
 * @param {'masc'|'fem'} gender
 * @returns {string}
 */
function getSayVoice(gender = 'masc') {
  if (_sayVoiceCache[gender]) return _sayVoiceCache[gender]

  const priorityList = gender === 'fem' ? SAY_FEM_VOICES : SAY_MASC_VOICES
  const fallback = gender === 'fem' ? 'Paulina' : 'Reed'

  try {
    const result = spawnSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 5000 })
    const voices = result.stdout || ''
    for (const name of priorityList) {
      // Match voice name at start of line (may include locale in parens)
      if (new RegExp(`^${name}\\b`, 'm').test(voices)) {
        _sayVoiceCache[gender] = name
        return name
      }
    }
  } catch {}

  _sayVoiceCache[gender] = fallback
  return fallback
}

/**
 * Ensures the TTS temp directory exists.
 */
async function ensureTempDir() {
  await fs.promises.mkdir(TTS_TEMP_DIR, { recursive: true })
}

/**
 * Runs a command via spawn. Resolves on exit 0, rejects on error/timeout.
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
 * Generates OGG Opus audio using edge-tts → ffmpeg.
 * Telegram sendVoice requires OGG Opus; MP3 is rejected as a voice note.
 *
 * @param {string} text      Pre-sanitized text
 * @param {string} outBase   Base path without extension
 * @param {'masc'|'fem'} gender
 * @returns {Promise<string>}  Path to .ogg file
 */
async function _runEdgeTts(text, outBase, gender) {
  const mp3Path = `${outBase}.mp3`
  const oggPath = `${outBase}.ogg`
  const voice = getEdgeVoice(gender)
  const { edgeRate } = getTtsRate()

  await spawnAsync('edge-tts', ['-t', text, '-v', voice, `--rate=${edgeRate}`, '--write-media', mp3Path])
  // Convert to OGG Opus (required by Telegram sendVoice)
  await spawnAsync('ffmpeg', ['-y', '-i', mp3Path, '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', oggPath])
  await fs.promises.unlink(mp3Path).catch(() => {})
  return oggPath
}

/**
 * Generates OGG Opus audio using macOS `say` → ffmpeg.
 *
 * @param {string} text      Pre-sanitized text
 * @param {string} outBase   Base path without extension
 * @param {'masc'|'fem'} gender
 * @returns {Promise<string>}  Path to .ogg file
 */
async function _runSay(text, outBase, gender) {
  const aiffPath = `${outBase}.aiff`
  const oggPath  = `${outBase}.ogg`
  const voice    = getSayVoice(gender)
  const { sayWpm } = getTtsRate()

  await spawnAsync('say', ['-v', voice, '-r', String(sayWpm), '-o', aiffPath, text])
  await spawnAsync('ffmpeg', ['-y', '-i', aiffPath, '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', oggPath])
  await fs.promises.unlink(aiffPath).catch(() => {})
  return oggPath
}

/**
 * Generates a voice audio file (OGG Opus) from text.
 * Sanitizes the text, picks the engine, and returns the path to the .ogg file.
 * Caller must delete the file after use (via deleteAudio).
 *
 * @param {string} rawText           Raw (possibly markdown) text
 * @param {'masc'|'fem'} [gender]    Voice gender; defaults to 'masc'
 * @returns {Promise<string>}        Absolute path to .ogg file
 */
/**
 * Resolves a voice identifier (full voice name or gender shorthand) to { voice, gender }.
 * @param {string} voiceOrGender  Full name like 'es-AR-TomasNeural' or 'masc'/'fem'
 */
function resolveVoice(voiceOrGender = 'masc') {
  const isFullName = voiceOrGender.includes('-') && voiceOrGender.length > 6
  if (isFullName) {
    const entry = VOICE_CATALOG.flatMap(g => g.voices).find(v => v.id === voiceOrGender)
    return { voice: voiceOrGender, gender: entry?.gender ?? 'masc' }
  }
  const gender = voiceOrGender === 'fem' ? 'fem' : 'masc'
  return { voice: getEdgeVoice(gender), gender }
}

async function generateAudio(rawText, voiceOrGender = 'masc') {
  const text = sanitize(rawText)
  if (!text) throw new Error('El texto quedó vacío después de sanitizar')

  await ensureTempDir()
  const outBase = path.join(TTS_TEMP_DIR, `krak-tts-${uuidv4()}`)
  const engine = getTtsEngine()
  const { voice, gender } = resolveVoice(voiceOrGender)
  const { edgeRate } = getTtsRate()

  if (engine === 'say') {
    return _runSay(text, outBase, gender)
  }

  if (engine === 'edge-tts') {
    // Override voice directly in edge-tts call
    const mp3Path = `${outBase}.mp3`
    const oggPath = `${outBase}.ogg`
    try {
      await spawnAsync('edge-tts', ['-t', text, '-v', voice, `--rate=${edgeRate}`, '--write-media', mp3Path])
      await spawnAsync('ffmpeg', ['-y', '-i', mp3Path, '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', oggPath])
      await fs.promises.unlink(mp3Path).catch(() => {})
      return oggPath
    } catch (err) {
      await fs.promises.unlink(mp3Path).catch(() => {})
      throw err
    }
  }

  // auto: try edge-tts with resolved voice, fallback to say
  const mp3Path = `${outBase}.mp3`
  const oggPath = `${outBase}.ogg`
  try {
    await spawnAsync('edge-tts', ['-t', text, '-v', voice, `--rate=${edgeRate}`, '--write-media', mp3Path])
    await spawnAsync('ffmpeg', ['-y', '-i', mp3Path, '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg', oggPath])
    await fs.promises.unlink(mp3Path).catch(() => {})
    return oggPath
  } catch (err) {
    await fs.promises.unlink(mp3Path).catch(() => {})
    logger.warn(`edge-tts falló (${err.message}), usando say como fallback`)
    return _runSay(text, outBase, gender)
  }
}

/**
 * Deletes a generated audio temp file. Never throws.
 * @param {string} filePath
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

  const edgeResult = spawnSync('edge-tts', ['--version'], { timeout: 5000, encoding: 'utf8' })
  const edgeTtsAvailable = edgeResult.error == null

  const sayResult = spawnSync('say', ['-v', '?'], { timeout: 3000, encoding: 'utf8' })
  const sayAvailable = sayResult.error == null

  if (forceEngine === 'edge-tts') {
    return edgeTtsAvailable
      ? { engine: 'edge-tts', voice: getEdgeVoice('masc') }
      : { engine: null, voice: '' }
  }

  if (forceEngine === 'say') {
    return sayAvailable
      ? { engine: 'say', voice: getSayVoice('masc') }
      : { engine: null, voice: '' }
  }

  // auto
  if (edgeTtsAvailable) return { engine: 'edge-tts', voice: getEdgeVoice('masc') }
  if (sayAvailable)     return { engine: 'say', voice: getSayVoice('masc') }
  return { engine: null, voice: '' }
}

module.exports = { generateAudio, deleteAudio, checkTTS, getSayVoice, getEdgeVoice, VOICE_CATALOG }
