#!/usr/bin/env bash
set -euo pipefail

################################################################################
# 🚀 Mina Block-Producing Node Setup Script
#
# Description:
#   - Configures and deploys a Mina block-producing node on Devnet.
#   - Runs as a systemd service under a specified non-root user.
#   - Ensures production-grade logging with log rotation.
#
################################################################################

# Defaults
AWS_REGION="eu-central-1"
COMBINED_SECRET_NAME="zkusd/dev/mina-node/block-producer-keys"
S3_BUCKET="zkusd-dev-configs"
DAEMON_CONFIG_S3_PATH="mina-node/mina-daemon.json"

# Dynamically detect or accept user
MINA_NODE_USER="${MINA_NODE_USER:-$(whoami)}"
MINA_NODE_GROUP="${MINA_NODE_GROUP:-$(id -gn $MINA_NODE_USER)}"

# User home directory
USER_HOME_DIR=$(eval echo "~$MINA_NODE_USER")

# Paths
MINA_CONFIG_DIR="${USER_HOME_DIR}/.mina-config"
MINA_KEYS_DIR="${MINA_CONFIG_DIR}/keys"
MINA_KEYFILE="${MINA_KEYS_DIR}/my-wallet"
DAEMON_CONFIG_LOCAL="${MINA_CONFIG_DIR}/daemon.json"

# Systemd and Logging
SYSTEMD_SERVICE_NAME="mina-node"
SYSTEMD_SERVICE_FILE="/etc/systemd/system/${SYSTEMD_SERVICE_NAME}.service"
LOG_DIR="/var/log/${SYSTEMD_SERVICE_NAME}"
LOG_FILE="${LOG_DIR}/${SYSTEMD_SERVICE_NAME}.log"
LOGROTATE_CONFIG_FILE="/etc/logrotate.d/${SYSTEMD_SERVICE_NAME}"

echo "[INFO] Starting Mina Block Producer setup for user: ${MINA_NODE_USER}"
echo "[INFO] Logs: ${LOG_FILE}"

################################################################################
# 1) Ensure Configuration Directories Exist (idempotent)
################################################################################
echo "[INFO] Creating configuration directories at ${MINA_CONFIG_DIR}..."
sudo -u "${MINA_NODE_USER}" mkdir -p "$MINA_KEYS_DIR" "$MINA_CONFIG_DIR"
sudo chown -R "${MINA_NODE_USER}:${MINA_NODE_GROUP}" "$MINA_CONFIG_DIR"
sudo chmod 700 "$MINA_KEYS_DIR" "$MINA_CONFIG_DIR"

################################################################################
# 2) Ensure Log Directory Exists (idempotent)
################################################################################
echo "[INFO] Ensuring log directory exists at ${LOG_DIR}..."
sudo mkdir -p "$LOG_DIR"
sudo chown "${MINA_NODE_USER}:${MINA_NODE_GROUP}" "$LOG_DIR"
sudo chmod 750 "$LOG_DIR"

################################################################################
# 3) Verify AWS CLI Credentials & Fetch Secrets
################################################################################
echo "[INFO] Verifying AWS CLI credentials..."
if ! timeout 10 aws sts get-caller-identity --region "${AWS_REGION}" >/dev/null 2>&1; then
  echo "[ERROR] AWS CLI credentials are invalid or expired."
  exit 1
fi

echo "[INFO] Fetching block producer secrets from AWS Secrets Manager..."
COMBINED_SECRET_JSON=$(AWS_MAX_ATTEMPTS=2 \
  AWS_RETRY_MODE=standard \
  aws secretsmanager get-secret-value \
    --region "$AWS_REGION" \
    --cli-connect-timeout 1 \
    --secret-id "$COMBINED_SECRET_NAME" \
    --query SecretString \
    --output text)

BLOCK_PRODUCER_KEY=$(echo "$COMBINED_SECRET_JSON" | jq -r '.block_producer_key')
BLOCK_PRODUCER_PASSWORD=$(echo "$COMBINED_SECRET_JSON" | jq -r '.block_producer_password')
BLOCK_PRODUCER_PUBLIC_KEY=$(echo "$COMBINED_SECRET_JSON" | jq -r '.block_producer_public_key')

