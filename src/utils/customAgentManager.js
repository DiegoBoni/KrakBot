const fs = require('fs')
const path = require('path')
const logger = require('./logger')

const DATA_FILE = path.resolve(__dirname, '../../data/custom-agents.json')
const MAX_AGENTS = 20

let _agents = []

// ─── Boot ──────────────────────────────────────────────────────────────────────

function init() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
      fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, agents: [] }, null, 2))
      logger.info('customAgentManager: created data/custom-agents.json')
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const data = JSON.parse(raw)
    _agents = Array.isArray(data.agents) ? data.agents : []
    logger.info(`customAgentManager: loaded ${_agents.length} custom agent(s)`)
  } catch (err) {
    logger.error(`customAgentManager: init failed — ${err.message}`)
    _agents = []
  }
}

// ─── Persistence ───────────────────────────────────────────────────────────────

function _save() {
  const data = JSON.stringify({ version: 1, agents: _agents }, null, 2)
  fs.writeFileSync(DATA_FILE, data, 'utf8')
}

// ─── Name helpers ──────────────────────────────────────────────────────────────

function extractEmoji(name) {
  const match = name.match(/^\p{Emoji_Presentation}/u)
  return match ? match[0] : null
}

function generateId(name) {
  return name
    .replace(/^\p{Emoji_Presentation}\s*/u, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

function list() {
  return [..._agents]
}

function get(id) {
  return _agents.find(a => a.id === id) ?? null
}

function exists(id) {
  return _agents.some(a => a.id === id)
}

function create(def) {
  const emoji = extractEmoji(def.name) ?? '🤖'
  const id    = generateId(def.name)
  if (!id) throw new Error('Nombre inválido — no se pudo generar un ID')
  if (_agents.length >= MAX_AGENTS && !exists(id)) {
    throw new Error(`Límite de ${MAX_AGENTS} agentes alcanzado. Borrá uno con /delagent`)
  }

  const agent = {
    id,
    name: def.name.replace(/^\p{Emoji_Presentation}\s*/u, '').trim(),
    emoji,
    description: def.description,
    systemPrompt: def.systemPrompt,
    cli: def.cli,
    createdAt: new Date().toISOString(),
  }

  const idx = _agents.findIndex(a => a.id === id)
  if (idx !== -1) {
    _agents[idx] = agent
  } else {
    _agents.push(agent)
  }
  _save()
  return agent
}

function update(id, fields) {
  const idx = _agents.findIndex(a => a.id === id)
  if (idx === -1) return null
  _agents[idx] = { ..._agents[idx], ...fields }
  _save()
  return _agents[idx]
}

function remove(id) {
  const before = _agents.length
  _agents = _agents.filter(a => a.id !== id)
  if (_agents.length === before) return false
  _save()
  return true
}

module.exports = { init, list, get, exists, create, update, remove, generateId, extractEmoji }
