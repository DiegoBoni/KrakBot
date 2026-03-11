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
> Un mensaje (o un archivo), el agente que elijas, respuesta directo en el chat.
> Creá agentes personalizados con system prompts propios y un Root Agent que los orquesta automáticamente.

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

| Variable              | Default   | Descripción                                                  |
|-----------------------|-----------|--------------------------------------------------------------|
| `TELEGRAM_TOKEN`      | —         | Token del bot desde @BotFather **(requerido)**               |
| `DEFAULT_AGENT`       | `claude`  | Agente por defecto cuando no se especifica mención           |
| `AUTHORIZED_USERS`    | (vacío)   | IDs de Telegram separados por coma; vacío = permitir a todos |
| `CLI_TIMEOUT`         | `120000`  | Tiempo máximo en ms por respuesta del CLI                    |
| `DEBUG`               | `false`   | Logs verbosos                                                |
| `CLAUDE_CLI_PATH`     | `claude`  | Ruta o nombre del ejecutable de Claude Code                  |
| `GEMINI_CLI_PATH`     | `gemini`  | Ruta o nombre del ejecutable de Gemini CLI                   |
| `CODEX_CLI_PATH`      | `codex`   | Ruta o nombre del ejecutable de Codex CLI                    |
| `CLAUDE_MODEL`        | —         | Modelo específico para Claude (ej: `claude-opus-4-5`)        |
| `GEMINI_MODEL`        | —         | Modelo específico para Gemini                                |
| `CODEX_MODEL`         | —         | Modelo específico para Codex                                 |
| `MAX_RESPONSE_LENGTH` | `4000`    | Máximo de chars por mensaje antes de partir en chunks        |
| `ROOT_AGENT_CLI`      | `claude`  | CLI que actúa como Root Agent para routing automático        |
| `HISTORY_WINDOW`      | `6`       | Pares de mensajes a conservar en el historial de contexto    |
| `SESSION_TTL_HOURS`   | `0`       | Horas de inactividad para expirar sesión (0 = nunca)         |
| `MAX_FILE_SIZE_MB`    | `20`      | Tamaño máximo de archivo aceptado vía Telegram (en MB)       |

---

## Comandos del bot

### Agentes integrados

| Comando    | Descripción                                 |
|------------|---------------------------------------------|
| `/claude`  | Cambiar agente activo a Claude Code         |
| `/gemini`  | Cambiar agente activo a Gemini CLI          |
| `/codex`   | Cambiar agente activo a Codex CLI           |
| `/default` | Volver al agente por defecto                |
| `/agentes` | Listar todos los agentes disponibles        |
| `/setagent`| Activar un agente por su ID                 |

### Agentes personalizados

| Comando      | Descripción                                                 |
|--------------|-------------------------------------------------------------|
| `/newagent`  | Crear un agente personalizado con system prompt propio      |
| `/delagent`  | Borrar un agente personalizado                              |
| `/editagent` | Editar nombre, descripción, system prompt o CLI de un agente|

### Root Agent & auto-routing

| Comando      | Descripción                                                             |
|--------------|-------------------------------------------------------------------------|
| `/auto`      | Enviar una tarea al Root Agent para que elija el mejor agente           |
| `/automode`  | Activar/desactivar routing automático en todos los mensajes             |

### Sesión e historial

| Comando    | Descripción                                 |
|------------|---------------------------------------------|
| `/sesion`  | Ver info de la sesión actual                |
| `/limpiar` | Borrar historial de la conversación         |

### Soul & memoria

| Comando       | Descripción                                        |
|---------------|----------------------------------------------------|
| `/soul`       | Ver el system prompt (soul) activo                 |
| `/reloadsoul` | Recargar el soul desde el archivo                  |
| `/skip`       | Saltar el soul en la próxima respuesta             |
| `/remember`   | Guardar un dato en la memoria persistente del bot  |
| `/memories`   | Ver todas las memorias guardadas                   |
| `/forget`     | Borrar una memoria                                 |

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
4. **CLI base** — elegís Claude, Gemini o Codex