################################################################################
# 4) Write Private Key (idempotent)
################################################################################
echo "[INFO] Writing block producer private key to ${MINA_KEYFILE}..."
echo "$BLOCK_PRODUCER_KEY" | sudo tee "$MINA_KEYFILE" > /dev/null
sudo chown "${MINA_NODE_USER}:${MINA_NODE_GROUP}" "$MINA_KEYFILE"
sudo chmod 600 "$MINA_KEYFILE"

################################################################################
# 5) Download and Configure mina-daemon.json (idempotent)
################################################################################
echo "[INFO] Downloading daemon config from S3..."
aws s3 cp "s3://${S3_BUCKET}/${DAEMON_CONFIG_S3_PATH}" "${DAEMON_CONFIG_LOCAL}" --region "${AWS_REGION}"

jq --arg key "${MINA_KEYFILE}" \
   --arg pass "${BLOCK_PRODUCER_PASSWORD}" \
   --arg pub "${BLOCK_PRODUCER_PUBLIC_KEY}" \
   '
   .daemon["block-producer-key"] = $key |
   .daemon["block-producer-password"] = $pass |
   .daemon["coinbase-receiver"] = $pub
   ' "${DAEMON_CONFIG_LOCAL}" > "${DAEMON_CONFIG_LOCAL}.tmp" && mv "${DAEMON_CONFIG_LOCAL}.tmp" "${DAEMON_CONFIG_LOCAL}"

sudo chown "${MINA_NODE_USER}:${MINA_NODE_GROUP}" "${DAEMON_CONFIG_LOCAL}"
sudo chmod 600 "${DAEMON_CONFIG_LOCAL}"
################################################################################
# 6) Create/Update systemd Service (idempotent)
################################################################################
echo "[INFO] Creating/updating systemd service '${SYSTEMD_SERVICE_NAME}'..."

MINA_BIN_PATH=$(command -v mina)

read -r -d '' SYSTEMD_UNIT <<EOF || true
[Unit]
Description=Mina Block Producer Node (Devnet)
After=network.target

[Service]
User=${MINA_NODE_USER}
Group=${MINA_NODE_GROUP}
Type=simple

ExecStart=${MINA_BIN_PATH} daemon \\
  --peer-list-url https://bootnodes.minaprotocol.com/networks/devnet.txt \\
  --config-file ${DAEMON_CONFIG_LOCAL} \\
  --log-level Info \\
  --log-json

Restart=always
RestartSec=10

# Logs
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

# Security Hardening
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${MINA_CONFIG_DIR}
PrivateTmp=true
PrivateDevices=true

[Install]
WantedBy=multi-user.target
EOF

echo "$SYSTEMD_UNIT" | sudo tee "${SYSTEMD_SERVICE_FILE}" > /dev/null
echo "[INFO] Systemd service file created/updated at '${SYSTEMD_SERVICE_FILE}'."

################################################################################
# 7) Configure Log Rotation (idempotent)
################################################################################
echo "[INFO] Setting up logrotate for ${LOG_FILE}..."

LOGROTATE_CONF=$(cat <<EOF
${LOG_FILE} {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF
)

echo "$LOGROTATE_CONF" | sudo tee "$LOGROTATE_CONFIG_FILE" > /dev/null
echo "[INFO] Logrotate configuration updated at '${LOGROTATE_CONFIG_FILE}'."

################################################################################
# 8) Reload systemd, Enable & Start Service
################################################################################
echo "[INFO] Reloading systemd and starting service..."
sudo systemctl daemon-reload
sudo systemctl enable "${SYSTEMD_SERVICE_NAME}" --now
sudo systemctl restart "${SYSTEMD_SERVICE_NAME}"

################################################################################
# 9) Verify & Report Status
################################################################################
echo "[INFO] Verifying Mina node systemd service status..."
sleep 5

if sudo systemctl is-active --quiet "${SYSTEMD_SERVICE_NAME}"; then
  echo "[INFO] Mina node service '${SYSTEMD_SERVICE_NAME}' is running."
else
  echo "[ERROR] Mina node service '${SYSTEMD_SERVICE_NAME}' failed to start!"
  sudo systemctl status "${SYSTEMD_SERVICE_NAME}" --no-pager
  exit 1
fi

echo "[INFO] Last 20 lines of Mina service logs:"
sudo journalctl -u "${SYSTEMD_SERVICE_NAME}" --no-pager -n 20

################################################################################
# 10) Done
################################################################################
echo "------------------------------"
echo "✅ Mina block-producing node setup complete!"
echo "✅ Systemd service: ${SYSTEMD_SERVICE_NAME} is running"
echo "------------------------------"
