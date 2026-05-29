'use strict'

const fs = require('fs')
const path = require('path')

const ENV_PATH = path.resolve(process.cwd(), '.env')

function readEnv() {
  const result = {}
  try {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
    }
  } catch {}
  return result
}

// Upserts keys in the .env file preserving all other content.
// - If a key exists (even commented), it gets uncommented and updated.
// - If a key doesn't exist, it's appended at the end under an HTTP Gateway block.
function upsertEnvKeys(updates) {
  let content = ''
  try { content = fs.readFileSync(ENV_PATH, 'utf8') } catch {}

  const lines = content.split('\n')

  for (const [key, value] of Object.entries(updates)) {
    const activeRe  = new RegExp(`^(${key}\\s*=)(.*)$`)
    const commentRe = new RegExp(`^#\\s*(${key}\\s*=)(.*)$`)

    let found = false
    for (let i = 0; i < lines.length; i++) {
      if (activeRe.test(lines[i])) {
        lines[i] = `${key}=${value}`
        found = true
        break
      }
      if (commentRe.test(lines[i])) {
        lines[i] = `${key}=${value}`
        found = true
        break
      }
    }

    if (!found) {
      lines.push(`${key}=${value}`)
    }
  }

  // Ensure HTTP Gateway comment header exists before first HTTP_ key if we added any
  const newContent = lines.join('\n')
  fs.writeFileSync(ENV_PATH, newContent, 'utf8')
}

module.exports = { readEnv, upsertEnvKeys }
