#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Script: mina-node-cmd
# Purpose:
#   - Assumes an IAM Role for temporary credentials
#   - Gets remote node IP/username from S3
#   - Gets SSH key from AWS Secrets Manager
#   - Executes a remote command on the node via SSH (or interactive shell)
# -----------------------------------------------------------------------------

### Configuration
AWS_REGION="eu-central-1"
ROLE_ARN="arn:aws:iam::565802942559:role/zkusd-mina-node-role-role"
ROLE_SESSION_NAME="minaNodeSession"
S3_BUCKET="zkusd-terraform-outputs"
OUTPUT_FILE="terraform-outputs.json"
SSH_PRIVATE_KEY_SECRET_NAME="zkusd/dev/mina-node/ssh/secret-key"
TEMP_SSH_PRIVATE_KEY="/tmp/mina-node-ssh-key-$$"

### Debugging & Logging
DEBUG=false

# Parse args for --debug flag
for arg in "$@"; do
  if [[ "$arg" == "--debug" ]]; then
    DEBUG=true
    # Remove --debug from arguments
    set -- "${@/--debug/}"
    break
  fi
done

log() {
  if [[ "$DEBUG" == true ]]; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*" >&2
  fi
}

error() {
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ❌ $*" >&2
}

cleanup() {
  rm -f "$TEMP_SSH_PRIVATE_KEY"
}
trap cleanup EXIT

### Start the flow
log "------------------------------"
log "[INFO] Assuming IAM role to get temporary AWS credentials..."
STS_JSON="$(aws sts assume-role \
  --role-arn "${ROLE_ARN}" \
  --role-session-name "${ROLE_SESSION_NAME}" \
  --region "${AWS_REGION}" \
  --duration-seconds 3600 \
  --output json)"

AWS_ACCESS_KEY_ID="$(echo "${STS_JSON}" | jq -r .Credentials.AccessKeyId)"
AWS_SECRET_ACCESS_KEY="$(echo "${STS_JSON}" | jq -r .Credentials.SecretAccessKey)"
AWS_SESSION_TOKEN="$(echo "${STS_JSON}" | jq -r .Credentials.SessionToken)"
EXPIRATION="$(echo "${STS_JSON}" | jq -r .Credentials.Expiration)"

export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_SESSION_TOKEN

log "[INFO] Temporary credentials acquired, expire at ${EXPIRATION}."

log "------------------------------"
log "[INFO] Fetching terraform-outputs.json from S3..."
aws s3 cp "s3://${S3_BUCKET}/${OUTPUT_FILE}" "${OUTPUT_FILE}" --region "${AWS_REGION}" --quiet || {
  error "Failed to download ${OUTPUT_FILE} from S3"
  exit 1
}

log "[INFO] Extracting remote node connection info..."
MINA_NODE_IP="$(jq -r '.mina_node_ip.value' "${OUTPUT_FILE}")"
MINA_NODE_USERNAME="$(jq -r '.mina_node_username.value' "${OUTPUT_FILE}")"

if [[ -z "${MINA_NODE_IP}" || -z "${MINA_NODE_USERNAME}" ]]; then
  error "Failed to extract mina_node_ip or mina_node_username from ${OUTPUT_FILE}."
  exit 1
fi

log "[INFO] Node IP: ${MINA_NODE_IP}"
log "[INFO] Node Username: ${MINA_NODE_USERNAME}"

log "------------------------------"
log "[INFO] Fetching SSH private key from AWS Secrets Manager..."
SSH_PRIVATE_KEY_SECRET_ARN=$(aws secretsmanager list-secrets \
                                 --region "${AWS_REGION}" \
                                 --query "SecretList[?contains(Name, '${SSH_PRIVATE_KEY_SECRET_NAME}')].ARN" \
                                 --output text | grep -v None | head -n 1)

if [[ -z "${SSH_PRIVATE_KEY_SECRET_ARN}" ]]; then
    error "Could not find SSH private key secret '${SSH_PRIVATE_KEY_SECRET_NAME}' in AWS Secrets Manager."
    exit 1
fi

aws secretsmanager get-secret-value \
  --secret-id "${SSH_PRIVATE_KEY_SECRET_ARN}" \
  --region "${AWS_REGION}" \
  --query SecretString \
  --output text > "${TEMP_SSH_PRIVATE_KEY}" || {
    error "Failed to retrieve SSH private key from Secrets Manager"
    exit 1
}

chmod 600 "${TEMP_SSH_PRIVATE_KEY}"

log "------------------------------"

# If no arguments (other than --debug), run an interactive SSH session
if [ "$#" -eq 0 ]; then
  log "[INFO] No remote command specified. Opening interactive SSH session to ${MINA_NODE_IP}..."
  ssh -i "${TEMP_SSH_PRIVATE_KEY}" \
      -o StrictHostKeyChecking=no \
      -o BatchMode=yes \
      "${MINA_NODE_USERNAME}@${MINA_NODE_IP}"
  exit $?
fi

log "[INFO] Executing remote command on ${MINA_NODE_IP}..."
ssh -i "${TEMP_SSH_PRIVATE_KEY}" \
    -o StrictHostKeyChecking=no \
    -o BatchMode=yes \
    "${MINA_NODE_USERNAME}@${MINA_NODE_IP}" "$@"

SSH_EXIT_STATUS=$?

log "------------------------------"
if [ $SSH_EXIT_STATUS -eq 0 ]; then
    log "✅ Remote command executed successfully."
else
    error "Remote command failed with status $SSH_EXIT_STATUS."
fi

exit $SSH_EXIT_STATUS
