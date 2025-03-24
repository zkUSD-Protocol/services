#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Script: setup_mina_node_remote.sh
#
# Purpose:
#   - Assume IAM role to get temporary credentials
#   - Download terraform-outputs.json from S3
#   - Extract Mina node IP and username
#   - Retrieve SSH private key from AWS Secrets Manager
#   - Copy and run setup scripts on remote Mina node
#   - Clean up leftover scripts on the remote host
# -----------------------------------------------------------------------------

### Configuration
AWS_REGION="eu-central-1"
ROLE_ARN="arn:aws:iam::565802942559:role/zkusd-mina-node-role-role"
ROLE_SESSION_NAME="minaNodeSession"
S3_BUCKET="zkusd-terraform-outputs"
OUTPUT_FILE="terraform-outputs.json"

# Script filenames (moved into ./remote_scripts/)
PREREQUISITES_SCRIPT="./remote_scripts/setup_mina_node_prerequisites.sh"
SETUP_MINA_NODE_SCRIPT="./remote_scripts/setup_mina_node.sh"

# Secrets
SSH_PRIVATE_KEY_SECRET_NAME="zkusd/dev/mina-node/ssh/secret-key"

# Temporary files (use mktemp)
TEMP_SSH_PRIVATE_KEY="$(mktemp /tmp/mina-node-ssh-key-XXXXXX)"
TEMP_OUTPUT_FILE="$(mktemp /tmp/terraform-outputs-XXXXXX.json)"

# Debug flag
DEBUG=false

### Helper functions
log() {
  if [[ "$DEBUG" == true ]]; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*" >&2
  fi
}

error() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ❌ $*" >&2
}

cleanup() {
  log "[INFO] Cleaning up temporary files and credentials..."
  rm -f "$TEMP_SSH_PRIVATE_KEY" "$TEMP_OUTPUT_FILE"

  unset AWS_ACCESS_KEY_ID
  unset AWS_SECRET_ACCESS_KEY
  unset AWS_SESSION_TOKEN
}
trap cleanup EXIT

### Process script args (optional --debug)
for arg in "$@"; do
  if [[ "$arg" == "--debug" ]]; then
    DEBUG=true
    set -- "${@/--debug/}" # Remove --debug from args
    break
  fi
done

### Step 1: Assume IAM Role
log "------------------------------"
log "[INFO] Assuming IAM role to get temporary AWS credentials..."
STS_JSON="$(aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name "$ROLE_SESSION_NAME" \
  --region "$AWS_REGION" \
  --duration-seconds 3600 \
  --output json)"

AWS_ACCESS_KEY_ID="$(echo "$STS_JSON" | jq -r .Credentials.AccessKeyId)"
AWS_SECRET_ACCESS_KEY="$(echo "$STS_JSON" | jq -r .Credentials.SecretAccessKey)"
AWS_SESSION_TOKEN="$(echo "$STS_JSON" | jq -r .Credentials.SessionToken)"
EXPIRATION="$(echo "$STS_JSON" | jq -r .Credentials.Expiration)"

export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_SESSION_TOKEN

log "[INFO] Temporary credentials acquired. Expire at: ${EXPIRATION}"

### Step 2: Download terraform-outputs.json
log "------------------------------"
log "[INFO] Downloading terraform-outputs.json from S3..."
aws s3 cp "s3://${S3_BUCKET}/${OUTPUT_FILE}" "$TEMP_OUTPUT_FILE" --region "$AWS_REGION" --quiet || {
  error "Failed to download terraform-outputs.json from S3"
  exit 1
}

### Step 3: Extract IP and username
log "[INFO] Extracting Mina node connection details..."
MINA_NODE_IP="$(jq -r '.mina_node_ip.value' "$TEMP_OUTPUT_FILE")"
MINA_NODE_USERNAME="$(jq -r '.mina_node_username.value' "$TEMP_OUTPUT_FILE")"

if [[ -z "$MINA_NODE_IP" || -z "$MINA_NODE_USERNAME" ]]; then
  error "Failed to extract mina_node_ip or mina_node_username from terraform-outputs.json"
  exit 1
fi

log "[INFO] Node IP: $MINA_NODE_IP"
log "[INFO] Node Username: $MINA_NODE_USERNAME"

### Step 4: Retrieve SSH private key from Secrets Manager
log "------------------------------"
log "[INFO] Fetching SSH private key from AWS Secrets Manager..."
SSH_PRIVATE_KEY_SECRET_ARN=$(aws secretsmanager list-secrets \
  --region "$AWS_REGION" \
  --query "SecretList[?contains(Name, '${SSH_PRIVATE_KEY_SECRET_NAME}')].ARN" \
  --output text | grep -v None | head -n 1)

if [[ -z "$SSH_PRIVATE_KEY_SECRET_ARN" ]]; then
  error "Could not find SSH private key secret '$SSH_PRIVATE_KEY_SECRET_NAME' in AWS Secrets Manager"
  exit 1
fi

