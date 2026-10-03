#!/usr/bin/env bash
# ==============================================================================
# Gravity Infrastructure Monitoring Agent v0.1 (Uptime Suite)
# Production Hardened Installation Daemon
# Architecture: Self-Contained Daemon (NVM-Independent)
# ==============================================================================
set -eo pipefail

AGENT_VERSION="0.1"
INSTALL_DIR="/opt/gravity/agent"
RUNTIME_DIR="/opt/gravity/runtime"
CONFIG_DIR="/etc/gravity"
SERVICE_USER="gravity"
SERVICE_NAME="gravity-agent"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CLI_LINK="/usr/local/bin/gravity"
CLI_ALIAS="/usr/local/bin/gravity-agent"
CLI_UPTIME_ALIAS="/usr/local/bin/uptime-agent"

# Defaults replaced dynamically or passed as flags
API_URL="${API_URL:-http://localhost:3000}"
INSTALL_TOKEN="${INSTALL_TOKEN:-}"
SERVER_NAME=""
ENABLE_DOCKER=""
NON_INTERACTIVE=false
DO_UNINSTALL=false
DO_PURGE=false

for arg in "$@"; do
  case $arg in
    --api-url=*)
      API_URL="${arg#*=}"
      ;;
    --token=*)
      INSTALL_TOKEN="${arg#*=}"
      ;;
    --name=*)
      SERVER_NAME="${arg#*=}"
      SERVER_NAME="${SERVER_NAME%\"}"
      SERVER_NAME="${SERVER_NAME#\"}"
      SERVER_NAME="${SERVER_NAME%\'}"
      SERVER_NAME="${SERVER_NAME#\'}"
      ;;
    --enable-docker-monitoring)
      ENABLE_DOCKER=true
      ;;
    --disable-docker-monitoring)
      ENABLE_DOCKER=false
      ;;
    -y|--non-interactive)
      NON_INTERACTIVE=true
      ;;
    --uninstall|uninstall)
      DO_UNINSTALL=true
      ;;
    --purge)
      DO_PURGE=true
      ;;
  esac
done

if [ "$DO_UNINSTALL" = true ]; then
  echo -e "\033[0;34m[gravity]\033[0m Stopping and unregistering Gravity Agent daemon..."
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "$SERVICE_FILE"
  systemctl daemon-reload
  systemctl reset-failed 2>/dev/null || true
  rm -f "$CLI_LINK" "$CLI_ALIAS" "$CLI_UPTIME_ALIAS"
  if [ "$DO_PURGE" = true ]; then
    rm -rf /opt/gravity /etc/gravity /var/log/gravity
    userdel "$SERVICE_USER" 2>/dev/null || true
    echo -e "\033[0;32m✓\033[0m Gravity Agent completely purged from system."
  else
    echo -e "\033[0;32m✓\033[0m Gravity Agent service uninstalled (credentials preserved in /etc/gravity)."
  fi
  exit 0
fi

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
BLUE="\033[0;34m"
NC="\033[0m"

log_info() { echo -e "${BLUE}[gravity]${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}WARNING:${NC} $1"; }
log_error() { echo -e "${RED}ERROR:${NC} $1"; }

echo -e "${BOLD}=======================================================${NC}"
echo -e "${BOLD}   Gravity Infrastructure Monitoring Agent v${AGENT_VERSION}    ${NC}"
echo -e "${BOLD}   Uptime Monitoring Suite - Production Daemon        ${NC}"
echo -e "${BOLD}=======================================================${NC}"
echo ""

# ------------------------------------------------------------------------------
# 1. Preflight Checks
# ------------------------------------------------------------------------------
log_info "Executing installation preflight checks..."

# Check Root Privileges
if [ "$EUID" -ne 0 ]; then
  log_error "This installer must be run as root or with sudo privileges."
  exit 1
fi

# Detect OS
OS_NAME="Linux"
OS_VERSION="Unknown"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_NAME=$NAME
  OS_VERSION=$VERSION_ID
fi

# Detect Architecture
ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH_NODE="x64" ;;
  aarch64|arm64) ARCH_NODE="arm64" ;;
  *)
    log_error "Unsupported architecture: $ARCH (Requires x86_64 or arm64)"
    exit 1
    ;;
