const { spawn } = require('child_process')
const https = require('https')
const fs = require('fs')
const path = require('path')
const logger = require('./logger')

const DEFAULT_TEMP_DIR = '/tmp/krakbot-audio'
const DEFAULT_MAX_SIZE_MB = 25
const DEFAULT_MODEL = 'base'
const DEFAULT_LANGUAGE = 'es'
const WHISPER_TIMEOUT_MS = 120_000

function getTempDir() {
  return process.env.AUDIO_TEMP_DIR || DEFAULT_TEMP_DIR
}

function getMaxSizeBytes() {
  const mb = parseFloat(process.env.MAX_AUDIO_SIZE_MB) || DEFAULT_MAX_SIZE_MB
  return mb * 1024 * 1024
}

async function ensureTempDir() {
  const dir = getTempDir()
  await fs.promises.mkdir(dir, { recursive: true })
  return dir
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)

    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close()
        fs.unlink(destPath, () => {})
        reject(new Error(`HTTP ${res.statusCode} al descargar el audio`))
        return
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
      file.on('error', (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err) })
    }).on('error', (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err) })
  })
}

function runWhisper(audioPath, outputDir) {
  const model = process.env.WHISPER_MODEL || DEFAULT_MODEL
  const language = process.env.WHISPER_LANGUAGE || DEFAULT_LANGUAGE

  return new Promise((resolve, reject) => {
    const args = [
      audioPath,
      '--model', model,
      '--language', language,
      '--output-dir', outputDir,
    ]
    logger.debug(`Spawning: mlx_whisper ${args.join(' ')}`)

    let stdout = ''
    let stderr = ''
    let settled = false

    const child = spawn('mlx_whisper', args, { shell: false })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000)
      reject(new Error('Timeout: mlx_whisper tardó más de 2 minutos.'))
    }, WHISPER_TIMEOUT_MS)

    child.stdout.on('data', (c) => { stdout += c.toString() })
    child.stderr.on('data', (c) => {
      stderr += c.toString()
      logger.debug(`[whisper] ${c.toString().slice(0, 120).trimEnd()}`)
    })
    child.stdin.end()

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err.code === 'ENOENT') {
        reject(Object.assign(
          new Error('mlx_whisper no está instalado o no está en PATH.'),
          { isEnoent: true }
        ))
      } else {
        reject(err)
      }
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

/**
 * Downloads and transcribes a Telegram audio/voice file.
 * Returns the transcript text.
 *
 * @param {import('telegraf').Telegram} telegram  Telegraf telegram instance
 * @param {string} fileId                         Telegram file_id
 * @returns {Promise<string>}
 */
async function transcribe(telegram, fileId) {
  const fileInfo = await telegram.getFile(fileId)

  const maxBytes = getMaxSizeBytes()
  if (fileInfo.file_size && fileInfo.file_size > maxBytes) {
    const maxMb = (maxBytes / 1024 / 1024).toFixed(0)
    throw Object.assign(
      new Error(`El audio supera el límite de ${maxMb} MB. Enviá un audio más corto.`),
      { isSizeLimit: true }
    )
  }

  const tempDir = await ensureTempDir()
  const ext = path.extname(fileInfo.file_path || '') || '.ogg'
  const baseName = `krak-audio-${Date.now()}`
  const tempFile = path.join(tempDir, `${baseName}${ext}`)

  const token = process.env.TELEGRAM_TOKEN
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`
  await downloadFile(downloadUrl, tempFile)

  try {
    await runWhisper(tempFile, tempDir)

    let transcript = ''

    // mlx_whisper outputs JSON by default; fall back to .txt if present
    try {
      const jsonContent = await fs.promises.readFile(path.join(tempDir, `${baseName}.json`), 'utf8')
      const parsed = JSON.parse(jsonContent)
      transcript = (parsed.text || parsed.segments?.map((s) => s.text).join(' ') || '').trim()
    } catch {
      try {
        transcript = (await fs.promises.readFile(path.join(tempDir, `${baseName}.txt`), 'utf8')).trim()
      } catch {
        // no output file — treat as empty
      }
    }

    if (!transcript) {
      throw Object.assign(
        new Error('No se pudo transcribir el audio. Verificá que haya voz clara en el mensaje.'),
        { isEmpty: true }
      )
    }

    return transcript
  } finally {
    // Always clean up temp files (audio + all whisper output formats)
    await fs.promises.unlink(tempFile).catch(() => {})
    for (const ext2 of ['.txt', '.json', '.srt', '.vtt', '.tsv']) {
      await fs.promises.unlink(path.join(tempDir, `${baseName}${ext2}`)).catch(() => {})
    }
  }
}

/**
 * Probe: checks if mlx_whisper is installed and returns latency.
 * @returns {Promise<{ found: boolean, latencyMs: number }>}
 */
async function checkWhisper() {
  const start = Date.now()
  return new Promise((resolve) => {
    const child = spawn('mlx_whisper', ['--help'], { shell: false })
    child.stdout.resume()
    child.stderr.resume()
    child.on('error', () => resolve({ found: false, latencyMs: Date.now() - start }))
    child.on('close', () => resolve({ found: true, latencyMs: Date.now() - start }))
  })
}

module.exports = { transcribe, ensureTempDir, checkWhisper }
