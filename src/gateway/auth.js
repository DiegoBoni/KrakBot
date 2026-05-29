'use strict'

function safeCompare(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function apiKeyMiddleware(req, res) {
  const expected = process.env.HTTP_API_KEY
  if (!expected) return true
  const provided = req.headers['x-api-key'] ?? ''
  if (!safeCompare(provided, expected)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return false
  }
  return true
}

module.exports = { apiKeyMiddleware }
