```
  _  __           _    ____        _
 | |/ /_ __ __ _ | | _| __ )  ___ | |_
 | ' /| '__/ _` || |/ /  _ \ / _ \| __|
 | . \| | | (_| ||   <| |_) | (_) | |_
 |_|\_\_|  \__,_||_|\_\____/ \___/ \__|

         🐙  ⚡
```

# KrakBot

> Gateway de Telegram hacia múltiples agentes de IA CLI — Claude Code, Gemini CLI y OpenAI Codex CLI.
> Un mensaje (o un archivo o una nota de voz), el agente que elijas, respuesta directo en el chat.
> Creá agentes personalizados, organizalos en equipos multi-agente, y dejá que un Root Agent los orqueste automáticamente.

---

## Instalación

### Mac / Linux — una línea

```bash
curl -fsSL https://raw.githubusercontent.com/DiegoBoni/KrakBot/main/bootstrap.sh | bash
```

Abre un wizard visual en el browser que te guía paso a paso:
verifica Node.js, instala dependencias, configura el token de Telegram,
detecta los CLIs de IA instalados y arranca el bot.

### Windows

1. Descargá el ZIP → **[KrakBot-main.zip](https://github.com/DiegoBoni/KrakBot/archive/refs/heads/main.zip)**
2. Extraé la carpeta
3. Clic derecho en `bootstrap.ps1` → **Ejecutar con PowerShell**

### Ya tenés Node.js instalado

```bash
git clone https://github.com/DiegoBoni/KrakBot
cd KrakBot
npm run setup
```

### Instalación manual (headless)

```bash
git clone https://github.com/DiegoBoni/KrakBot
cd KrakBot
cp .env.example .env   # editá con tu token y config
npm install
npm start
```

---

## Variables de entorno

| Variable                    | Default                            | Descripción                                                  |
|-----------------------------|------------------------------------|--------------------------------------------------------------|
| `TELEGRAM_TOKEN`            | —                                  | Token del bot desde @BotFather **(requerido)**               |
| `DEFAULT_AGENT`             | `claude`                           | Agente por defecto cuando no se especifica mención           |
| `AUTHORIZED_USERS`          | (vacío)                            | IDs de Telegram separados por coma; vacío = permitir a todos |
| `DEBUG`                     | `false`                            | Logs verbosos                                                |
| `CLAUDE_CLI_PATH`           | `claude`                           | Ruta o nombre del ejecutable de Claude Code                  |
| `GEMINI_CLI_PATH`           | `gemini`                           | Ruta o nombre del ejecutable de Gemini CLI                   |
| `CODEX_CLI_PATH`            | `codex`                            | Ruta o nombre del ejecutable de Codex CLI                    |
| `CLAUDE_MODEL`              | —                                  | Modelo específico para Claude (ej: `claude-sonnet-4-6`)      |
| `GEMINI_MODEL`              | —                                  | Modelo específico para Gemini                                |
| `CODEX_MODEL`               | —                                  | Modelo específico para Codex                                 |
| `MAX_RESPONSE_LENGTH`       | `4000`                             | Máximo de chars por mensaje antes de partir en chunks        |
| `SOUL_PATH`                 | `./data/SOUL.md`                   | Ruta al archivo de soul (personalidad del bot)               |
| `MEMORY_INJECT`             | `recent`                           | Modo de inyección de memorias: `recent` \| `all` \| `none`   |
| `MEMORY_INJECT_LIMIT`       | `2000`                             | Máximo de chars de memorias a inyectar en el contexto        |
| `HISTORY_WINDOW`            | `6`                                | Pares de mensajes a conservar en el historial de contexto    |
| `SESSION_TTL_HOURS`         | `0`                                | Horas de inactividad para expirar sesión (0 = nunca)         |
| `WHISPER_MODEL`             | `mlx-community/whisper-base-mlx`   | Modelo de Whisper para transcripción de audios               |
| `WHISPER_LANGUAGE`          | `es`                               | Idioma para Whisper (`es`, `en`, etc.)                       |
| `AUDIO_TEMP_DIR`            | `/tmp/krakbot-audio`               | Directorio temporal para archivos de audio                   |
| `MAX_AUDIO_SIZE_MB`         | `25`                               | Tamaño máximo de audio aceptado (en MB)                      |
| `ROOT_AGENT_CLI`            | `claude`                           | CLI que actúa como Root Agent para routing automático        |
| `GITHUB_REPO`               | `DiegoBoni/KrakBot`                | Repo para auto-update (`owner/repo`, vacío = deshabilitado)  |
| `GITHUB_BRANCH`             | `main`                             | Rama a monitorear para actualizaciones                       |
| `UPDATE_CHECK_INTERVAL_HOURS` | `24`                             | Intervalo entre chequeos de actualización (0 = deshabilitado)|
| `NOTIFY_CHAT_ID`            | —                                  | Chat ID para notificaciones (default: primer AUTHORIZED_USER)|
| `GITHUB_TOKEN`              | —                                  | Token GitHub para repos privados (opcional en repos públicos)|
| `PM2_APP_NAME`              | `krakbot`                          | Nombre de la app en PM2 para el restart automático           |

---

## Comandos del bot

### Agentes integrados

| Comando    | Descripción                                 |
|------------|---------------------------------------------|
| `/claude`  | Cambiar agente activo a Claude Code         |
| `/gemini`  | Cambiar agente activo a Gemini CLI          |
| `/codex`   | Cambiar agente activo a Codex CLI           |
| `/default` | Volver al agente por defecto                |
| `/agents`  | Listar todos los agentes disponibles        |
| `/setagent`| Activar un agente por su ID                 |

### Agentes personalizados

| Comando      | Descripción                                                 |
|--------------|-------------------------------------------------------------|
| `/newagent`  | Crear un agente personalizado con system prompt propio      |
| `/delagent`  | Borrar un agente personalizado                              |
| `/editagent` | Editar nombre, descripción, system prompt o CLI de un agente|

### Equipos multi-agente

| Comando               | Descripción                                                          |
|-----------------------|----------------------------------------------------------------------|
| `/buildteam`          | Wizard para crear un equipo con IA (coordinator + workers + reviewer)|
| `/teams`              | Listar todos los equipos creados                                     |
| `/delteam <id>`       | Eliminar un equipo                                                   |
| `/editteam <id>`      | Editar modo de review, heartbeat o máx. iteraciones de un equipo     |

### Tareas de equipos

| Comando                  | Descripción                                                     |
|--------------------------|-----------------------------------------------------------------|
| `/task <team-id> <desc>` | Crear y ejecutar una tarea en un equipo                         |
| `/tasks`                 | Ver tareas activas y completadas hoy                            |
| `/tasks all`             | Ver todo el historial (activas, completadas, fallidas, canceladas)|
| `/tasks <team-id>`       | Ver todas las tareas de un equipo específico                    |
| `/taskstatus <id>`       | Detalle completo de una tarea con historial de pasos            |
| `/canceltask <id>`       | Cancelar una tarea activa                                       |
| `/teamstatus <id>`       | Estado del equipo y sus tareas activas                          |

### Root Agent & auto-routing

| Comando      | Descripción                                                             |
|--------------|-------------------------------------------------------------------------|
| `/auto`      | Enviar una tarea al Root Agent para que elija el mejor agente o equipo  |
| `/automode`  | Activar/desactivar routing automático en todos los mensajes             |

### Sesión e historial

| Comando     | Descripción                                 |
|-------------|---------------------------------------------|
| `/session`  | Ver info de la sesión actual                |
| `/clear`    | Borrar historial de la conversación         |

### Soul & memoria

| Comando       | Descripción                                        |
|---------------|----------------------------------------------------|
| `/soul`       | Ver el system prompt (soul) activo                 |
| `/reloadsoul` | Recargar el soul desde el archivo                  |
| `/skip`       | Saltar el soul en la próxima respuesta             |
| `/remember`   | Guardar un dato en la memoria persistente del bot  |
| `/memories`   | Ver todas las memorias guardadas                   |
| `/forget`     | Borrar una memoria                                 |

### Voz y audio (TTS)

| Comando       | Descripción                                                         |
|---------------|---------------------------------------------------------------------|
| `/voicemode`  | Activar/desactivar modo voz: el bot responde con audio en vez de texto |
| `/ttsbutton`  | Activar/desactivar botón "🔊 Escuchar" al pie de cada respuesta        |
| `/listen`     | Escuchar el último mensaje del bot como audio                          |
| `/ttsvoice`   | Cambiar la voz TTS (selector por idioma)                               |

### Utilidades

| Comando    | Descripción                                 |
|------------|---------------------------------------------|
| `/start`   | Bienvenida e instrucciones                  |
| `/ayuda`   | Instrucciones de uso                        |
| `/ping`    | Health check de los agentes CLI             |
| `/update`  | Chequear actualizaciones disponibles        |

---

## Agentes personalizados

Los agentes personalizados son agentes especializados que creás vos con un system prompt propio. Se construyen sobre uno de los CLIs integrados (Claude, Gemini o Codex) y quedan disponibles para toda tu sesión.

### Crear un agente

```
/newagent
```

El bot te guía paso a paso:

1. **Nombre** — ej: `Python Expert` (podés incluir un emoji al principio)
2. **Descripción** — para que el Root Agent sepa en qué tareas usarlo
3. **System prompt** — las instrucciones completas del agente
4. **Voz TTS** — selector por idioma: elegís idioma y luego la voz específica (ej: Jenny en inglés US, Tomás en español AR). La voz se aplica automáticamente cada vez que activás ese agente.
5. **CLI base** — elegís Claude, Gemini o Codex

El agente queda disponible inmediatamente con un ID generado automáticamente (ej: `python-expert`).

> Los MCPs (herramientas externas como Gmail, GitHub, etc.) se configuran directamente en cada CLI — Claude con `claude mcp add`, Gemini con su config, etc. Todos los sub-agentes de ese CLI los heredan automáticamente.

### Usar un agente personalizado

**Activarlo para toda la sesión:**
```
/setagent python-expert
```
o desde `/agentes` → botón *Activar*.

**Mencionarlo en un solo mensaje:**
```
@python-expert escribí una función para ordenar una lista
```

**Una vez activo**, el agente persiste hasta que uses `/default`, `/claude`, `/gemini`, `/codex` u otro `/setagent`.

### Editar un agente

```
/editagent
```

Podés cambiar el nombre, la descripción, el system prompt o el CLI base.

### Borrar un agente

```
/delagent
```

Muestra la lista de agentes custom con confirmación antes de borrar.

---

## Equipos multi-agente

Los equipos permiten ejecutar tareas complejas con un flujo **Coordinator → Worker → Reviewer**. El coordinator analiza la tarea, la asigna al worker más adecuado, y un reviewer valida el resultado antes de entregarlo.

### Crear un equipo

```
/buildteam
```

El wizard de IA te guía paso a paso:

1. **Dominio** — elegís el área del equipo (desarrollo, marketing, productividad, legal, etc.)
2. **Objetivo** — describís en una oración qué tipo de tareas va a resolver
3. **Recomendación IA** — el bot genera la estructura completa (coordinator, workers, reviewer, system prompts)
4. **Confirmación** — podés aprobar, personalizar o pedir otra estructura
5. **Modelo por agente** — elegís Claude, Gemini o Codex para cada agente del equipo individualmente

El equipo y todos sus agentes quedan creados y disponibles inmediatamente.

### Ejecutar una tarea en un equipo

**Con comando:**
```
/task equipo-productividad organizá mi agenda de la semana
```

**Con mención directa** (igual que los agentes custom):
```
@equipo-productividad organizá mi agenda de la semana
```

**Con autoMode activo** — el Root Agent detecta automáticamente si la tarea corresponde a un equipo.

Al crear la tarea, el bot te ofrece:
- **👁 Ver diálogo interno** — activa el modo live: ves cada paso del flujo (coordinator → worker → reviewer) a medida que ocurre en tiempo real
- **❌ Cancelar** — cancela la tarea

### Flujo de una tarea

```
Tarea recibida
  → Coordinator analiza y asigna al worker más adecuado
  → Worker ejecuta la tarea con su system prompt
  → Reviewer evalúa el resultado
     ├── Aprobado → entrega el resultado final
     └── Cambios → el worker reintenta con el feedback
