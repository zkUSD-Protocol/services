#!/usr/bin/env bash
set -euo pipefail

################################################################################
# Mina Block-Producing Node Setup (AMD64 Only)
################################################################################

# Variables
MINA_IMAGE="minaprotocol/mina-daemon:3.0.3.1-cc59a03-focal-mainnet"
AWS_REGION="eu-central-1"
COMBINED_SECRET_NAME="zkusd/dev/mina-node/block-producer-keys"

S3_BUCKET="zkusd-dev-configs"
DAEMON_CONFIG_S3_PATH="mina-node/mina-daemon.json"

# Paths
MINA_CONFIG_DIR="${HOME}/.mina-config"
MINA_CONFIG_DIR="${HOME}/.mina-config"
MINA_KEYS_DIR="${MINA_CONFIG_DIR}/keys"
MINA_KEYFILE="${MINA_KEYS_DIR}/my-wallet"
DOCKER_KEYFILE="/root/.mina-config/keys/my-wallet"
DAEMON_CONFIG_LOCAL="${MINA_CONFIG_DIR}/daemon.json"

# Systemd variables
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
# 1) Ensure Directories and Mount tmpfs for Keys
################################################################################
echo "------------------------------"
echo "[INFO] Setting up directories and mounting tmpfs if necessary..."
mkdir -p "$MINA_KEYS_DIR"
mkdir -p "$MINA_CONFIG_DIR"

if ! mountpoint -q "$MINA_KEYS_DIR"; then
    echo "[INFO] Mounting tmpfs at ${MINA_KEYS_DIR}..."
    sudo mount -t tmpfs -o size=1M,uid=$(id -u),gid=$(id -g),mode=0700 tmpfs "$MINA_KEYS_DIR"
fi

chmod 700 "$MINA_KEYS_DIR"

################################################################################
# 2) Stop & Remove Existing Mina Node (if any)
################################################################################
echo "------------------------------"
echo "[INFO] Stopping and removing any existing Mina node container or service..."

if systemctl is-active --quiet "${SYSTEMD_SERVICE_NAME}"; then
  echo "[INFO] Stopping systemd service '${SYSTEMD_SERVICE_NAME}'..."
  sudo systemctl stop "${SYSTEMD_SERVICE_NAME}"
fi

if docker ps -a --format '{{.Names}}' | grep -q '^mina-daemon$'; then
    echo "[INFO] Removing existing Docker container 'mina-daemon'..."
    docker stop mina-daemon
    docker rm -f mina-daemon || true
fi

################################################################################
# 3) Verify AWS CLI Credentials & Fetch Combined Secret
################################################################################
echo "------------------------------"
echo "[INFO] Verifying AWS CLI credentials..."
if ! timeout 10 aws sts get-caller-identity --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "[ERROR] AWS CLI credentials are invalid or expired. Aborting setup!"
  exit 1
fi
echo "[INFO] AWS credentials verified."

echo "[INFO] Fetching combined block producer secrets from AWS Secrets Manager..."
COMBINED_SECRET_JSON=$(aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$COMBINED_SECRET_NAME" \
  --query SecretString \
  --output text)

BLOCK_PRODUCER_KEY=$(echo "$COMBINED_SECRET_JSON" | jq -r '.block_producer_key')
BLOCK_PRODUCER_PASSWORD=$(echo "$COMBINED_SECRET_JSON" | jq -r '.block_producer_password')
BLOCK_PRODUCER_PUBLIC_KEY=$(echo "$COMBINED_SECRET_JSON" | jq -r '.block_producer_public_key')

################################################################################
# 4) Write Private Key to File
################################################################################
echo "------------------------------"
echo "[INFO] Writing block producer private key to ${MINA_KEYFILE}..."
echo "$BLOCK_PRODUCER_KEY" > "${MINA_KEYFILE}"
chmod 600 "${MINA_KEYFILE}"

################################################################################
# 5) Download and Populate mina-daemon.json
################################################################################
echo "------------------------------"
echo "[INFO] Downloading mina-daemon.json from S3 bucket ${S3_BUCKET}..."
aws s3 cp "s3://${S3_BUCKET}/${DAEMON_CONFIG_S3_PATH}" "${DAEMON_CONFIG_LOCAL}" --region "${AWS_REGION}"

jq --arg key "${DOCKER_KEYFILE}" \
   --arg pass "${BLOCK_PRODUCER_PASSWORD}" \
   --arg pub "${BLOCK_PRODUCER_PUBLIC_KEY}" \
   '
   .daemon["block-producer-key"] = $key |
   .daemon["block-producer-password"] = $pass |
   .daemon["coinbase-receiver"] = $pub
   ' "${DAEMON_CONFIG_LOCAL}" > "${DAEMON_CONFIG_LOCAL}.tmp" && mv "${DAEMON_CONFIG_LOCAL}.tmp" "${DAEMON_CONFIG_LOCAL}"

################################################################################
# 6) Update Docker Image
################################################################################
echo "------------------------------"
echo "[INFO] Pulling latest Docker image '${MINA_IMAGE}'..."
docker pull "${MINA_IMAGE}" || { echo "[ERROR] Failed to pull docker image!"; exit 1; }
echo "[INFO] Docker image updated."

################################################################################
# 7) Create or Update systemd Service for Mina Node
################################################################################
echo "------------------------------"
echo "[INFO] Creating/updating systemd service '${SYSTEMD_SERVICE_NAME}'..."

read -r -d '' SYSTEMD_UNIT <<EOF || true
[Unit]
Description=Mina Block Producer Node
After=docker.service
Requires=docker.service

[Service]
Type=simple
ExecStart=/usr/bin/docker run --name mina-daemon --network host --restart unless-stopped \\
  -v ${MINA_KEYS_DIR}:/root/.mina-config/keys:ro \\
  -v ${MINA_CONFIG_DIR}:/root/.mina-config \\
  ${MINA_IMAGE} daemon \\
    --config-file /root/.mina-config/daemon.json

ExecStop=/usr/bin/docker stop mina-daemon
ExecStopPost=/usr/bin/docker rm -f mina-daemon

Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

echo "$SYSTEMD_UNIT" | sudo tee "${SYSTEMD_SERVICE_FILE}" > /dev/null
echo "[INFO] Systemd service file updated at '${SYSTEMD_SERVICE_FILE}'."

################################################################################
# 8) Reload systemd, Enable and Start the Service
################################################################################
echo "------------------------------"
echo "[INFO] Reloading systemd daemon..."
sudo systemctl daemon-reload

echo "[INFO] Enabling and starting systemd service '${SYSTEMD_SERVICE_NAME}'..."
sudo systemctl enable "${SYSTEMD_SERVICE_NAME}" --now
sudo systemctl restart "${SYSTEMD_SERVICE_NAME}"

################################################################################
# 9) Verify & Report Status
################################################################################
echo "------------------------------"
echo "[INFO] Verifying service status..."
sleep 5

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
# 10) Done
################################################################################
echo "------------------------------"
echo "✅ Mina block-producing node setup complete!"
echo "✅ Systemd service: ${SYSTEMD_SERVICE_NAME} is running"
echo "✅ Docker container: mina-daemon is running"
echo "------------------------------"
