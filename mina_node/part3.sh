#!/usr/bin/env bash
set -euo pipefail

################################################################################
# Part 3: Mina Block-Producing Node Setup (AMD64 Only)
#
# - Bails out if not x86_64 architecture
# - Checks if Mina node is already running via systemd/docker
# - Fetches block producer key from AWS Secrets Manager (STS validation included)
# - Sets up a systemd unit to manage the mina-daemon docker container
# - Idempotent: Skips steps when not needed
################################################################################

AWS_REGION="eu-central-1"
BLOCK_PRODUCER_SECRET_NAME="zkusd/dev/mina-node/block-producer-key"

# Paths and files
MINA_KEYS_DIR="${HOME}/.mina-config/keys"
MINA_KEYFILE="${MINA_KEYS_DIR}/my-wallet"
MINA_CONFIG_DIR="${HOME}/.mina-config"

# Docker image to use (focal or bullseye - you're free to change)
MINA_IMAGE="minaprotocol/mina-daemon:3.0.3.1-cc59a03-focal-mainnet"

# Systemd
SYSTEMD_SERVICE_NAME="mina-node"
SYSTEMD_SERVICE_FILE="/etc/systemd/system/${SYSTEMD_SERVICE_NAME}.service"

################################################################################
# 0) Architecture Check
################################################################################
echo "------------------------------"
echo "[INFO] Checking system architecture..."

ARCH=$(uname -m)
if [[ "${ARCH}" != "x86_64" ]]; then
  echo "[ERROR] This script is for AMD64/x86_64 only! Detected arch='${ARCH}'. Exiting."
  exit 1
fi

echo "[INFO] Architecture is x86_64. Proceeding..."

################################################################################
# 1) Check if Mina Node is Already Running
################################################################################
echo "------------------------------"
echo "[INFO] Checking if Mina node is already running..."

if systemctl is-active --quiet "${SYSTEMD_SERVICE_NAME}"; then
  echo "[INFO] Systemd service '${SYSTEMD_SERVICE_NAME}' is already active. Idempotent exit."
  exit 0
fi

if docker ps --format '{{.Names}}' | grep -q '^mina-daemon$'; then
  echo "[INFO] A container named 'mina-daemon' is running without systemd. Skipping to avoid conflict."
  exit 0
fi

echo "[INFO] Mina node is not running. Proceeding with setup..."

################################################################################
# 2) Verify AWS CLI Credentials & Fetch Block Producer Key
################################################################################
echo "------------------------------"
echo "[INFO] Verifying AWS CLI credentials before attempting secrets fetch..."

if ! timeout 10 aws sts get-caller-identity --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "[ERROR] AWS CLI credentials are invalid or expired. Aborting setup!"
  exit 1
fi

echo "[INFO] AWS credentials verified."

if [[ ! -f "${MINA_KEYFILE}" ]]; then
  echo "[INFO] Block producer key not found at '${MINA_KEYFILE}'. Fetching from Secrets Manager..."

  mkdir -p "${MINA_KEYS_DIR}"
  chmod 700 "${MINA_KEYS_DIR}"

  BLOCK_PRODUCER_SECRET_ARN=$(aws secretsmanager list-secrets \
    --region "${AWS_REGION}" \
    --cli-connect-timeout 1 \
    --query "SecretList[?Name=='${BLOCK_PRODUCER_SECRET_NAME}'].ARN | [0]" \
    --output text | grep -v None | head -n 1)

  if [[ -z "${BLOCK_PRODUCER_SECRET_ARN}" ]]; then
      echo "[ERROR] Could not find secret '${BLOCK_PRODUCER_SECRET_NAME}' in Secrets Manager!"
      exit 1
  fi

  echo "[INFO] Found secret ARN: ${BLOCK_PRODUCER_SECRET_ARN}. Fetching secret..."

  if ! timeout 15 aws secretsmanager get-secret-value \
       --secret-id "${BLOCK_PRODUCER_SECRET_ARN}" \
       --region "${AWS_REGION}" \
    --cli-connect-timeout 1 \
    --query SecretString \
    --output text > "${MINA_KEYFILE}"; then
    echo "[ERROR] Failed to fetch block producer key from Secrets Manager!"
    exit 1
  fi

  chmod 600 "${MINA_KEYFILE}"
  echo "[INFO] Block producer key successfully placed at '${MINA_KEYFILE}'."
