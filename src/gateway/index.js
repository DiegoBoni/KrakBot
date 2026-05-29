'use strict'

const http       = require('http')
const logger     = require('../utils/logger')
const { handleRequest } = require('./routes')
const taskQueue  = require('./taskQueue')

function createGateway() {
  const port = parseInt(process.env.HTTP_PORT)
  if (!port) return null

  const host = process.env.HTTP_HOST || '127.0.0.1'
  const isLocalhost = host === '127.0.0.1' || host === 'localhost'

  if (!isLocalhost && !process.env.HTTP_API_KEY) {
    logger.error('Gateway: HTTP_HOST is not localhost but HTTP_API_KEY is not set — refusing to start (security risk)')
    return null
  }

  if (!process.env.HTTP_API_KEY) {
    logger.warn('Gateway: HTTP_API_KEY not set — gateway is bound to localhost only (no auth required)')
  }

  const server = http.createServer(handleRequest)

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Gateway: port ${port} already in use — HTTP gateway disabled`)
    } else {
      logger.error(`Gateway server error: ${err.message}`)
    }
  })

  server.listen(port, host, () => {
    logger.info(`🌐 HTTP Gateway listening on http://${host}:${port}`)
  })

  taskQueue.startCleanup()

  return {
    shutdown() {
      server.close()
      logger.info('HTTP Gateway shut down')
    },
  }
}

module.exports = { createGateway }