esac

# Check Available Disk Space (Requires at least 100MB)
FREE_DISK_KB=$(df /opt 2>/dev/null | tail -1 | awk '{print $4}' || df / 2>/dev/null | tail -1 | awk '{print $4}')
if [ "${FREE_DISK_KB:-0}" -lt 102400 ]; then
  log_error "Insufficient disk space on /opt. At least 100 MB free required."
  exit 1
fi

# Check Available Memory
FREE_MEM_KB=$(grep MemAvailable /proc/meminfo | awk '{print $2}' || echo 500000)
if [ "${FREE_MEM_KB:-0}" -lt 131072 ]; then
  log_warn "Monitored host has low available memory (${FREE_MEM_KB} kB)."
fi

# Check API Connectivity
log_info "Validating API connectivity to ${API_URL}..."
if command -v curl >/dev/null 2>&1; then
  HTTP_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "${API_URL}/api/agent/version" || echo "000")
  if [ "$HTTP_CHECK" != "200" ]; then
    log_error "Cannot reach Uptime API at ${API_URL} (HTTP ${HTTP_CHECK})."
    log_error "Please verify the server URL, DNS resolution, and firewall rules."
    exit 1
  fi
else
  log_error "curl command is required for installation."
  exit 1
fi

# Validate Token if provided
if [ -n "$INSTALL_TOKEN" ]; then
  TOKEN_CHECK=$(curl -s "${API_URL}/api/agent/install/${INSTALL_TOKEN}" || echo '{"success":false}')
  if [[ "$TOKEN_CHECK" != *"\"success\":true"* ]]; then
    log_error "Invalid or expired installation token: ${INSTALL_TOKEN}"
    echo "$TOKEN_CHECK"
    exit 1
  fi
fi

echo -e "  Operating System:     ${GREEN}${OS_NAME} ${OS_VERSION}${NC} [PASS]"
echo -e "  Architecture:         ${GREEN}${ARCH} (${ARCH_NODE})${NC} [PASS]"
echo -e "  Disk & Memory:        ${GREEN}Available${NC} [PASS]"
echo -e "  API Connectivity:     ${GREEN}Reachable${NC} [PASS]"
echo ""

# ------------------------------------------------------------------------------
# 2. Runtime Isolation (Resolve NVM Issue Permanently)
# ------------------------------------------------------------------------------
log_info "Configuring dedicated, isolated Node.js runtime (NVM-independent)..."

mkdir -p "$RUNTIME_DIR"
mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/src"
mkdir -p "$CONFIG_DIR"
mkdir -p "/opt/gravity/releases/${AGENT_VERSION}"

RUNTIME_NODE="${RUNTIME_DIR}/node"

# Check if dedicated runtime already exists and is valid
USE_EXISTING_RUNTIME=false
if [ -x "$RUNTIME_NODE" ]; then
  CURRENT_RUNTIME_VER=$("$RUNTIME_NODE" -v 2>/dev/null || echo "none")
  if [[ "$CURRENT_RUNTIME_VER" == v18* || "$CURRENT_RUNTIME_VER" == v20* || "$CURRENT_RUNTIME_VER" == v22* ]]; then
    USE_EXISTING_RUNTIME=true
    log_success "Found functional dedicated runtime: $CURRENT_RUNTIME_VER at $RUNTIME_NODE"
  fi
fi