else
  echo "[INFO] Block producer key already exists at '${MINA_KEYFILE}'."
fi

################################################################################
# 3) Check Docker Image Presence
################################################################################
echo "------------------------------"
echo "[INFO] Checking Docker image '${MINA_IMAGE}'..."

IMAGE_EXISTS=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -c "^${MINA_IMAGE}$" || true)

if [[ "${IMAGE_EXISTS}" -gt 0 ]]; then
  echo "[INFO] Docker image '${MINA_IMAGE}' already exists locally. Skipping pull."
else
  echo "[INFO] Docker image '${MINA_IMAGE}' not found. Pulling..."
  docker pull "${MINA_IMAGE}" || { echo "[ERROR] Failed to pull docker image!"; exit 1; }
  echo "[INFO] Docker image pulled successfully."
fi

################################################################################
# 4) Create systemd Service for Mina Node
################################################################################
echo "------------------------------"
echo "[INFO] Setting up systemd service '${SYSTEMD_SERVICE_NAME}'..."

if [[ ! -f "${SYSTEMD_SERVICE_FILE}" ]]; then
  cat <<EOF | sudo tee "${SYSTEMD_SERVICE_FILE}" > /dev/null
[Unit]
Description=Mina Block Producer Node
After=docker.service
Requires=docker.service

[Service]
Type=simple
ExecStart=/usr/bin/docker run \\
  --name mina-daemon \\
  --network host \\
  --restart unless-stopped \\
  -v ${MINA_KEYS_DIR}:/root/.mina-config/keys:ro \\
  -v ${MINA_CONFIG_DIR}:/root/.mina-config \\
  ${MINA_IMAGE} \\
  daemon \\
    --peer-list-url https://storage.googleapis.com/mina-seed-lists/mainnet_seeds.txt \\
    --external-port 8302 \\
    --rest-port 3085 \\
    --block-producer-key /root/.mina-config/keys/my-wallet

ExecStop=/usr/bin/docker stop mina-daemon
ExecStopPost=/usr/bin/docker rm -f mina-daemon

Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

  echo "[INFO] Systemd service file created at '${SYSTEMD_SERVICE_FILE}'."
else
  echo "[INFO] Systemd service file already exists. Skipping creation."
fi

################################################################################
# 5) Start & Enable the Mina Node Service
################################################################################
echo "------------------------------"
echo "[INFO] Reloading systemd daemon and enabling service..."

sudo systemctl daemon-reload

if ! systemctl is-enabled --quiet "${SYSTEMD_SERVICE_NAME}"; then
  echo "[INFO] Enabling service '${SYSTEMD_SERVICE_NAME}'..."
  sudo systemctl enable "${SYSTEMD_SERVICE_NAME}"
else
  echo "[INFO] Service '${SYSTEMD_SERVICE_NAME}' already enabled."
fi

if ! systemctl is-active --quiet "${SYSTEMD_SERVICE_NAME}"; then
  echo "[INFO] Starting service '${SYSTEMD_SERVICE_NAME}'..."
  sudo systemctl start "${SYSTEMD_SERVICE_NAME}"
else
  echo "[INFO] Service '${SYSTEMD_SERVICE_NAME}' already active."
fi

################################################################################
# 6) Verify & Report Status
################################################################################
echo "------------------------------"
echo "[INFO] Verifying service status..."

sleep 5  # Give it a few seconds to initialize

if systemctl is-active --quiet "${SYSTEMD_SERVICE_NAME}"; then
  echo "[INFO] Mina node systemd service '${SYSTEMD_SERVICE_NAME}' is running."
else
  echo "[ERROR] Mina node systemd service '${SYSTEMD_SERVICE_NAME}' failed to start!"
  sudo systemctl status "${SYSTEMD_SERVICE_NAME}"
  exit 1
fi

echo "[INFO] Fetching last 20 lines of Docker logs for 'mina-daemon' container..."
docker logs --tail 20 mina-daemon || echo "[WARN] Unable to fetch docker logs."

echo "[INFO] Running 'mina client status' inside the container..."
docker exec mina-daemon mina client status || echo "[WARN] 'mina client status' failed. Check sync state manually."

################################################################################
# 7) Done
################################################################################
echo "------------------------------"
echo "✅ Mina block-producing node setup complete!"
echo "✅ Systemd service: ${SYSTEMD_SERVICE_NAME} is running"
echo "✅ Docker container: mina-daemon is running"
echo "------------------------------"