```

El modo de review se configura por equipo:
- `auto` — el reviewer es un agente IA
- `manual` — vos aprobás o pedís cambios
- `none` — sin revisión, el worker entrega directo

### Gestión de equipos

```
/teams              # listar todos los equipos
/teamstatus <id>    # ver estado y tareas activas de un equipo
/editteam <id>      # editar modo de review, heartbeat o máx. iteraciones
/delteam <id>       # eliminar un equipo
```

### Gestión de tareas

```
/tasks              # activas + completadas hoy
/tasks all          # todo el historial (activas, hechas, fallidas, canceladas)
/tasks <team-id>    # tareas de un equipo específico
/taskstatus <id>    # detalle completo con historial de pasos
/canceltask <id>    # cancelar tarea activa
```

---

## Root Agent & Auto-routing

El Root Agent lee la descripción de todos tus agentes personalizados y equipos, y elige automáticamente el más adecuado para cada tarea.

### Una sola tarea con routing automático

```
/auto escribí tests unitarios para este módulo
```

### Activar routing automático permanente

```
/automode
```

Con automode activado, **todos los mensajes** pasan primero por el Root Agent. Puede derivar a:
- Un agente personalizado (respuesta directa)
- Un equipo (flujo coordinator → worker → reviewer)
- El agente activo de la sesión (si ninguno aplica mejor)

El estado del automode se muestra en `/sesion` y se persiste entre reinicios.

---

## Text-to-Speech (TTS)

KrakBot puede responder con audio usando **edge-tts** (Microsoft Edge TTS, multiplataforma) con fallback a `say` en macOS.

### Modos de audio

| Modo         | Cómo activarlo   | Comportamiento                                                  |
|--------------|------------------|-----------------------------------------------------------------|
| voiceMode    | `/voicemode`     | El bot responde **solo con audio**, sin texto                   |
| ttsButton    | `/ttsbutton`     | El bot responde con texto + botón "🔊 Escuchar" al pie          |
| Bajo demanda | `/voz`           | Escuchás el último mensaje como audio en cualquier momento      |

> `voiceMode` y `ttsButton` son mutuamente excluyentes: activar uno desactiva el otro.

### Selector de voz

```
/ttsvoice
```

Muestra un selector en 2 pasos:
1. Elegís el **idioma** (12 idiomas disponibles)
2. Elegís la **voz** (masculina o femenina para ese idioma)

La voz queda guardada en tu sesión y persiste entre reinicios.

### Idiomas y voces disponibles

| Idioma                  | Voz masc        | Voz fem          |
|-------------------------|-----------------|------------------|
| 🇦🇷 Español (Argentina) | Tomás           | Elena            |
| 🇪🇸 Español (España)    | Álvaro          | Elvira           |
| 🇲🇽 Español (México)    | Jorge           | Dalia            |
| 🇺🇸 English (US)        | Guy             | Jenny            |
| 🇬🇧 English (UK)        | Ryan            | Sonia            |
| 🇧🇷 Português (Brasil)  | Antônio         | Francisca        |
| 🇵🇹 Português (Portugal)| Duarte          | Raquel           |
| 🇫🇷 Français            | Henri           | Denise           |
| 🇩🇪 Deutsch             | Conrad          | Katja            |
| 🇮🇹 Italiano            | Diego           | Elsa             |
| 🇯🇵 日本語               | Keita           | Nanami           |
| 🇨🇳 中文 (普通话)        | Yunxi           | Xiaoxiao         |

### Voz por agente

Al crear un agente con `/newagent` podés asignarle una voz propia. Cada vez que activás ese agente, su voz se aplica automáticamente a tu sesión.

### Notas de voz

Podés enviarle notas de voz al bot. El bot:
1. Transcribe el audio con **mlx_whisper** (Whisper local en Apple Silicon)
2. Pasa la transcripción al agente activo
3. Responde con audio (si `voiceMode` está ON) o con texto

### Variables de entorno TTS

| Variable     | Default  | Descripción                                                    |
|--------------|----------|----------------------------------------------------------------|
| `TTS_ENGINE` | `auto`   | Motor TTS: `auto` \| `edge-tts` \| `say`                      |
| `TTS_VOICE`  | —        | Forzar una voz específica de edge-tts (sobreescribe la sesión) |

### Dependencias TTS

- **edge-tts** (primario, multiplataforma): `pip install edge-tts`
- **ffmpeg** (requerido para conversión a OGG Opus): `brew install ffmpeg`
- **say** (fallback, solo macOS): viene incluido en macOS

---

## Archivos adjuntos

Podés enviarle imágenes, PDFs y archivos de texto/código directamente desde Telegram.

### Cómo usarlo

**Con caption (prompt incluido):**
Adjuntá el archivo y escribí la consulta como descripción del mensaje. El bot lo procesa de inmediato.

```
[foto de un diagrama] ¿Qué estructura de datos representa esto?
[archivo main.py]     Revisá si hay bugs en este código
[factura.pdf]         Extraé el total y el CUIT del emisor
```

**Sin caption:**
El archivo queda en espera. Tu próximo mensaje de texto lo usa como contexto.

```
[adjuntás codigo.js]          ← queda pendiente
"optimizá la función principal"  ← este mensaje lo recibe con el archivo
```

### Formatos soportados

| Tipo          | Extensiones / MIME                                | Agentes compatibles       |
|---------------|---------------------------------------------------|---------------------------|
| Imágenes      | jpg, jpeg, png, gif, webp, bmp, tiff, svg, ico    | Claude (y custom Claude)  |
| PDFs          | pdf                                               | Claude (y custom Claude)  |
| Texto / código| txt, md, csv, json, xml, yaml, html, css, js, ts, py, java, c, cpp, go, rs, rb, php, sh, sql… | Todos los agentes |

> Gemini y Codex solo soportan archivos de texto. Los archivos binarios (imágenes, PDFs) se rechazan con un aviso si el agente activo no es Claude.

### Límite de tamaño

Por defecto **20 MB** (configurable con `MAX_FILE_SIZE_MB` en el `.env`).
Telegram impone su propio límite de 20 MB para bots, por lo que valores mayores no tienen efecto práctico.

### Limpieza automática

Los archivos se eliminan del disco inmediatamente después de ser procesados. Un proceso de limpieza horario borra cualquier archivo huérfano con más de 1 hora de antigüedad.

---

## Menciones

Prefijá cualquier mensaje con `@id` para dirigirte a un agente o equipo específico en esa sola respuesta, sin cambiar el agente activo de la sesión:

```
@claude explicame esta función
@gem resumí este texto
@codex refactorizá este método
@python-expert optimizá esta función
@equipo-dev desarrollá el módulo de autenticación
```

Aliases de agentes integrados:

| Agente     | Aliases                  |
|------------|--------------------------|
| Claude     | `@claude`, `@cc`, `@c`   |
| Gemini     | `@gemini`, `@gem`, `@g`  |
| Codex      | `@codex`, `@gpt`, `@o`   |

Para agentes y equipos personalizados, usá su ID directamente: `@python-expert`, `@equipo-dev`, etc.

---

## Arquitectura

```
src/
├── agents/
│   ├── runner.js             # Wrapper genérico de child_process.spawn con timeout y heartbeat
│   ├── router.js             # Registro de agentes, dispatch, resolución de aliases y Root Agent
│   ├── claude.js             # Runner de Claude: inyecta historial de sesión como contexto
│   ├── gemini.js             # Runner de Gemini
│   └── codex.js              # Runner de Codex
├── bot/
│   ├── index.js              # Setup de Telegraf, registro de comandos, error handler
│   ├── handlers.js           # Handlers de comandos, mensajes, flows de agentes y equipos
│   └── middleware.js         # Middleware de autenticación (allowlist de usuarios)
├── utils/
│   ├── logger.js             # Logger Winston
│   ├── sessionManager.js     # Store de sesiones con persistencia a disco (TTL configurable)
│   ├── contextBuilder.js     # Construye el prompt final con soul, memorias e historial
│   ├── customAgentManager.js # CRUD de agentes personalizados (persiste en data/)
│   ├── teamManager.js        # CRUD de equipos multi-agente (persiste en data/)
│   ├── taskManager.js        # Estado y ciclo de vida de tareas (máquina de estados)
│   ├── heartbeatManager.js   # Notificaciones periódicas de progreso para tareas largas
│   ├── cliValidator.js       # Validación de binarios CLI al arranque
│   ├── audioTranscriber.js   # Transcripción de notas de voz con mlx_whisper (Whisper local)
│   ├── ttsService.js         # Text-to-speech: edge-tts (primario) + say (fallback), catálogo de voces
│   ├── textSanitizer.js      # Limpieza de markdown antes de enviar a TTS
│   ├── fileManager.js        # Descarga, validación, lectura y limpieza de archivos adjuntos
│   └── updateChecker.js      # Auto-updater desde GitHub
├── workflows/
│   ├── buildTeamWizard.js    # Wizard interactivo para crear equipos asistido por IA
│   └── teamWorkflow.js       # Orquestación del flujo coordinator → worker → reviewer
└── index.js                  # Entry point: arranque, validación, shutdown graceful