if [ "$USE_EXISTING_RUNTIME" = false ]; then
  # Check if a compatible system Node (v18+) exists outside of NVM
  SYSTEM_NODE=""
  for candidate in /usr/bin/node /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_VER=$("$candidate" -v 2>/dev/null || echo "v0")
      MAJOR_VER=$(echo "$NODE_VER" | tr -d 'v' | cut -d'.' -f1)
      if [ "${MAJOR_VER:-0}" -ge 18 ]; then
        SYSTEM_NODE="$candidate"
        break
      fi
    fi
  done

  # Check if NVM is detected in environment or root
  DETECTED_NVM_NODE=$(which node 2>/dev/null || echo "")
  if [[ "$DETECTED_NVM_NODE" == *".nvm"* ]]; then
    log_warn "Detected NVM Node runtime: ${DETECTED_NVM_NODE}"
    log_warn "NVM is user-shell specific and will fail in systemd (status=203/EXEC)."
    log_info "Decoupling runtime: copying executable to ${RUNTIME_NODE}..."
    
    # Copy NVM binary directly into /opt/gravity/runtime/node with standard system execute permissions
    cp "$DETECTED_NVM_NODE" "$RUNTIME_NODE"
    chmod 755 "$RUNTIME_NODE"
    log_success "Copied verified Node runtime into isolated daemon path: $RUNTIME_NODE"
  elif [ -n "$SYSTEM_NODE" ]; then
    log_info "Symlinking system Node.js ($($SYSTEM_NODE -v)) into dedicated runtime..."
    ln -sf "$SYSTEM_NODE" "$RUNTIME_NODE"
  else
    log_info "Downloading standalone Node.js LTS binary directly into ${RUNTIME_DIR}..."
    NODE_LTS_TAR="node-v20.12.2-linux-${ARCH_NODE}.tar.xz"
    NODE_URL="https://nodejs.org/dist/v20.12.2/${NODE_LTS_TAR}"
    TMP_NODE="/tmp/${NODE_LTS_TAR}"
    
    curl -sSL "$NODE_URL" -o "$TMP_NODE"
    tar -xJf "$TMP_NODE" -C "$RUNTIME_DIR" --strip-components=1
    rm -f "$TMP_NODE"
    log_success "Dedicated Node runtime installed successfully."
  fi
fi

# Verify runtime execution
FINAL_VER=$("$RUNTIME_NODE" -v)
log_success "Active daemon runtime: ${FINAL_VER} (Path: ${RUNTIME_NODE})"

# ------------------------------------------------------------------------------
# 3. Docker Monitoring Capability Check
# ------------------------------------------------------------------------------
DOCKER_SOCKET="/var/run/docker.sock"
HAS_DOCKER=false
if [ -S "$DOCKER_SOCKET" ] || command -v docker >/dev/null 2>&1; then
  HAS_DOCKER=true
  log_info "Docker environment detected on host."
fi

if [ -z "$ENABLE_DOCKER" ]; then
  if [ "$NON_INTERACTIVE" = true ]; then
    ENABLE_DOCKER=$HAS_DOCKER
  elif [ "$HAS_DOCKER" = true ]; then
    echo ""
    echo -e "${YELLOW}Notice:${NC} Docker monitoring grants the agent read access to container metrics via ${DOCKER_SOCKET}."
    read -r -p "Enable container metrics and status monitoring? [Y/n] " response
    case "$response" in
      [nN][oO]|[nN])
        ENABLE_DOCKER=false
        ;;
      *)
        ENABLE_DOCKER=true
        ;;
    esac
  else
    ENABLE_DOCKER=false
  fi
fi

# ------------------------------------------------------------------------------
# 4. Service User & Permissions (Least Privilege)
# ------------------------------------------------------------------------------
log_info "Configuring service user and security policies..."

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --shell /bin/false --home-dir /opt/gravity "$SERVICE_USER" || true
  log_success "Created system user: ${SERVICE_USER}"
fi

# Docker group configuration if enabled
if [ "$ENABLE_DOCKER" = true ] && [ -S "$DOCKER_SOCKET" ]; then
  if getent group docker >/dev/null 2>&1; then
    usermod -aG docker "$SERVICE_USER" || true
    log_success "Added ${SERVICE_USER} to 'docker' group for container socket access"
  fi
fi

# ------------------------------------------------------------------------------
# 5. Deploy Daemon Code & CLI
# ------------------------------------------------------------------------------
log_info "Deploying Gravity Agent daemon files..."

# If source files exist in current script directory, copy them
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/src/index.js" ]; then
  cp -r "$SCRIPT_DIR/src" "$INSTALL_DIR/"
else
  # Download daemon and CLI directly from API server
  curl -sSL "${API_URL}/api/agent/source/index.js" -o "$INSTALL_DIR/src/index.js" 2>/dev/null || true
  curl -sSL "${API_URL}/api/agent/source/cli.js" -o "$INSTALL_DIR/src/cli.js" 2>/dev/null || true
fi

