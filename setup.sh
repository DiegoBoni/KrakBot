#!/usr/bin/env bash
set -euo pipefail

# ─── colors ───────────────────────────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✘${RESET} $*" >&2; }
ask()     { echo -e "${BOLD}${1}${RESET}"; }

# ─── header ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
cat << 'EOF'
  _  _____         _    ____        _
 | |/ / _ \ __ _| | _| __ )  ___ | |_
 | ' /|  _// _` | |/ /  _ \ / _ \| __|
 | . \| | | (_| |   <| |_) | (_) | |_
 |_|\_\_|  \__,_|_|\_\____/ \___/ \__|

            🐙⚡  Setup (modo terminal)
EOF
echo -e "${RESET}"

# ─── prereqs ──────────────────────────────────────────────────────────────────
info "Verificando requisitos..."

if ! command -v node &>/dev/null; then
  error "Node.js no encontrado. Instalalo desde https://nodejs.org (>=18)"
  exit 1
fi

NODE_VERSION=$(node -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>/dev/null && node -e "console.log(process.versions.node)")
success "Node.js ${NODE_VERSION}"

if ! command -v npm &>/dev/null; then
  error "npm no encontrado."
  exit 1
fi
success "npm $(npm -v)"

# ─── clone or use cwd ─────────────────────────────────────────────────────────
INSTALL_DIR="${HOME}/.krakbot"

if [ ! -f "package.json" ]; then
  info "Clonando KrakBot en ${INSTALL_DIR}..."
  git clone --depth 1 https://github.com/DiegoBoni/KrakBot "$INSTALL_DIR" 2>/dev/null \
    || { error "No se pudo clonar el repositorio."; exit 1; }
  cd "$INSTALL_DIR"
  success "Repo clonado en ${INSTALL_DIR}"
else
  success "Usando directorio actual: $(pwd)"
fi

# ─── npm install ──────────────────────────────────────────────────────────────
info "Instalando dependencias..."
npm install --silent
success "Dependencias instaladas"

# ─── .env already exists? ─────────────────────────────────────────────────────
if [ -f ".env" ]; then
  warn ".env ya existe."
  read -rp "  ¿Sobreescribir? [s/N]: " OVERWRITE
  if [[ ! "$OVERWRITE" =~ ^[sS]$ ]]; then
    success "Setup terminado. Usá el .env existente."
    echo ""
    info "Para arrancar: ${BOLD}npm start${RESET}"
    exit 0
  fi
fi

# ─── gather config ────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── Configuración del bot ─────────────────────────────────${RESET}"
echo ""

# TELEGRAM_TOKEN (required)
while true; do
  ask "Token de Telegram (de @BotFather) [requerido]:"
  read -rp "  > " TELEGRAM_TOKEN
  if [ -n "$TELEGRAM_TOKEN" ]; then break; fi
  error "El token es obligatorio."
done

echo ""

# AUTHORIZED_USERS (optional)
ask "IDs de Telegram autorizados (separados por coma) [Enter = permitir todos]:"
read -rp "  > " AUTHORIZED_USERS

echo ""

# DEFAULT_AGENT
ask "Agente por defecto: claude / gemini / codex [Enter = claude]:"
read -rp "  > " DEFAULT_AGENT
DEFAULT_AGENT="${DEFAULT_AGENT:-claude}"

echo ""
echo -e "${BOLD}── Modelos (Enter para usar el default del CLI) ──────────${RESET}"
echo ""

ask "Modelo de Claude [Enter = claude-sonnet-4-6]:"
echo -e "  ${DIM}opciones: claude-sonnet-4-6 | claude-opus-4-6 | claude-haiku-4-5-20251001${RESET}"
read -rp "  > " CLAUDE_MODEL
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-sonnet-4-6}"

ask "Modelo de Gemini [Enter = gemini-2.5-pro]:"
echo -e "  ${DIM}opciones: gemini-2.5-pro | gemini-2.5-flash | gemini-2.0-flash${RESET}"
read -rp "  > " GEMINI_MODEL
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-pro}"

ask "Modelo de Codex/OpenAI [Enter = default del CLI]:"
echo -e "  ${DIM}opciones: o4-mini | o3 | o3-mini${RESET}"
read -rp "  > " CODEX_MODEL

echo ""
echo -e "${BOLD}── Avanzado (Enter para usar defaults) ───────────────────${RESET}"
echo ""

ask "Timeout por respuesta en ms [Enter = 120000]:"
read -rp "  > " CLI_TIMEOUT
CLI_TIMEOUT="${CLI_TIMEOUT:-120000}"

ask "Activar debug logs? [s/N]:"
read -rp "  > " DEBUG_INPUT
DEBUG="false"
[[ "$DEBUG_INPUT" =~ ^[sS]$ ]] && DEBUG="true"

# ─── write .env ───────────────────────────────────────────────────────────────
cat > .env << EOF
# Generado por setup.sh — $(date "+%Y-%m-%d %H:%M")

TELEGRAM_TOKEN=${TELEGRAM_TOKEN}

DEFAULT_AGENT=${DEFAULT_AGENT}
AUTHORIZED_USERS=${AUTHORIZED_USERS}

CLI_TIMEOUT=${CLI_TIMEOUT}
DEBUG=${DEBUG}

CLAUDE_CLI_PATH=claude
GEMINI_CLI_PATH=gemini
CODEX_CLI_PATH=codex

CLAUDE_MODEL=${CLAUDE_MODEL}
GEMINI_MODEL=${GEMINI_MODEL}
CODEX_MODEL=${CODEX_MODEL}

MAX_RESPONSE_LENGTH=4000
EOF

success ".env creado"

# ─── check which CLIs are available ───────────────────────────────────────────
echo ""
info "Verificando CLIs instalados..."

check_cli() {
  local name="$1"
  if command -v "$name" &>/dev/null; then
    success "${name} encontrado ($(command -v "$name"))"
  else
    warn "${name} NO encontrado en PATH — instalalo para usarlo"
  fi
}

check_cli claude
check_cli gemini
check_cli codex

# ─── done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✔ Setup completo.${RESET}"
echo ""
info "Para arrancar el bot:"
echo -e "  ${BOLD}npm start${RESET}"
echo ""
info "Para desarrollo con auto-reload:"
echo -e "  ${BOLD}npm run dev${RESET}"
echo ""