data/                         # Generado en runtime, excluido de git
├── sessions/                 # Sesiones persistidas por usuario (JSON)
├── uploads/                  # Archivos adjuntos temporales (se borran tras procesar)
├── custom-agents.json        # Definiciones de agentes personalizados
├── teams.json                # Definiciones de equipos multi-agente
└── team-tasks.json           # Historial de tareas
```

**Flujo de un mensaje:**

```
Telegram msg / archivo
  → middleware.js         (auth check)
  → handlers.js           (descarga archivo, extrae @alias, detecta flows activos o autoMode)
  → router.js             (Root Agent si autoMode → agente o equipo)

  Si agente:
    → custom agent / claude|gemini|codex.js
    → runner.js           (spawn CLI, timeout, heartbeat cada 30s)
    → respuesta en chunks ≤4000 chars → Telegram

  Si equipo:
    → teamWorkflow.runTask()
    → coordinator         (elige worker + instrucción específica)
    → worker              (ejecuta la tarea con su system prompt)
    → reviewer            (valida o pide cambios)
    → resultado final → Telegram
```

---

## Seguridad

- Los subprocesos se spawnean **sin shell** (`shell: false`) para evitar inyección de comandos.
- El bot solo acepta usuarios en `AUTHORIZED_USERS` (si está configurado).
- Las API keys nunca se loguean, solo se verifica su presencia al arranque.
- Los CLIs corren con `cwd` en `HOME` para que no levanten archivos del proyecto.
- Los datos de sesión, agentes y equipos se guardan en `data/` (local, no en el repositorio).
- Los archivos adjuntos se guardan con nombres UUID en `data/uploads/<userId>/` — sin riesgo de path traversal.
- Los archivos se eliminan del disco inmediatamente después de ser procesados por el agente.
- El tipo de archivo se valida por MIME type y extensión antes de ser aceptado.

---

---

# KrakBot — English

> Telegram gateway to multiple AI CLI agents — Claude Code, Gemini CLI and OpenAI Codex CLI.
> A message (or a file or a voice note), the agent of your choice, response right in the chat.
> Create custom agents, organize them into multi-agent teams, and let a Root Agent orchestrate them automatically.

---

## Installation

### Mac / Linux — one line

```bash
curl -fsSL https://raw.githubusercontent.com/DiegoBoni/KrakBot/main/bootstrap.sh | bash
```

Opens a visual wizard in the browser that guides you step by step:
checks Node.js, installs dependencies, configures your Telegram token,
detects installed AI CLIs and starts the bot.

### Windows

1. Download the ZIP → **[KrakBot-main.zip](https://github.com/DiegoBoni/KrakBot/archive/refs/heads/main.zip)**
2. Extract the folder
3. Right-click `bootstrap.ps1` → **Run with PowerShell**

### Already have Node.js installed

```bash
git clone https://github.com/DiegoBoni/KrakBot
cd KrakBot
npm run setup
```

### Manual installation (headless)

```bash
git clone https://github.com/DiegoBoni/KrakBot
cd KrakBot
cp .env.example .env   # edit with your token and config
npm install
npm start
```

---

## Environment variables

| Variable                      | Default                            | Description                                                        |
|-------------------------------|------------------------------------|--------------------------------------------------------------------|
| `TELEGRAM_TOKEN`              | —                                  | Bot token from @BotFather **(required)**                           |
| `DEFAULT_AGENT`               | `claude`                           | Default agent when no mention is specified                         |
| `AUTHORIZED_USERS`            | (empty)                            | Comma-separated Telegram user IDs; empty = allow everyone          |
| `DEBUG`                       | `false`                            | Verbose logging                                                    |
| `CLAUDE_CLI_PATH`             | `claude`                           | Path or name of the Claude Code executable                         |
| `GEMINI_CLI_PATH`             | `gemini`                           | Path or name of the Gemini CLI executable                          |
| `CODEX_CLI_PATH`              | `codex`                            | Path or name of the Codex CLI executable                           |
| `CLAUDE_MODEL`                | —                                  | Specific model for Claude (e.g. `claude-sonnet-4-6`)               |
| `GEMINI_MODEL`                | —                                  | Specific model for Gemini                                          |
| `CODEX_MODEL`                 | —                                  | Specific model for Codex                                           |
| `MAX_RESPONSE_LENGTH`         | `4000`                             | Max chars per message before splitting into chunks                 |
| `SOUL_PATH`                   | `./data/SOUL.md`                   | Path to the soul file (bot personality)                            |
| `MEMORY_INJECT`               | `recent`                           | Memory injection mode: `recent` \| `all` \| `none`                 |
| `MEMORY_INJECT_LIMIT`         | `2000`                             | Max chars of memories to inject into context                       |
| `HISTORY_WINDOW`              | `6`                                | Message pairs to keep in context history                           |
| `SESSION_TTL_HOURS`           | `0`                                | Inactivity hours before session expires (0 = never)                |
| `WHISPER_MODEL`               | `mlx-community/whisper-base-mlx`   | Whisper model for audio transcription                              |
| `WHISPER_LANGUAGE`            | `es`                               | Language hint for Whisper (`es`, `en`, etc.)                       |
| `AUDIO_TEMP_DIR`              | `/tmp/krakbot-audio`               | Temp directory for audio files                                     |
| `MAX_AUDIO_SIZE_MB`           | `25`                               | Max audio file size accepted (in MB)                               |
| `ROOT_AGENT_CLI`              | `claude`                           | CLI that acts as Root Agent for automatic routing                  |
| `GITHUB_REPO`                 | `DiegoBoni/KrakBot`                | Repo for auto-update (`owner/repo`, empty = disabled)              |
| `GITHUB_BRANCH`               | `main`                             | Branch to monitor for updates                                      |
| `UPDATE_CHECK_INTERVAL_HOURS` | `24`                               | Hours between update checks (0 = disabled)                         |
| `NOTIFY_CHAT_ID`              | —                                  | Chat ID for notifications (default: first AUTHORIZED_USER)         |
| `GITHUB_TOKEN`                | —                                  | GitHub token for private repos (optional for public repos)         |
| `PM2_APP_NAME`                | `krakbot`                          | PM2 app name for automatic restart                                 |

---

## Bot commands

### Built-in agents

| Command    | Description                               |
|------------|-------------------------------------------|
| `/claude`  | Switch active agent to Claude Code        |
| `/gemini`  | Switch active agent to Gemini CLI         |
| `/codex`   | Switch active agent to Codex CLI          |
| `/default` | Return to the default agent               |
| `/agents`  | List all available agents                 |
| `/setagent`| Activate an agent by its ID              |

### Custom agents

| Command      | Description                                                  |
|--------------|--------------------------------------------------------------|
| `/newagent`  | Create a custom agent with its own system prompt             |
| `/delagent`  | Delete a custom agent                                        |
| `/editagent` | Edit an agent's name, description, system prompt or CLI      |

### Multi-agent teams

| Command               | Description                                                          |
|-----------------------|----------------------------------------------------------------------|
| `/buildteam`          | AI-powered wizard to create a team (coordinator + workers + reviewer)|
| `/teams`              | List all created teams                                               |
| `/delteam <id>`       | Delete a team                                                        |
| `/editteam <id>`      | Edit review mode, heartbeat or max iterations of a team              |

### Team tasks

| Command                  | Description                                                      |
|--------------------------|------------------------------------------------------------------|
| `/task <team-id> <desc>` | Create and run a task on a team                                  |
| `/tasks`                 | View active tasks and tasks completed today                      |
| `/tasks all`             | View full history (active, done, failed, cancelled)              |
| `/tasks <team-id>`       | View all tasks for a specific team                               |
| `/taskstatus <id>`       | Full task detail with step-by-step history                       |
| `/canceltask <id>`       | Cancel an active task                                            |
| `/teamstatus <id>`       | Team status and its active tasks                                 |

### Root Agent & auto-routing

| Command      | Description                                                          |
|--------------|----------------------------------------------------------------------|
| `/auto`      | Send a task to the Root Agent to pick the best agent or team         |
| `/automode`  | Toggle automatic routing on all messages                             |

### Session & history

| Command    | Description                        |
|------------|------------------------------------|
| `/session` | View current session info          |
| `/clear`   | Clear conversation history         |

### Soul & memory

| Command       | Description                                      |
|---------------|--------------------------------------------------|
| `/soul`       | View the active system prompt (soul)             |
| `/reloadsoul` | Reload the soul from file without restarting     |
| `/skip`       | Skip the soul for the next response              |
| `/remember`   | Save a piece of information to persistent memory |
| `/memories`   | List all saved memories                          |
| `/forget`     | Delete a memory                                  |

### Voice & audio (TTS)

| Command      | Description                                                        |
|--------------|--------------------------------------------------------------------|
| `/voicemode` | Toggle voice mode: bot responds with audio instead of text         |
| `/ttsbutton` | Toggle "🔊 Listen" button at the bottom of each response           |
| `/listen`    | Listen to the last bot message as audio                            |
| `/ttsvoice`  | Change TTS voice (language picker)                                 |

### Utilities

| Command    | Description                        |
|------------|------------------------------------|
| `/start`   | Welcome message and instructions   |
| `/help`    | Usage instructions                 |
| `/ping`    | Health check for CLI agents        |
| `/update`  | Check for available updates        |

---

## Custom agents

Custom agents are specialized agents you create with your own system prompt. They are built on top of one of the built-in CLIs (Claude, Gemini or Codex) and are available for your entire session.

### Creating an agent

```
/newagent
```

The bot guides you step by step:

1. **Name** — e.g. `Python Expert` (you can include an emoji at the start)
2. **Description** — so the Root Agent knows which tasks to use it for
3. **System prompt** — the agent's full instructions
4. **TTS voice** — language picker: choose language then specific voice (e.g. Jenny in US English, Tomás in Argentine Spanish). The voice is applied automatically every time you activate that agent.
5. **Base CLI** — choose Claude, Gemini or Codex

The agent is available immediately with an auto-generated ID (e.g. `python-expert`).

> MCPs (external tools like Gmail, GitHub, etc.) are configured directly in each CLI — Claude with `claude mcp add`, Gemini with its own config, etc. All sub-agents for that CLI inherit them automatically.

### Using a custom agent

**Activate for the whole session:**
```
/setagent python-expert
```
or from `/agents` → *Activate* button.

**Mention it in a single message:**
```
@python-expert write a function to sort a list
```

**Once active**, the agent persists until you use `/default`, `/claude`, `/gemini`, `/codex` or another `/setagent`.

### Edit an agent

```
/editagent
```

Change the name, description, system prompt or base CLI.

### Delete an agent

```
/delagent
```

Shows the list of custom agents with confirmation before deleting.

---

## Multi-agent teams

Teams let you run complex tasks through a **Coordinator → Worker → Reviewer** flow. The coordinator analyzes the task, assigns it to the most suitable worker, and a reviewer validates the result before delivery.

### Creating a team

```
/buildteam
```

The AI wizard guides you step by step:

1. **Domain** — choose the team's area (development, marketing, productivity, legal, etc.)
2. **Objective** — describe in one sentence what kind of tasks it will handle
3. **AI recommendation** — the bot generates the full structure (coordinator, workers, reviewer, system prompts)
4. **Confirmation** — approve, customize or request a different structure
5. **Model per agent** — choose Claude, Gemini or Codex for each agent individually

The team and all its agents are created and available immediately.

### Running a task on a team

**With command:**
```
/task productivity-team organize my week
```

**With direct mention** (same as custom agents):
```
@productivity-team organize my week
```

**With autoMode active** — the Root Agent automatically detects when a task belongs to a team.

When a task is created, the bot offers:
- **👁 View internal dialog** — activates live mode: see each step of the flow (coordinator → worker → reviewer) as it happens in real time
- **❌ Cancel** — cancels the task

### Task flow

```
Task received
  → Coordinator analyzes and assigns to the most suitable worker
  → Worker executes the task with its system prompt
  → Reviewer evaluates the result
     ├── Approved → delivers the final result
     └── Changes → worker retries with the feedback
