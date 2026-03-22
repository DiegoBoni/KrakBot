'use strict'

const path    = require('path')
const fs      = require('fs')
const winston = require('winston')

const LOG_DIR  = path.resolve(__dirname, '../../data/logs')
const LOG_FILE = path.join(LOG_DIR, 'audit.log')

// Ensure data/logs/ exists at require-time
fs.mkdirSync(LOG_DIR, { recursive: true })

const _logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: LOG_FILE }),
  ],
})

/**
 * Write a structured security event to data/logs/audit.log.
 * @param {string} event  - Event key (e.g. 'auth_denied', 'rate_limited')
 * @param {object} fields - Additional fields to include in the log entry
 */
function audit(event, fields = {}) {
  _logger.info({ event, ...fields })
}

module.exports = { audit }
