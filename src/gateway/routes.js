'use strict'

const { v4: uuidv4 }      = require('uuid')
const { apiKeyMiddleware } = require('./auth')
const { startSSE, writeEvent } = require('./sse')
const taskQueue            = require('./taskQueue')
const sessionManager       = require('../utils/sessionManager')
const { resolveAgent, getAgentInfo } = require('../agents/router')
const logger               = require('../utils/logger')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

function isAgentAllowed(agentKey) {
  const list = process.env.HTTP_AGENT_ALLOWLIST
  if (!list) return true
  return list.split(',').map(s => s.trim()).filter(Boolean).includes(agentKey)
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function handleHealth(req, res) {
  const { version } = require('../../package.json')
  json(res, 200, {
    status:   'ok',
    uptime_s: Math.floor(process.uptime()),
    version,
  })
}

async function handlePostSession(req, res) {
  let body = {}
  try { body = await readBody(req) }
  catch (err) { return json(res, err.status || 400, { error: err.message }) }

  const sessionId = `http:${uuidv4()}`
  const session   = sessionManager.getOrCreate(sessionId)

  if (body.agent) {
    const resolved = resolveAgent(body.agent) ?? body.agent
    if (getAgentInfo(resolved)) {
      sessionManager.setAgent(sessionId, resolved)
      session.agent = resolved
    }
  }

  json(res, 201, {
    session_id:  sessionId,
    agent:       session.agent,
    created_at:  new Date().toISOString(),
  })
}

async function handlePostMessage(req, res) {
  let body = {}
  try { body = await readBody(req) }
  catch (err) { return json(res, err.status || 400, { error: err.message }) }

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return json(res, 400, { error: 'message is required' })
  }

  const sessionId = body.session_id || `http:${uuidv4()}`
  const session   = sessionManager.getOrCreate(sessionId)

  let agentKey = session.agent
  if (body.agent) {
    const resolved = resolveAgent(body.agent) ?? body.agent
    if (!getAgentInfo(resolved)) {
      return json(res, 400, { error: `Unknown agent: "${body.agent}"` })
    }
    agentKey = resolved
  }

  if (!isAgentAllowed(agentKey)) {
    return json(res, 403, { error: `Agent "${agentKey}" is not in the allowlist` })
  }

  const task = taskQueue.create(sessionId, agentKey, body.message.trim())
  logger.info(`HTTP task ${task.id} created | session=${sessionId} agent=${agentKey}`)

  json(res, 202, {
    task_id:    task.id,
    session_id: sessionId,
    status:     'accepted',
  })
}

function handleGetTask(req, res, taskId) {
  const task = taskQueue.get(taskId)
  if (!task) return json(res, 404, { error: 'Task not found' })
  json(res, 200, task)
}

function handleTaskStream(req, res, taskId) {
  const task = taskQueue.getRaw(taskId)
  if (!task) return json(res, 404, { error: 'Task not found' })

  startSSE(res)

  if (task.status === 'done') {
    writeEvent(res, { type: 'done', output: task.output })
    res.end()
    return
  }

  if (task.status === 'failed' || task.status === 'cancelled') {
    writeEvent(res, { type: 'error', message: task.error || 'Task failed' })
    res.end()
    return
  }

  // Task is pending or running — register live listener
  const listener = (data) => {
    writeEvent(res, data)
    if (data.type === 'done' || data.type === 'error') {
      res.end()
    }
  }

  task._sseListeners.add(listener)

  req.on('close', () => {
    task._sseListeners.delete(listener)
  })
}

// ─── Main router ──────────────────────────────────────────────────────────────

function handleRequest(req, res) {
  const url  = req.url || '/'
  const path = url.split('?')[0]
  const { method } = req

  // Health — no auth
  if (method === 'GET' && path === '/health') {
    return handleHealth(req, res)
  }

  // All other routes require auth
  if (!apiKeyMiddleware(req, res)) return

  if (method === 'POST' && path === '/session') {
    return handlePostSession(req, res).catch(err => {
      logger.error(`POST /session error: ${err.message}`)
      json(res, 500, { error: 'Internal server error' })
    })
  }

  if (method === 'POST' && path === '/message') {
    return handlePostMessage(req, res).catch(err => {
      logger.error(`POST /message error: ${err.message}`)
      json(res, 500, { error: 'Internal server error' })
    })
  }

  // GET /task/:id/stream
  const streamMatch = path.match(/^\/task\/([^/]+)\/stream$/)
  if (method === 'GET' && streamMatch) {
    return handleTaskStream(req, res, streamMatch[1])
  }

  // GET /task/:id
  const taskMatch = path.match(/^\/task\/([^/]+)$/)
  if (method === 'GET' && taskMatch) {
    return handleGetTask(req, res, taskMatch[1])
  }

  json(res, 404, { error: 'Not found' })
}

module.exports = { handleRequest }
