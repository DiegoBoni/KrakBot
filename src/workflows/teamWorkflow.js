'use strict'

const logger        = require('../utils/logger')
const teamManager   = require('../utils/teamManager')
const taskManager   = require('../utils/taskManager')
const { dispatchWithRole } = require('../agents/router')
const customAgentManager   = require('../utils/customAgentManager')

const MAX_COORDINATOR_RETRIES = 1

// ─── Live dialog logger ────────────────────────────────────────────────────────

async function dialogLog(taskId, telegram, entry) {
  taskManager.appendDialogLog(taskId, entry)
  const task = taskManager.get(taskId)
  if (!task?.liveView) return
  const icon = entry.role === 'coordinator' ? '🧠' : entry.role === 'reviewer' ? '🔍' : '👷'
  const header = `${icon} *${entry.agentName}*`
  const body = entry.body ? `\n${entry.body.slice(0, 600)}${entry.body.length > 600 ? '\n_…_' : ''}` : ''
  await notify(telegram, task.notifyChatId, `${header}${body}`)
}

// ─── Prompt builders ───────────────────────────────────────────────────────────

function buildCoordinatorPrompt(team, task) {
  const workers = team.workers
    .map(wId => {
      const a = customAgentManager.get(wId)
      return a ? `- ${wId}: ${a.description ?? a.name}` : `- ${wId}: (agente no encontrado)`
    })
    .join('\n')

  return (
    `Sos el coordinador del equipo "${team.name}" (dominio: ${team.domain}).\n` +
    `Tu rol es analizar la tarea y asignarla al worker más adecuado.\n\n` +
    `Workers disponibles:\n${workers}\n\n` +
    `Tarea recibida: "${task.description}"\n\n` +
    `Respondé EXACTAMENTE con este JSON (sin texto extra, sin markdown):\n` +
    `{"assignTo":"worker-id","instruction":"instrucción específica y detallada para el worker"}`
  )
}

function buildWorkerPrompt(team, task, workerId, feedback) {
  const worker = customAgentManager.get(workerId)
  const workerName = worker ? `${worker.emoji ?? ''} ${worker.name}`.trim() : workerId

  let prompt =
    `Sos ${workerName} del equipo "${team.name}".\n` +
    `Tu coordinador te asignó esta tarea:\n\n` +
    `${task.coordinatorDecision}\n\n` +
    `Ejecutá la tarea y respondé con el resultado completo.`

  if (feedback) {
    prompt += `\n\nFEEDBACK DEL REVISOR (iteración ${task.iterations}):\n${feedback}\n\nCorregí y mejorá tu respuesta anterior basándote en este feedback.`
  }

  return prompt
}

function buildReviewerPrompt(team, task, workerId, output) {
  const worker = customAgentManager.get(workerId)
  const workerName = worker ? `${worker.emoji ?? ''} ${worker.name}`.trim() : workerId

  return (
    `Sos el revisor del equipo "${team.name}".\n\n` +
    `Tarea original: "${task.description}"\n\n` +
    `Output del worker ${workerName}:\n${output}\n\n` +
    `Evaluá el output. Respondé EXACTAMENTE en uno de estos formatos (sin texto extra):\n` +
    `APPROVED: [breve comentario de aprobación]\n` +
    `CHANGES: [descripción detallada de qué falta o qué corregir]`
  )
}

function parseCoordinatorResponse(text) {
  // Strip markdown code fences if present
  const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    if (typeof obj.assignTo === 'string' && typeof obj.instruction === 'string') return obj
  } catch { /* ignore */ }
  return null
}

function parseReviewResponse(text) {
  const clean = text.trim()
  if (/^APPROVED:/i.test(clean)) {
    return { decision: 'approved', comment: clean.replace(/^APPROVED:\s*/i, '').trim() }
  }
  if (/^CHANGES:/i.test(clean)) {
    return { decision: 'changes_requested', comment: clean.replace(/^CHANGES:\s*/i, '').trim() }
  }
  // Fallback: if the reviewer says something without the exact prefix, treat as approved
  logger.warn(`teamWorkflow: ambiguous reviewer response — treating as approved: "${clean.slice(0, 100)}"`)
  return { decision: 'approved', comment: clean.slice(0, 200) }
}

// ─── Notifications ─────────────────────────────────────────────────────────────

async function notify(telegram, chatId, text, extra = {}) {
  try {
    return await telegram.sendMessage(chatId, text, { parse_mode: 'Markdown', ...extra })
  } catch (err) {
    logger.warn(`teamWorkflow: notify failed — ${err.message}`)
    return null
  }
}

function workerName(workerId) {
  const a = customAgentManager.get(workerId)
  return a ? `${a.emoji ?? ''}${a.name}`.trim() : workerId
}