```

Review mode is configured per team:
- `auto` — the reviewer is an AI agent
- `manual` — you approve or request changes
- `none` — no review, the worker delivers directly

### Team management

```
/teams              # list all teams
/teamstatus <id>    # view status and active tasks of a team
/editteam <id>      # edit review mode, heartbeat or max iterations
/delteam <id>       # delete a team
```

### Task management

```
/tasks              # active + completed today
/tasks all          # full history (active, done, failed, cancelled)
/tasks <team-id>    # tasks for a specific team
/taskstatus <id>    # full detail with step history
/canceltask <id>    # cancel an active task
```

---

## Root Agent & Auto-routing

The Root Agent reads the description of all your custom agents and teams, and automatically picks the most suitable one for each task.

### Single task with automatic routing

```
/auto write unit tests for this module
```

### Enable permanent automatic routing

```
/automode
```

With automode enabled, **all messages** go through the Root Agent first. It can route to:
- A custom agent (direct response)
- A team (coordinator → worker → reviewer flow)
- The active session agent (if nothing else fits better)

Automode state is shown in `/session` and persists across restarts.

---

## Text-to-Speech (TTS)

KrakBot can respond with audio using **edge-tts** (Microsoft Edge TTS, cross-platform) with fallback to `say` on macOS.

### Audio modes

| Mode        | How to activate  | Behavior                                                        |
|-------------|------------------|-----------------------------------------------------------------|
| voiceMode   | `/voicemode`     | Bot responds **with audio only**, no text                       |
| ttsButton   | `/ttsbutton`     | Bot responds with text + "🔊 Listen" button at the bottom       |
| On demand   | `/listen`        | Listen to the last message as audio at any time                 |

> `voiceMode` and `ttsButton` are mutually exclusive: enabling one disables the other.

### Voice picker

```
/ttsvoice
```

Shows a 2-step picker:
1. Choose the **language** (12 languages available)
2. Choose the **voice** (male or female for that language)

The voice is saved to your session and persists across restarts.

### Available languages and voices

| Language                | Male voice      | Female voice     |
|-------------------------|-----------------|------------------|
| 🇦🇷 Spanish (Argentina) | Tomás           | Elena            |
| 🇪🇸 Spanish (Spain)     | Álvaro          | Elvira           |
| 🇲🇽 Spanish (Mexico)    | Jorge           | Dalia            |
| 🇺🇸 English (US)        | Guy             | Jenny            |
| 🇬🇧 English (UK)        | Ryan            | Sonia            |
| 🇧🇷 Portuguese (Brazil) | Antônio         | Francisca        |
| 🇵🇹 Portuguese (Portugal)| Duarte         | Raquel           |
| 🇫🇷 French              | Henri           | Denise           |
| 🇩🇪 German              | Conrad          | Katja            |
| 🇮🇹 Italian             | Diego           | Elsa             |
| 🇯🇵 Japanese            | Keita           | Nanami           |
| 🇨🇳 Chinese (Mandarin)  | Yunxi           | Xiaoxiao         |

### Voice per agent

When creating an agent with `/newagent` you can assign it its own voice. Every time you activate that agent, its voice is applied automatically to your session.

### Voice notes

You can send voice notes to the bot. The bot will:
1. Transcribe the audio with **mlx_whisper** (local Whisper on Apple Silicon)
2. Pass the transcript to the active agent
3. Respond with audio (if `voiceMode` is ON) or with text

### TTS environment variables

| Variable     | Default  | Description                                                    |
|--------------|----------|----------------------------------------------------------------|
| `TTS_ENGINE` | `auto`   | TTS engine: `auto` \| `edge-tts` \| `say`                     |
| `TTS_VOICE`  | —        | Force a specific edge-tts voice (overrides session setting)    |

### TTS dependencies

- **edge-tts** (primary, cross-platform): `pip install edge-tts`
- **ffmpeg** (required for OGG Opus conversion): `brew install ffmpeg`
- **say** (fallback, macOS only): included in macOS

---

## File attachments

You can send images, PDFs and text/code files directly from Telegram.

### How to use

**With caption (prompt included):**
Attach the file and write your query as the message description. The bot processes it immediately.

```
[diagram photo]   What data structure does this represent?
[main.py file]    Check this code for bugs
[invoice.pdf]     Extract the total and issuer tax ID
```

**Without caption:**
The file stays pending. Your next text message uses it as context.

```
[attach code.js]               ← stays pending
"optimize the main function"   ← this message receives it with the file
```

### Supported formats

| Type          | Extensions / MIME                                                                     | Compatible agents         |
|---------------|---------------------------------------------------------------------------------------|---------------------------|
| Images        | jpg, jpeg, png, gif, webp, bmp, tiff, svg, ico                                        | Claude (and custom Claude)|
| PDFs          | pdf                                                                                   | Claude (and custom Claude)|
| Text / code   | txt, md, csv, json, xml, yaml, html, css, js, ts, py, java, c, cpp, go, rs, rb, php, sh, sql… | All agents        |

> Gemini and Codex only support text files. Binary files (images, PDFs) are rejected with a warning if the active agent is not Claude.

### Size limit

Default **20 MB** (configurable with `MAX_FILE_SIZE_MB` in `.env`).
Telegram enforces its own 20 MB limit for bots, so higher values have no practical effect.

### Automatic cleanup

Files are deleted from disk immediately after processing. An hourly cleanup job removes any orphaned files older than 1 hour.

---

## Mentions

Prefix any message with `@id` to direct it to a specific agent or team for that response only,
without changing the active session agent:

```
@claude explain this function
@gem summarize this text
@codex refactor this method
@python-expert optimize this function
@dev-team build the authentication module
```

Built-in agent aliases:

| Agent  | Aliases                  |
|--------|--------------------------|
| Claude | `@claude`, `@cc`, `@c`   |
| Gemini | `@gemini`, `@gem`, `@g`  |
| Codex  | `@codex`, `@gpt`, `@o`   |

For custom agents and teams, use their ID directly: `@python-expert`, `@dev-team`, etc.

---

## Architecture

```
src/
├── agents/
│   ├── runner.js             # Generic child_process.spawn wrapper with timeout and heartbeat
│   ├── router.js             # Agent registry, dispatch, alias resolution and Root Agent
│   ├── claude.js             # Claude runner: injects session history as context
│   ├── gemini.js             # Gemini runner
│   └── codex.js              # Codex runner
├── bot/
│   ├── index.js              # Telegraf setup, command registration, error handler
│   ├── handlers.js           # Command handlers, messages, custom agent and team flows
│   └── middleware.js         # Auth middleware (user allowlist)
├── utils/
│   ├── logger.js             # Winston logger
│   ├── sessionManager.js     # Session store with disk persistence (configurable TTL)
│   ├── contextBuilder.js     # Builds final prompt with soul, memories and history
│   ├── customAgentManager.js # Custom agent CRUD (persists to data/)
│   ├── teamManager.js        # Multi-agent team CRUD (persists to data/)
│   ├── taskManager.js        # Task state and lifecycle (state machine)
│   ├── heartbeatManager.js   # Periodic progress notifications for long-running tasks
│   ├── cliValidator.js       # CLI binary validation at startup
│   ├── audioTranscriber.js   # Voice note transcription with mlx_whisper (local Whisper)
│   ├── ttsService.js         # Text-to-speech: edge-tts (primary) + say (fallback), voice catalog
│   ├── textSanitizer.js      # Strips markdown before sending to TTS
│   ├── fileManager.js        # File download, validation, reading and cleanup
│   └── updateChecker.js      # Auto-updater from GitHub
├── workflows/
│   ├── buildTeamWizard.js    # Interactive AI-assisted wizard for creating teams
│   └── teamWorkflow.js       # Coordinator → worker → reviewer orchestration
└── index.js                  # Entry point: startup, validation, graceful shutdown