# Create global CLI wrapper script
cat << EOF > "$CLI_LINK"
#!/usr/bin/env bash
"${RUNTIME_NODE}" "${INSTALL_DIR}/src/cli.js" "\$@"
EOF
chmod 755 "$CLI_LINK"
ln -sf "$CLI_LINK" "$CLI_ALIAS"
ln -sf "$CLI_LINK" "$CLI_UPTIME_ALIAS"

# ------------------------------------------------------------------------------
# 6. Credentials & Environment Configuration
# ------------------------------------------------------------------------------
log_info "Writing protected configuration to ${CONFIG_DIR}/agent.env..."

EXISTING_TOKEN=""
EXISTING_SERVER_ID=""
if [ -f "$CONFIG_DIR/agent.env" ]; then
  EXISTING_TOKEN=$(grep -E '^API_TOKEN=' "$CONFIG_DIR/agent.env" | head -n1 | cut -d'=' -f2- || true)
  EXISTING_SERVER_ID=$(grep -E '^SERVER_ID=' "$CONFIG_DIR/agent.env" | head -n1 | cut -d'=' -f2- || true)
fi

cat << EOF > "$CONFIG_DIR/agent.env"
# Gravity Agent Daemon Environment (Uptime Suite)
API_URL=${API_URL}
INSTALL_TOKEN=${INSTALL_TOKEN}
SERVER_NAME=${SERVER_NAME}
DOCKER_ENABLED=${ENABLE_DOCKER}
GRAVITY_VERSION=${AGENT_VERSION}
EOF

if [ -n "$EXISTING_TOKEN" ]; then
  echo "API_TOKEN=${EXISTING_TOKEN}" >> "$CONFIG_DIR/agent.env"
fi
if [ -n "$EXISTING_SERVER_ID" ]; then
  echo "SERVER_ID=${EXISTING_SERVER_ID}" >> "$CONFIG_DIR/agent.env"
fi

chmod 600 "$CONFIG_DIR/agent.env"
chown -R "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "/opt/gravity"

# ------------------------------------------------------------------------------
# 7. Systemd Service Configuration (No NVM Reference)
# ------------------------------------------------------------------------------
log_info "Generating hardened systemd service unit..."

cat << EOF > "$SERVICE_FILE"
[Unit]
Description=Gravity Monitoring Agent (Uptime Suite)
Documentation=https://github.com/Aashbinsibi/uptime
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${CONFIG_DIR}/agent.env
ExecStart=${RUNTIME_NODE} ${INSTALL_DIR}/src/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# ------------------------------------------------------------------------------
# 8. Post-Installation Validation & Activation (No False Success)
# ------------------------------------------------------------------------------
log_info "Reloading systemd daemon and starting service..."

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

log_info "Validating service startup state..."
sleep 2

if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  echo ""
  log_error "Gravity Agent failed to start!"
  echo "--------------------------------------------------------"
  systemctl status "$SERVICE_NAME" --no-pager || true
  echo "--------------------------------------------------------"
  echo "Recent failure logs:"
  journalctl -u "$SERVICE_NAME" -n 15 --no-pager || true
  echo "--------------------------------------------------------"
  log_error "Installation failed post-startup validation. Please check the logs above."
  exit 1
fi

echo ""
echo -e "${GREEN}=======================================================${NC}"
echo -e "${GREEN}✓ Gravity Agent v${AGENT_VERSION} installed successfully!       ${NC}"
echo -e "${GREEN}=======================================================${NC}"
echo -e "  Service Status:       ${GREEN}ACTIVE (Running)${NC}"
echo -e "  Dedicated Runtime:    ${GREEN}${RUNTIME_NODE}${NC}"
echo -e "  Systemd Service:      ${GREEN}${SERVICE_NAME}.service${NC}"
echo -e "  Docker Monitoring:    ${GREEN}${ENABLE_DOCKER}${NC}"
echo -e "  Command-line CLI:     ${GREEN}gravity health${NC}"
echo ""
echo "Management commands:"
echo "  gravity status    - Show service and process status"
echo "  gravity health    - Check end-to-end monitoring health"
echo "  gravity diagnose  - Run deep diagnostic checks"
echo "  gravity logs      - View live telemetry logs"
echo ""