function reviewButtonsKeyboard(taskId) {
  return {
    inline_keyboard: [[
      { text: '✅ Aprobar', callback_data: `team_review_approve:${taskId}` },
      { text: '🔄 Pedir cambios', callback_data: `team_review_changes:${taskId}` },
    ]],
  }
}

function taskDetailKeyboard(taskId) {
  return {
    inline_keyboard: [[
      { text: '📋 Ver detalle', callback_data: `team_task_detail:${taskId}` },
      { text: '❌ Cancelar', callback_data: `team_task_cancel:${taskId}` },
    ]],
  }
}

// ─── Main workflow ─────────────────────────────────────────────────────────────

/**
 * Runs the full coordinator → worker → reviewer cycle for a task.
 * Called fire-and-forget from handleCreateTask — all errors are caught internally.
 *
 * @param {string} taskId
 * @param {import('telegraf').Telegram} telegram
 */
async function runTask(taskId, telegram) {
  const task = taskManager.get(taskId)
  if (!task) { logger.error(`teamWorkflow.runTask: task ${taskId} not found`); return }

  const team = teamManager.get(task.teamId)
  if (!team) {
    taskManager.transition(taskId, 'failed', { by: 'system', note: 'Team not found' })
    await notify(telegram, task.notifyChatId, `❌ Team \`${task.teamId}\` no encontrado. Tarea cancelada.`)
    return
  }

  const controller = new AbortController()
  const { signal }  = controller

  // Store cancel function on the task for external cancellation
  _runningTasks.set(taskId, controller)

  try {
    // ── STEP 1: COORDINATOR ──────────────────────────────────────────────────
    await notify(telegram, task.notifyChatId,
      `📋 *[${team.name}]* Coordinando tarea *#${task.id}*...\n_${task.title}_`,
      { reply_markup: taskDetailKeyboard(taskId) }
    )

    let coordResult = null
    for (let attempt = 0; attempt <= MAX_COORDINATOR_RETRIES; attempt++) {
      try {
        const coordPrompt = buildCoordinatorPrompt(team, task)
        const raw = await dispatchWithRole(team.coordinator, coordPrompt, signal)
        coordResult = parseCoordinatorResponse(raw)
        if (coordResult) break
        if (attempt < MAX_COORDINATOR_RETRIES) {
          logger.warn(`teamWorkflow: coordinator JSON parse failed (attempt ${attempt + 1}), retrying...`)
        }
      } catch (err) {
        if (signal.aborted) { _cleanup(taskId); return }
        logger.warn(`teamWorkflow: coordinator error (attempt ${attempt + 1}): ${err.message}`)
      }
    }

    if (!coordResult) {
      taskManager.transition(taskId, 'failed', { by: team.coordinator, note: 'Coordinator returned invalid JSON' })
      await notify(telegram, task.notifyChatId, `❌ *#${task.id}* — El coordinator no pudo asignar la tarea.`)
      _cleanup(taskId); return
    }

    // Validate worker exists
    if (!team.workers.includes(coordResult.assignTo)) {
      // Coordinator picked an invalid worker — assign to first available
      logger.warn(`teamWorkflow: coordinator chose "${coordResult.assignTo}" not in workers list, falling back to first worker`)
      coordResult.assignTo = team.workers[0]
    }

    taskManager.setCoordinatorDecision(taskId, coordResult.assignTo, coordResult.instruction)
    taskManager.transition(taskId, 'assigned', { by: team.coordinator })
    taskManager.transition(taskId, 'in_progress', { by: coordResult.assignTo })

    const assignedWorker = coordResult.assignTo
    await dialogLog(taskId, telegram, {
      role: 'coordinator',
      agentName: workerName(team.coordinator),
      body: `→ asigna a *${workerName(assignedWorker)}*\n_${coordResult.instruction}_`,
    })
    await notify(telegram, task.notifyChatId,
      `📋 *[${team.name}]* ${workerName(team.coordinator)} asignó a *${workerName(assignedWorker)}*\n_#${task.id}: ${task.title}_`
    )

    // ── STEP 2 + 3: WORKER ↔ REVIEWER LOOP ────────────────────────────────
    let prevFeedback = null
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal.aborted) { _cleanup(taskId); return }

      // Worker step
      const workerPrompt = buildWorkerPrompt(team, task, assignedWorker, prevFeedback)
      let workerOutput
      try {
        workerOutput = await dispatchWithRole(assignedWorker, workerPrompt, signal)
      } catch (err) {
        if (signal.aborted) { _cleanup(taskId); return }
        taskManager.transition(taskId, 'failed', { by: assignedWorker, note: err.message })
        await notify(telegram, task.notifyChatId, `❌ *#${task.id}* — Error en worker \`${assignedWorker}\`: ${err.message}`)
        _cleanup(taskId); return
      }

      taskManager.setWorkerOutput(taskId, workerOutput)
      taskManager.transition(taskId, 'in_review', { by: assignedWorker })
      await dialogLog(taskId, telegram, {
        role: 'worker',
        agentName: workerName(assignedWorker),
        body: workerOutput,
      })

      // Review step
      if (team.reviewMode === 'none' || !team.reviewer) {
        // No review — done
        taskManager.transition(taskId, 'done', { by: 'system', note: 'reviewMode: none' })
        const preview = workerOutput.slice(0, 800) + (workerOutput.length > 800 ? '…' : '')
        await notify(telegram, task.notifyChatId,
          `✅ *[${team.name}]* Tarea *#${task.id}* completada\n\n${preview}`,
          { reply_markup: taskDetailKeyboard(taskId) }
        )
        break
      }

      if (team.reviewMode === 'manual') {
        taskManager.transition(taskId, 'awaiting_user_review', { by: 'system' })
        const preview = workerOutput.slice(0, 1200) + (workerOutput.length > 1200 ? '…' : '')
        await notify(telegram, task.notifyChatId,
          `👤 *[${team.name}]* Output de *${workerName(assignedWorker)}* listo para revisión\n\n` +
          `*Tarea #${task.id}:* _${task.title}_\n\n${preview}`,
          { reply_markup: reviewButtonsKeyboard(taskId) }
        )
        break  // Workflow suspends — resumeAfterUserReview() takes over
      }

      // Auto review
      await notify(telegram, task.notifyChatId,
        `🔍 *[${team.name}]* ${workerName(team.reviewer)} revisando *#${task.id}*...`
      )

      let reviewResult
      try {
        const reviewPrompt = buildReviewerPrompt(team, task, assignedWorker, workerOutput)
        const raw = await dispatchWithRole(team.reviewer, reviewPrompt, signal)
        reviewResult = parseReviewResponse(raw)
      } catch (err) {
        if (signal.aborted) { _cleanup(taskId); return }
        // Review failed — treat as approved to not block the task
        logger.warn(`teamWorkflow: reviewer error, treating as approved: ${err.message}`)
        reviewResult = { decision: 'approved', comment: '(reviewer error — auto-approved)' }
      }

      taskManager.setReviewDecision(taskId, reviewResult.decision, reviewResult.comment, team.reviewer)
      await dialogLog(taskId, telegram, {
        role: 'reviewer',
        agentName: workerName(team.reviewer),
        body: `${reviewResult.decision === 'approved' ? '✅ APROBADO' : '🔄 CAMBIOS'}: ${reviewResult.comment}`,
      })

      if (reviewResult.decision === 'approved') {
        taskManager.transition(taskId, 'done', { by: team.reviewer })
        const preview = workerOutput.slice(0, 800) + (workerOutput.length > 800 ? '…' : '')
        await notify(telegram, task.notifyChatId,
          `✅ *[${team.name}]* Tarea *#${task.id}* aprobada por *${workerName(team.reviewer)}*\n\n${preview}`,
          { reply_markup: taskDetailKeyboard(taskId) }
        )
        break
      }

      // Changes requested
      taskManager.incrementIterations(taskId)
      const freshTask = taskManager.get(taskId)

      const maxIter = team.maxReviewIterations
      if (maxIter > 0 && freshTask.iterations >= maxIter) {
        // Escalate to user
        taskManager.transition(taskId, 'awaiting_user_review', { by: team.reviewer, note: 'max iterations reached' })
        const preview = workerOutput.slice(0, 800) + (workerOutput.length > 800 ? '…' : '')
        await notify(telegram, task.notifyChatId,
          `⚠️ *[${team.name}]* Tarea *#${task.id}* alcanzó el límite de ${maxIter} revisiones.\n` +
          `El reviewer pide: _${reviewResult.comment}_\n\n` +
          `Output actual:\n${preview}`,
          { reply_markup: reviewButtonsKeyboard(taskId) }
        )
        break
      }

      taskManager.transition(taskId, 'changes_requested', { by: team.reviewer, note: reviewResult.comment })
      taskManager.transition(taskId, 'in_progress', { by: 'system', note: 'retry after feedback' })
      prevFeedback = reviewResult.comment
      await notify(telegram, task.notifyChatId,
        `🔄 *[${team.name}]* *${workerName(team.reviewer)}* pide cambios en *#${task.id}* (intento ${freshTask.iterations + 1})\n` +
        `_${reviewResult.comment.slice(0, 200)}_`
      )
    }
  } catch (err) {
    if (signal.aborted) { _cleanup(taskId); return }
    logger.error(`teamWorkflow.runTask: unhandled error for task ${taskId}: ${err.message}`)
    try {
      taskManager.transition(taskId, 'failed', { by: 'system', note: err.message })
    } catch { /* already in terminal state */ }
    await notify(telegram, task.notifyChatId, `❌ Error inesperado en tarea *#${taskId}*: ${err.message}`)
  } finally {
    _cleanup(taskId)
  }
}