aws secretsmanager get-secret-value \
  --secret-id "$SSH_PRIVATE_KEY_SECRET_ARN" \
  --region "$AWS_REGION" \
  --query SecretString \
  --output text > "$TEMP_SSH_PRIVATE_KEY" || {
    error "Failed to retrieve SSH private key from Secrets Manager"
    exit 1
}

chmod 600 "$TEMP_SSH_PRIVATE_KEY"

### Step 5: Verify the scripts exist locally
log "------------------------------"
log "[INFO] Verifying local setup scripts exist..."
if [[ ! -f "$PREREQUISITES_SCRIPT" ]]; then
  error "Missing script: $PREREQUISITES_SCRIPT"
  exit 1
fi

if [[ ! -f "$SETUP_MINA_NODE_SCRIPT" ]]; then
  error "Missing script: $SETUP_MINA_NODE_SCRIPT"
  exit 1
fi

### Step 6: Copy prerequisites script to remote host
log "------------------------------"
log "[INFO] Copying $PREREQUISITES_SCRIPT to remote host..."
scp -i "$TEMP_SSH_PRIVATE_KEY" -o StrictHostKeyChecking=no -o BatchMode=yes \
  "$PREREQUISITES_SCRIPT" "${MINA_NODE_USERNAME}@${MINA_NODE_IP}:/home/${MINA_NODE_USERNAME}/" || {
    error "Failed to copy $PREREQUISITES_SCRIPT to remote host"
    exit 1
}

### Step 7: Verify SSH connectivity
log "------------------------------"
log "[INFO] Verifying SSH connectivity to $MINA_NODE_IP..."
ssh -i "$TEMP_SSH_PRIVATE_KEY" -o StrictHostKeyChecking=no -o BatchMode=yes \
  "${MINA_NODE_USERNAME}@${MINA_NODE_IP}" \
    'echo "✅ SSH connection successful! Remote machine: $(uname -a)"' || {
    error "SSH connection failed"
    exit 1
}

### Step 8: Execute prerequisites script remotely
log "------------------------------"
log "[INFO] Executing $PREREQUISITES_SCRIPT on remote host..."
ssh -i "$TEMP_SSH_PRIVATE_KEY" -o StrictHostKeyChecking=no -o BatchMode=yes \
  "${MINA_NODE_USERNAME}@${MINA_NODE_IP}" \
  "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID} AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY} AWS_SESSION_TOKEN=${AWS_SESSION_TOKEN} bash ~/${PREREQUISITES_SCRIPT##*/}" || {
    error "$PREREQUISITES_SCRIPT failed on remote host"
    exit 1
}

log "✅ Prerequisites script executed successfully."

# Remove the prerequisites script from remote
log "[INFO] Removing $PREREQUISITES_SCRIPT from remote host..."
ssh -i "$TEMP_SSH_PRIVATE_KEY" -o StrictHostKeyChecking=no -o BatchMode=yes \
  "${MINA_NODE_USERNAME}@${MINA_NODE_IP}" \
  "rm -f ~/${PREREQUISITES_SCRIPT##*/}" || {
    error "Failed to remove $PREREQUISITES_SCRIPT on remote host"
  }

### Step 9: Copy setup script to remote host
log "------------------------------"
log "[INFO] Copying $SETUP_MINA_NODE_SCRIPT to remote host..."
scp -i "$TEMP_SSH_PRIVATE_KEY" -o StrictHostKeyChecking=no -o BatchMode=yes \
  "$SETUP_MINA_NODE_SCRIPT" "${MINA_NODE_USERNAME}@${MINA_NODE_IP}:/home/${MINA_NODE_USERNAME}/" || {
    error "Failed to copy $SETUP_MINA_NODE_SCRIPT to remote host"
    exit 1
}

### Step 10: Execute setup script remotely
log "------------------------------"
log "[INFO] Executing $SETUP_MINA_NODE_SCRIPT on remote host..."
ssh -i "$TEMP_SSH_PRIVATE_KEY" -o StrictHostKeyChecking=no -o BatchMode=yes \
  "${MINA_NODE_USERNAME}@${MINA_NODE_IP}" \
  "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID} AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY} AWS_SESSION_TOKEN=${AWS_SESSION_TOKEN} bash ~/${SETUP_MINA_NODE_SCRIPT##*/}" || {
    error "$SETUP_MINA_NODE_SCRIPT failed on remote host"
    exit 1
}

log "✅ Mina node setup completed successfully on $MINA_NODE_IP!"

# Remove the main setup script from remote
log "[INFO] Removing $SETUP_MINA_NODE_SCRIPT from remote host..."
ssh -i "$TEMP_SSH_PRIVATE_KEY" -o StrictHostKeyChecking=no -o BatchMode=yes \
  "${MINA_NODE_USERNAME}@${MINA_NODE_IP}" \
  "rm -f ~/${SETUP_MINA_NODE_SCRIPT##*/}" || {
    error "Failed to remove $SETUP_MINA_NODE_SCRIPT on remote host"
  }

log "[INFO] See remote logs with: ./ssh.sh tail -f /var/log/mina-node/mina-node.log"

exit 0
