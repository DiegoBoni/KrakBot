#!/usr/bin/env bash
set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✘${RESET} $*" >&2; }

# ─── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
cat << 'EOF'
  _  _____         _    ____        _
 | |/ / _ \ __ _| | _| __ )  ___ | |_
 | ' /|  _// _` | |/ /  _ \ / _ \| __|
 | . \| | | (_| |   <| |_) | (_) | |_
 |_|\_\_|  \__,_|_|\_\____/ \___/ \__|

             🐙⚡  Installer
EOF
echo -e "${RESET}"

# ─── Detect OS and architecture ───────────────────────────────────────────────
OS=$(uname -s)      # Darwin | Linux
ARCH=$(uname -m)    # arm64 | x86_64

info "Sistema: ${OS} ${ARCH}"

# ─── Node.js check / install ──────────────────────────────────────────────────
NODE_OK=false

if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -e "console.log(parseInt(process.versions.node))" 2>/dev/null || echo "0")
  if [ "$NODE_MAJOR" -ge 18 ]; then
    success "Node.js $(node -v) — OK"
    NODE_OK=true
  else
    warn "Node.js $NODE_MAJOR < 18 — necesitamos actualizar"
  fi
fi

if [ "$NODE_OK" = false ]; then
  info "Instalando Node.js LTS..."

  if command -v nvm &>/dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    [ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"
    nvm install --lts
    nvm use --lts
    success "Node.js instalado via nvm: $(node -v)"

  elif [ "$OS" = "Darwin" ] && command -v brew &>/dev/null; then
    brew install node
    success "Node.js instalado via Homebrew: $(node -v)"

  elif [ "$OS" = "Darwin" ]; then
    # Download .pkg from nodejs.org
    info "Descargando Node.js LTS para macOS..."
    NODE_VERSION=$(curl -s https://nodejs.org/dist/index.json | grep -o '"version":"v[^"]*"' | grep -v 'rc\|alpha\|beta' | head -20 | grep '"lts"' || true)
    # Simpler: just use a known LTS
    NODE_URL="https://nodejs.org/dist/latest-v22.x/node-v22.14.0-pkg-files-${ARCH}.pkg"
    if [ "$ARCH" = "arm64" ]; then
      NODE_URL="https://nodejs.org/dist/latest-v22.x/node-v22.14.0.pkg"
    else
      NODE_URL="https://nodejs.org/dist/latest-v22.x/node-v22.14.0.pkg"
    fi
    TMPFILE=$(mktemp /tmp/node-installer.XXXXXX.pkg)
    curl -fsSL "$NODE_URL" -o "$TMPFILE"
    sudo installer -pkg "$TMPFILE" -target / -verboseR
    rm -f "$TMPFILE"
    # Update PATH
    export PATH="/usr/local/bin:$PATH"
    success "Node.js instalado: $(node -v)"

  elif [ "$OS" = "Linux" ]; then
    # Try package managers
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
      sudo dnf install -y nodejs
    elif command -v yum &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
      sudo yum install -y nodejs
    else
      # Manual download
      info "Descargando Node.js LTS para Linux ${ARCH}..."
      NODE_FILE="node-v22.14.0-linux-x64"
      if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
        NODE_FILE="node-v22.14.0-linux-arm64"
      fi
      NODE_URL="https://nodejs.org/dist/latest-v22.x/${NODE_FILE}.tar.gz"
      curl -fsSL "$NODE_URL" | sudo tar -xz -C /usr/local --strip-components=1
      export PATH="/usr/local/bin:$PATH"
    fi
    success "Node.js instalado: $(node -v)"

  else
    error "No se pudo instalar Node.js automáticamente."
    error "Instalalo manualmente desde: https://nodejs.org"
    exit 1
  fi
fi

# Final Node.js verification
if ! command -v node &>/dev/null; then
  error "Node.js no está disponible. Instalalo desde https://nodejs.org y volvé a ejecutar."
  exit 1
fi

# ─── Clone repo if needed ─────────────────────────────────────────────────────
INSTALL_DIR="$HOME/.krakbot"

if [ ! -f "installer/server.js" ]; then
  if [ -f "package.json" ] && grep -q "krakbot" package.json 2>/dev/null; then
    INSTALL_DIR="$(pwd)"
    success "Usando directorio actual: $INSTALL_DIR"
  else
    info "Clonando KrakBot en ${INSTALL_DIR}..."
    if command -v git &>/dev/null; then
      git clone --depth 1 https://github.com/DiegoBoni/KrakBot "$INSTALL_DIR" 2>/dev/null \
        || { error "No se pudo clonar el repositorio. Verificá tu conexión."; exit 1; }
      success "Repositorio clonado en ${INSTALL_DIR}"
    else
      error "Git no encontrado. Instalalo o descargá el repositorio manualmente."
      error "  https://github.com/DiegoBoni/KrakBot"
      exit 1
    fi
    cd "$INSTALL_DIR"
  fi
fi

# ─── Launch installer server ──────────────────────────────────────────────────
info "Iniciando KrakBot Installer..."
node installer/server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

sleep 1.5

# ─── Open browser ─────────────────────────────────────────────────────────────
URL="http://localhost:7337"
if [ "$OS" = "Darwin" ]; then
  open "$URL" 2>/dev/null || true
else
  xdg-open "$URL" 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}${BOLD}Si el browser no abre, visitá: ${URL}${RESET}"
echo ""
echo -e "${YELLOW}Mantené esta terminal abierta mientras usás el instalador.${RESET}"
echo ""

# ─── Wait for server to finish ────────────────────────────────────────────────
wait $SERVER_PID || true