// ─── Resume after manual review ────────────────────────────────────────────────

/**
 * Called when the user presses Approve or Pedir Cambios on a manual review message.
 * @param {string} taskId
 * @param {'approved'|'changes_requested'} decision
 * @param {string|null} comment  — required if decision === 'changes_requested'
 * @param {import('telegraf').Telegram} telegram
 */
async function resumeAfterUserReview(taskId, decision, comment, telegram) {
  const task = taskManager.get(taskId)
  if (!task) return
  if (task.status !== 'awaiting_user_review') return

  const team = teamManager.get(task.teamId)
  if (!team) return

  taskManager.setReviewDecision(taskId, decision, comment, 'user')

  if (decision === 'approved') {
    taskManager.transition(taskId, 'done', { by: 'user' })
    await notify(telegram, task.notifyChatId,
      `✅ *[${team.name}]* Tarea *#${task.id}* aprobada manualmente.`
    )
    return
  }

  // Changes requested — re-run worker step
  taskManager.incrementIterations(taskId)
  taskManager.transition(taskId, 'changes_requested', { by: 'user', note: comment })
  taskManager.transition(taskId, 'in_progress', { by: 'system', note: 'retry after user feedback' })

  await notify(telegram, task.notifyChatId,
    `🔄 *[${team.name}]* Retomando tarea *#${task.id}* con feedback del usuario...\n_${comment?.slice(0, 200) ?? ''}_`
  )

  // Reload task state (iterations updated) and re-run from worker step
  const freshTask = taskManager.get(taskId)
  const workerPrompt = buildWorkerPrompt(team, freshTask, freshTask.assignedTo, comment)

  // Re-entry: create a new controller and continue
  const controller = new AbortController()
  _runningTasks.set(taskId, controller)
  const { signal } = controller

  try {
    const workerOutput = await dispatchWithRole(freshTask.assignedTo, workerPrompt, signal)
    taskManager.setWorkerOutput(taskId, workerOutput)
    taskManager.transition(taskId, 'in_review', { by: freshTask.assignedTo })

    if (team.reviewMode !== 'auto' || !team.reviewer) {
      taskManager.transition(taskId, 'awaiting_user_review', { by: 'system' })
      const preview = workerOutput.slice(0, 1200) + (workerOutput.length > 1200 ? '…' : '')
      await notify(telegram, task.notifyChatId,
        `👤 *[${team.name}]* Output actualizado listo para revisión\n\n${preview}`,
        { reply_markup: reviewButtonsKeyboard(taskId) }
      )
      return
    }

    // Auto-review the new output
    const reviewPrompt = buildReviewerPrompt(team, freshTask, freshTask.assignedTo, workerOutput)
    const raw = await dispatchWithRole(team.reviewer, reviewPrompt, signal)
    const reviewResult = parseReviewResponse(raw)
    taskManager.setReviewDecision(taskId, reviewResult.decision, reviewResult.comment, team.reviewer)

    if (reviewResult.decision === 'approved') {
      taskManager.transition(taskId, 'done', { by: team.reviewer })
      const preview = workerOutput.slice(0, 800) + (workerOutput.length > 800 ? '…' : '')
      await notify(telegram, task.notifyChatId,
        `✅ *[${team.name}]* Tarea *#${task.id}* completada\n\n${preview}`,
        { reply_markup: taskDetailKeyboard(taskId) }
      )
    } else {
      taskManager.transition(taskId, 'awaiting_user_review', { by: team.reviewer })
      const preview = workerOutput.slice(0, 800) + (workerOutput.length > 800 ? '…' : '')
      await notify(telegram, task.notifyChatId,
        `🔄 *[${team.name}]* El revisor pide más cambios en *#${task.id}*\n_${reviewResult.comment}_\n\n${preview}`,
        { reply_markup: reviewButtonsKeyboard(taskId) }
      )
    }
  } catch (err) {
    if (!signal.aborted) {
      taskManager.transition(taskId, 'failed', { by: 'system', note: err.message })
      await notify(telegram, task.notifyChatId, `❌ Error en tarea *#${taskId}*: ${err.message}`)
    }
  } finally {
    _cleanup(taskId)
  }
}

// ─── Cancellation ──────────────────────────────────────────────────────────────

const _runningTasks = new Map()  // taskId → AbortController

function cancelRunning(taskId) {
  const ctrl = _runningTasks.get(taskId)
  if (ctrl) { ctrl.abort(); _runningTasks.delete(taskId) }
}

function _cleanup(taskId) {
  _runningTasks.delete(taskId)
}

module.exports = { runTask, resumeAfterUserReview, cancelRunning }
