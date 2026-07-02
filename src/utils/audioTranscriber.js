const { spawn } = require('child_process')
const https = require('https')
const fs = require('fs')
const path = require('path')
const logger = require('./logger')

const DEFAULT_TEMP_DIR = '/tmp/krakbot-audio'
const DEFAULT_MAX_SIZE_MB = 25
const DEFAULT_MODEL = 'mlx-community/whisper-base-mlx'
const DEFAULT_LANGUAGE = 'es'
const WHISPER_TIMEOUT_MS = 120_000
const FALLBACK_MODEL = process.env.WHISPER_FALLBACK_MODEL || 'base'

function getWhisperEngines() {
  return [
    {
      name: 'Whisper MLX',
      command: process.env.WHISPER_MLX_BIN || 'mlx_whisper',
      args: (audioPath, outputDir) => [
        audioPath,
        '--model', process.env.WHISPER_MODEL || DEFAULT_MODEL,
        '--language', process.env.WHISPER_LANGUAGE || DEFAULT_LANGUAGE,
        '--output-dir', outputDir,
        '--output-format', 'txt',
      ],
    },
    {
      name: 'Whisper OpenAI',
      command: process.env.WHISPER_FALLBACK_BIN || 'python3',
      args: (audioPath, outputDir) => [
        '-m', 'whisper',
        audioPath,
        '--model', FALLBACK_MODEL,
        '--language', process.env.WHISPER_LANGUAGE || DEFAULT_LANGUAGE,
        '--output_dir', outputDir,
        '--output_format', 'txt',
      ],
    },
  ]
}

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

    const cleanup = (err) => {
      file.close()
      fs.unlink(destPath, () => {})
      reject(err)
    }

    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        cleanup(new Error(`HTTP ${res.statusCode} al descargar el audio`))
        return
      }
      res.on('error', cleanup)
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
      file.on('error', cleanup)
    }).on('error', cleanup)
  })
}

function runWhisperEngine(engine, audioPath, outputDir) {
  return new Promise((resolve, reject) => {
    const args = engine.args(audioPath, outputDir)
    logger.debug(`Spawning: ${engine.command} ${args.join(' ')}`)

    let stdout = ''
    let stderr = ''
    let settled = false

    const child = spawn(engine.command, args, { shell: false })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2000)
      reject(new Error(`Timeout: ${engine.name} tardó más de 2 minutos.`))
    }, WHISPER_TIMEOUT_MS)

    child.stdout.on('data', (c) => { stdout += c.toString() })
    child.stderr.on('data', (c) => {
      stderr += c.toString()
      logger.debug(`[whisper] ${c.toString().trimEnd()}`)
    })
    child.stdin.end()

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err.code === 'ENOENT') {
        reject(Object.assign(
          new Error(`${engine.name} no está instalado o no está en PATH.`),
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
      if (code !== 0) {
        logger.error(`[${engine.name}] exit code ${code}\n${stderr}`)
        reject(Object.assign(
          new Error(`${engine.name} salió con error (código ${code}). ${stderr.slice(-200)}`),
          { isWhisperError: true, exitCode: code }
        ))
      } else {
        resolve({ stdout, stderr, code, engine: engine.name })
      }
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
  logger.debug(`[audio] transcribe start — fileId=${fileId}`)
  const fileInfo = await telegram.getFile(fileId)
  logger.debug(`[audio] getFile OK — path=${fileInfo.file_path} size=${fileInfo.file_size}`)

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
  logger.debug(`[audio] downloading to ${tempFile}`)
  await downloadFile(downloadUrl, tempFile)
  const stat = await fs.promises.stat(tempFile).catch(() => null)
  logger.debug(`[audio] download OK — size=${stat?.size ?? 'unknown'} bytes`)

  try {
    let lastError = null
    const engines = getWhisperEngines()

    for (let index = 0; index < engines.length; index += 1) {
      const engine = engines[index]
      try {
        const whisperResult = await runWhisperEngine(engine, tempFile, tempDir)

        let transcript = ''
        try {
          transcript = (await fs.promises.readFile(path.join(tempDir, `${baseName}.txt`), 'utf8')).trim()
        } catch {
          // no output file — treat as empty
        }

        if (!transcript) {
          lastError = Object.assign(
            new Error('No se pudo transcribir el audio. Verificá que haya voz clara en el mensaje.'),
            { isEmpty: true, engine: engine.name }
          )
          if (index < engines.length - 1) {
            logger.warn(`[${engine.name}] produjo salida vacía, intentando fallback`)
            continue
          }
          throw lastError
        }

        return {
          transcript,
          engine: whisperResult.engine,
          fallbackUsed: index > 0,
          primaryEngine: engines[0].name,
        }
      } catch (err) {
        lastError = err
        if (index < engines.length - 1 && (err?.isEnoent || err?.isWhisperError || err?.isEmpty)) {
          logger.warn(`[${engine.name}] falló, intentando fallback: ${err.message}`)
          continue
        }
        throw err
      }
    }

    throw lastError || new Error('No se pudo transcribir el audio.')
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
    const child = spawn(process.env.WHISPER_MLX_BIN || 'mlx_whisper', ['--help'], { shell: false })
    child.stdout.resume()
    child.stderr.resume()
    child.on('error', () => resolve({ found: false, latencyMs: Date.now() - start }))
    child.on('close', () => resolve({ found: true, latencyMs: Date.now() - start }))
  })
}

module.exports = { transcribe, ensureTempDir, checkWhisper }