El agente queda disponible inmediatamente con un ID generado automáticamente (ej: `python-expert`).

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

## Root Agent & Auto-routing

El Root Agent lee la descripción de todos tus agentes personalizados y elige automáticamente el más adecuado para cada tarea.

### Una sola tarea con routing automático

```
/auto escribí tests unitarios para este módulo
```

### Activar routing automático permanente

```
/automode
```

Con automode activado, **todos los mensajes** pasan primero por el Root Agent. Si ningún agente custom aplica, usa el agente activo de la sesión.

El estado del automode se muestra en `/sesion` y se persiste entre reinicios.

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

## Menciones de agente

Prefijá cualquier mensaje con `@alias` para usar un agente específico solo en esa respuesta,
sin cambiar el agente activo de la sesión:

```
@claude explicame esta función
@gem resumí este texto
@codex refactorizá este método
@python-expert optimizá esta función
```

Aliases de agentes integrados:

| Agente     | Aliases                  |
|------------|--------------------------|
| Claude     | `@claude`, `@cc`, `@c`   |
| Gemini     | `@gemini`, `@gem`, `@g`  |
| Codex      | `@codex`, `@gpt`, `@o`   |

Para agentes personalizados, usá su ID directamente: `@python-expert`, `@sql-helper`, etc.

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
│   ├── handlers.js           # Handlers de comandos, mensajes, flows de agentes custom
│   └── middleware.js         # Middleware de autenticación (allowlist de usuarios)
├── utils/
│   ├── logger.js             # Logger Winston
│   ├── sessionManager.js     # Store de sesiones con persistencia a disco (TTL configurable)
│   ├── contextBuilder.js     # Construye el prompt final con soul, memorias e historial
│   ├── customAgentManager.js # CRUD de agentes personalizados (persiste en data/)
│   ├── cliValidator.js       # Validación de binarios CLI al arranque
│   ├── audioTranscriber.js   # Transcripción de notas de voz con mlx_whisper
│   ├── fileManager.js        # Descarga, validación, lectura y limpieza de archivos adjuntos
│   └── updateChecker.js      # Auto-updater desde GitHub
└── index.js                  # Entry point: arranque, validación, shutdown graceful

data/                         # Generado en runtime, excluido de git
├── sessions/                 # Sesiones persistidas por usuario (JSON)
├── uploads/                  # Archivos adjuntos temporales (se borran tras procesar)
└── custom-agents.json        # Definiciones de agentes personalizados
```

**Flujo de un mensaje:**

```
Telegram msg / archivo
  → middleware.js       (auth check)
  → handlers.js         (descarga archivo si aplica, extrae @alias, detecta flows activos o autoMode)
  → fileManager.js      (valida tipo y tamaño, guarda en data/uploads/<userId>/)
  → router.js           (Root Agent si autoMode, luego resuelve agente)
  → custom agent        (inyecta system prompt vía --append-system-prompt o inline)
    o claude|gemini|codex.js  (construye contexto con soul + memorias + historial + archivo)
  → runner.js           (spawn CLI con @/ruta para binarios o [ARCHIVO] para texto, timeout, heartbeat cada 30s)
  → respuesta en chunks ≤4000 chars → Telegram
  → fileManager.js      (borra el archivo del disco)
```

---

## Seguridad

- Los subprocesos se spawnean **sin shell** (`shell: false`) para evitar inyección de comandos.
- El bot solo acepta usuarios en `AUTHORIZED_USERS` (si está configurado).
- Las API keys nunca se loguean, solo se verifica su presencia al arranque.
- Los CLIs corren con `cwd` en `HOME` para que no levanten archivos del proyecto.
- Los datos de sesión y agentes custom se guardan en `data/` (local, no en el repositorio).
- Los archivos adjuntos se guardan con nombres UUID en `data/uploads/<userId>/` — sin riesgo de path traversal.
- Los archivos se eliminan del disco inmediatamente después de ser procesados por el agente.
- El tipo de archivo se valida por MIME type y extensión antes de ser aceptado.
