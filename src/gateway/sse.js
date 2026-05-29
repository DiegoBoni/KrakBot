'use strict'

function startSSE(res) {
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write('\n')
}

function writeEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

module.exports = { startSSE, writeEvent }
