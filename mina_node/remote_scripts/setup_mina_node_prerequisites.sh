#!/usr/bin/env bash
set -euo pipefail

################################################################################
# Remote Setup Script
# To be called by setup.sh script (or invoked manually)
#
# Purpose:
#   - Verify the host OS (Ubuntu 20.04 LTS)
#   - Install AWS CLI (host architecture) if not installed
#   - Install Docker (and Docker Compose plugin) if not installed
#   - Setup Mina repository and install Mina Node software (idempotent)
#   - Verify service health after install
#   - Log output to both console (minimal) and a logfile (detailed)
################################################################################

AWS_REGION="eu-central-1"
CREDENTIALS_SOURCE_FILE="assumed_role_creds"
LOG_FILE="/tmp/setup_mina_node_$(date +'%Y%m%d_%H%M%S').log"

# Default behavior is quiet unless --debug is passed
DEBUG=false
RETRIES=3
RETRY_INTERVAL=5

### Trap cleanup on exit or interrupt
cleanup() {
  log "Cleaning up temporary files and restoring environment (if needed)..."
}
trap cleanup EXIT
trap 'error "Script interrupted by user"; exit 1' SIGINT SIGTERM

### Logging functions
log() {
  local msg="[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"
  echo "$msg" >> "$LOG_FILE"
  if [[ "$DEBUG" == true ]]; then
    echo "$msg" >&2
  fi
}

error() {
  local msg="[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ❌ $*"
  echo "$msg" | tee -a "$LOG_FILE" >&2
}

info() {
  local msg="[INFO] $*"
  echo "$msg" | tee -a "$LOG_FILE" >&2
}

### Retry wrapper
retry() {
  local attempt=0
  local max_attempts=$RETRIES
  local delay=$RETRY_INTERVAL
  until "$@"; do
    attempt=$((attempt + 1))
    if (( attempt >= max_attempts )); then
      error "Command failed after $attempt attempts: $*"
      return 1
    fi
    log "Retry $attempt/$max_attempts: $*"
    sleep "$delay"
  done
}

################################################################################
# Parse arguments
################################################################################
for arg in "$@"; do
  if [[ "$arg" == "--debug" || "$arg" == "--verbose" ]]; then
    DEBUG=true
  fi
done

echo "📄 Logging to: $LOG_FILE"
info "Starting remote Mina node prerequisites setup..."

################################################################################
# Verify OS Version
################################################################################
info "Verifying OS version is Ubuntu 20.04 LTS..."
OS_NAME=$(lsb_release -is)
OS_VERSION=$(lsb_release -rs)

if [[ "$OS_NAME" != "Ubuntu" || "$OS_VERSION" != "20.04" ]]; then
  error "Unsupported OS: $OS_NAME $OS_VERSION. Only Ubuntu 20.04 LTS is supported."
  exit 1
fi

log "OS verified: $OS_NAME $OS_VERSION"

################################################################################
# Ensure Basic Packages
################################################################################
info "Checking and installing base packages..."
retry sudo apt-get update -y -qq
retry sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl unzip jq gnupg lsb-release ca-certificates

log "Base packages installed."

################################################################################
# Install AWS CLI (based on host architecture)
################################################################################
if ! command -v aws &>/dev/null; then
  info "AWS CLI not found. Installing..."

  ARCH_RAW=$(uname -m)
  case "$ARCH_RAW" in
    x86_64)  ARCH="x86_64" ;;
    aarch64) ARCH="aarch64" ;;
    arm64)   ARCH="aarch64" ;;
    *) error "Unsupported architecture: $ARCH_RAW"; exit 1 ;;
  esac

  AWSCLI_URL="https://awscli.amazonaws.com/awscli-exe-linux-${ARCH}.zip"

  TMP_DIR=$(mktemp -d)
  pushd "$TMP_DIR" >/dev/null

  retry curl -fsSL "$AWSCLI_URL" -o awscliv2.zip
  unzip -q awscliv2.zip
  sudo ./aws/install

  popd >/dev/null
  rm -rf "$TMP_DIR"

  if ! command -v aws &>/dev/null; then
    error "AWS CLI installation failed!"
    exit 1
  fi

  log "AWS CLI installed successfully for $ARCH_RAW."
else
  log "AWS CLI already installed: $(aws --version)"
fi

################################################################################
# Place Temporary STS Credentials (Optional)
################################################################################
if [[ -f "$CREDENTIALS_SOURCE_FILE" ]]; then
  info "Found '$CREDENTIALS_SOURCE_FILE'. Moving to ~/.aws/credentials..."
  mkdir -p ~/.aws
  mv "$CREDENTIALS_SOURCE_FILE" ~/.aws/credentials
  chmod 600 ~/.aws/credentials
else
  log "No STS credentials file found. Skipping."
fi

info "Verifying AWS access..."
if aws sts get-caller-identity --region "$AWS_REGION" >/dev/null 2>&1; then
  log "AWS CLI credentials working."
else
  error "AWS CLI credentials not working."
fi

################################################################################
# Install Docker (CE)
################################################################################
if ! command -v docker &>/dev/null; then
  info "Docker not found. Installing..."

  sudo install -m 0755 -d /etc/apt/keyrings
  retry curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  ARCH=$(dpkg --print-architecture)
  echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  retry sudo apt-get update -qq
  retry sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  sudo systemctl enable docker
  sudo systemctl start docker

  if ! groups "$USER" | grep -q docker; then
    sudo usermod -aG docker "$USER"
    info "Added user '$USER' to docker group. Please log out and log back in for group changes to take effect."
  fi

  log "Docker installed."
else
  log "Docker already installed: $(docker --version)"
fi

info "Checking Docker service..."
if ! systemctl is-active --quiet docker; then
  error "Docker service inactive. Attempting restart..."
  sudo systemctl restart docker
  if ! systemctl is-active --quiet docker; then
    error "Docker service failed to start."
    exit 1
  fi
fi
log "Docker service is running."

################################################################################
# Setup Mina Repository and Install mina-devnet
################################################################################
info "Setting up Mina repository and installing mina-devnet..."

sudo rm -f /etc/apt/sources.list.d/mina*.list
REPO_LINE="deb [trusted=yes] http://packages.o1test.net $(lsb_release -cs) alpha"
echo "$REPO_LINE" | sudo tee /etc/apt/sources.list.d/mina-alpha.list >/dev/null

retry sudo apt-get update -qq

MINA_VERSION="3.0.4-alpha2-b8cdab0"

if dpkg-query -W -f='${Version}' mina 2>/dev/null | grep -q "$MINA_VERSION"; then
  log "mina $MINA_VERSION already installed."
else
  info "Installing mina $MINA_VERSION..."
  retry sudo DEBIAN_FRONTEND=noninteractive apt-get install --allow-downgrades -y -qq mina-devnet="$MINA_VERSION"
fi

################################################################################
# Health Checks After Install
################################################################################
info "Running health checks after setup..."

# if docker info >/dev/null 2>&1; then
#   log "Docker daemon running and responsive."
# else
#   error "Docker daemon not responsive."
#   exit 1
# fi

if command -v mina &>/dev/null; then
  log "mina installed successfully: $(mina --version)"
else
  error "mina command not found."
  exit 1
fi

################################################################################
# ✅ Completion
################################################################################
info "✅ Mina node prerequisites setup completed successfully!"
echo "📄 Detailed logs: $LOG_FILE"