data/                         # Generated at runtime, excluded from git
├── sessions/                 # Per-user persisted sessions (JSON)
├── uploads/                  # Temporary file attachments (deleted after processing)
├── custom-agents.json        # Custom agent definitions
├── teams.json                # Multi-agent team definitions
└── tasks.json                # Task history
```

**Message flow:**

```
Telegram msg / file
  → middleware.js         (auth check)
  → handlers.js           (download file, extract @alias, detect active flows or autoMode)
  → router.js             (Root Agent if autoMode → agent or team)

  If agent:
    → custom agent / claude|gemini|codex.js
    → runner.js           (spawn CLI, timeout, heartbeat every 30s)
    → response in chunks ≤4000 chars → Telegram

  If team:
    → teamWorkflow.runTask()
    → coordinator         (picks worker + specific instruction)
    → worker              (executes task with its system prompt)
    → reviewer            (approves or requests changes)
    → final result → Telegram
```

---

## Security

- Subprocesses are spawned **without shell** (`shell: false`) to prevent command injection.
- The bot only accepts users in `AUTHORIZED_USERS` (if configured).
- API keys are never logged, only their presence is verified at startup.
- CLIs run with `cwd` set to `HOME` so they don't pick up project files.
- Session data, agents and teams are saved in `data/` (local, not in the repository).
- Attached files are saved with UUID names in `data/uploads/<userId>/` — no path traversal risk.
- Files are deleted from disk immediately after being processed by the agent.
- File type is validated by MIME type and extension before being accepted.
