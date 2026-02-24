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
> Un mensaje, el agente que elijas, respuesta directo en el chat.

---

## Instalación rápida

```bash
curl -fsSL https://raw.githubusercontent.com/KrakBot/main/setup.sh | bash
```

El script interactivo:
- Verifica Node.js >=18
- Instala dependencias
- Te pregunta token, usuarios autorizados, agente por default y modelos
- Crea el `.env` listo para usar
- Verifica qué CLIs tenés instalados

**Instalación manual** (si preferís hacerlo a mano):

```bash
git clone https://github.com/BoniBot/KrakBot
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

---

## Comandos del bot

| Comando    | Descripción                                 |
|------------|---------------------------------------------|
| `/start`   | Bienvenida e instrucciones                  |
| `/ayuda`   | Instrucciones de uso                        |
| `/agentes` | Listar agentes disponibles y su estado      |
| `/claude`  | Cambiar agente activo a Claude Code         |
| `/gemini`  | Cambiar agente activo a Gemini CLI          |
| `/codex`   | Cambiar agente activo a Codex CLI           |
| `/sesion`  | Ver info de la sesión actual                |
| `/limpiar` | Borrar historial de la conversación         |
| `/ping`    | Health check de los agentes CLI             |

---

## Menciones de agente

Prefijá cualquier mensaje con `@alias` para usar un agente específico solo en esa respuesta,
sin cambiar el agente activo de la sesión:

```
@claude explicame esta función
@gem resumí este texto
@codex refactorizá este método
```

Aliases soportados:

| Agente     | Aliases               |
|------------|-----------------------|
| Claude     | `@claude`, `@cc`, `@c` |
| Gemini     | `@gemini`, `@gem`, `@g` |
| Codex      | `@codex`, `@gpt`, `@o` |

---

## Arquitectura

```
src/
├── agents/
│   ├── runner.js          # Wrapper genérico de child_process.spawn con timeout y heartbeat
│   ├── router.js          # Registro de agentes, dispatch y resolución de aliases
│   ├── claude.js          # Runner de Claude: inyecta historial de sesión como contexto
│   ├── gemini.js          # Runner de Gemini
│   └── codex.js           # Runner de Codex
├── bot/
│   ├── index.js           # Setup de Telegraf, registro de comandos, error handler
│   ├── handlers.js        # Handlers de comandos y mensajes + /ping + heartbeat
│   └── middleware.js      # Middleware de autenticación (allowlist de usuarios)
├── utils/
│   ├── logger.js          # Logger Winston
│   ├── sessionManager.js  # Store de sesiones en memoria (singleton, TTL 2h)
│   └── cliValidator.js    # Validación de binarios CLI al arranque
└── index.js               # Entry point: arranque, validación, shutdown graceful
```

**Flujo de un mensaje:**

```
Telegram msg
  → middleware.js  (auth check)
  → handlers.js    (extrae @alias o usa agente de sesión)
  → router.js      (resuelve agente)
  → claude|gemini|codex.js  (construye prompt con historial)
  → runner.js      (spawn CLI, timeout, heartbeat cada 30s)
  → respuesta en chunks ≤4000 chars → Telegram
```

---

## Seguridad

- Los subprocesos se spawnean **sin shell** (`shell: false`) para evitar inyección de comandos.
- El bot solo acepta usuarios en `AUTHORIZED_USERS` (si está configurado).
- Las API keys nunca se loguean, solo se verifica su presencia al arranque.
- Los CLIs corren con `cwd` en `HOME` para que no levanten archivos del proyecto.
