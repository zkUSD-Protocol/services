#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Script: assume_role_and_upload.sh
#
# Purpose:
#   1) Download terraform-outputs.json from S3
#   2) Extract mina_node_ip and mina_node_username from JSON
#   3) Assume an existing IAM role to get temporary credentials
#   4) Dynamically find SSH key secrets by name from AWS Secrets Manager
#   5) Retrieve SSH private key
#   6) Copy creds + setup script to remote Hetzner machine via SSH
#   7) Verify SSH connectivity
# -----------------------------------------------------------------------------

### 1) CONFIGURATION
ROLE_ARN="arn:aws:iam::565802942559:role/zkusd-mina-node-role-role"
ROLE_SESSION_NAME="minaNodeSession"
S3_BUCKET="zkusd-terraform-outputs"
OUTPUT_FILE="terraform-outputs.json"
LOCAL_CREDS_FILE="/tmp/assumed_role_creds"
NEXT_SCRIPT_PATH="./part2.sh"

AWS_REGION="eu-central-1"

# Secret names (do not include ARNs!)
SSH_PRIVATE_KEY_SECRET_NAME="zkusd/dev/mina-node/ssh/secret-key"
SSH_PUBLIC_KEY_SECRET_NAME="zkusd/dev/mina-node/ssh/public-key"

# Where to store the fetched SSH private key locally
TEMP_SSH_PRIVATE_KEY="/tmp/mina-node-ssh-key"

echo "------------------------------"
echo "[INFO] Downloading terraform-outputs.json from S3..."
aws s3 cp "s3://${S3_BUCKET}/${OUTPUT_FILE}" "${OUTPUT_FILE}" --region "${AWS_REGION}"

echo "[INFO] Parsing terraform-outputs.json for connection details..."
MINA_NODE_IP="$(jq -r '.mina_node_ip.value' "${OUTPUT_FILE}")"
MINA_NODE_USERNAME="$(jq -r '.mina_node_username.value' "${OUTPUT_FILE}")"

if [[ -z "${MINA_NODE_IP}" || -z "${MINA_NODE_USERNAME}" ]]; then
  echo "[ERROR] Failed to extract mina_node_ip or mina_node_username from ${OUTPUT_FILE}."
  exit 1
fi

echo "[INFO] Extracted:"
echo "  - mina_node_ip: ${MINA_NODE_IP}"
echo "  - mina_node_username: ${MINA_NODE_USERNAME}"


### 2) FIND SSH SECRET ARNs BY NAME
echo "------------------------------"
echo "[INFO] Searching AWS Secrets Manager for SSH secret ARNs..."

SSH_PRIVATE_KEY_SECRET_ARN=$(aws secretsmanager list-secrets \
                                 --region "${AWS_REGION}" \
                                 --query "SecretList[?contains(Name, '${SSH_PRIVATE_KEY_SECRET_NAME}')].ARN" \
                                 --output text | grep -v None | head -n 1)

SSH_PUBLIC_KEY_SECRET_ARN=$(aws secretsmanager list-secrets \
                                --region "${AWS_REGION}" \
                                --query "SecretList[?contains(Name, '${SSH_PUBLIC_KEY_SECRET_NAME}')].ARN" \
                                --output text | grep -v None | head -n 1)

if [[ -z "${SSH_PRIVATE_KEY_SECRET_ARN}" ]]; then
    echo "[ERROR] Could not find SSH private key secret '${SSH_PRIVATE_KEY_SECRET_NAME}' in AWS Secrets Manager."
    exit 1
fi

### 3) RETRIEVE SSH PRIVATE KEY FROM SECRETS MANAGER
echo "------------------------------"
echo "[INFO] Fetching SSH private key from AWS Secrets Manager..."
aws secretsmanager get-secret-value \
  --secret-id "${SSH_PRIVATE_KEY_SECRET_ARN}" \
  --region "${AWS_REGION}" \
  --query SecretString \
  --output text > "${TEMP_SSH_PRIVATE_KEY}"

chmod 600 "${TEMP_SSH_PRIVATE_KEY}"

### 4) ASSUME THE ROLE LOCALLY
echo "------------------------------"
echo "[INFO] Assuming IAM role to get temporary STS credentials..."
STS_JSON="$(aws sts assume-role \
  --role-arn "${ROLE_ARN}" \
  --role-session-name "${ROLE_SESSION_NAME}" \
  --region "${AWS_REGION}" \
  --duration-seconds 3600 \
  --output json)"

# echo "[INFO] Parsing temporary credentials..."
ACCESS_KEY_ID="$(echo "${STS_JSON}" | jq -r .Credentials.AccessKeyId)"
SECRET_ACCESS_KEY="$(echo "${STS_JSON}" | jq -r .Credentials.SecretAccessKey)"
SESSION_TOKEN="$(echo "${STS_JSON}" | jq -r .Credentials.SessionToken)"
EXPIRATION="$(echo "${STS_JSON}" | jq -r .Credentials.Expiration)"

echo "[INFO] Temporary AWS STS credentials expire at: ${EXPIRATION}, but are only available for executing part2 and part3."

### 5) COPY PART2 SCRIPT TO REMOTE MACHINE
if [ ! -f "${NEXT_SCRIPT_PATH}" ]; then
  echo "[ERROR] Next script '${NEXT_SCRIPT_PATH}' is missing. Please ensure it exists."
  exit 1
fi

echo "------------------------------"
echo "[INFO] Copying part2 script to the remote Hetzner machine..."

scp -i "${TEMP_SSH_PRIVATE_KEY}" -o StrictHostKeyChecking=no \
  "${NEXT_SCRIPT_PATH}" \
  "${MINA_NODE_USERNAME}@${MINA_NODE_IP}:/home/${MINA_NODE_USERNAME}/"

### 6) VERIFY SSH CONNECTIVITY
echo "------------------------------"
ssh -i "${TEMP_SSH_PRIVATE_KEY}" -o StrictHostKeyChecking=no \
  "${MINA_NODE_USERNAME}@${MINA_NODE_IP}" "echo '✅ SSH connection successful! Remote machine architecture: $(uname -m)'"

echo "------------------------------"
echo "✅ Part 1 completed successfully!"
echo "Proceed to run Part 2 on the remote server."

echo "------------------------------"
# Run part2.sh remotely over SSH
echo "[INFO] Executing 'part2.sh' on the remote host."

ssh -i "${TEMP_SSH_PRIVATE_KEY}" -o StrictHostKeyChecking=no \
    "${MINA_NODE_USERNAME}@${MINA_NODE_IP}" \
    "AWS_ACCESS_KEY_ID=${ACCESS_KEY_ID} AWS_SECRET_ACCESS_KEY=${SECRET_ACCESS_KEY} AWS_SESSION_TOKEN=${SESSION_TOKEN} bash ~/part2.sh"

# Capture the exit status of part2.sh remotely
SSH_EXIT_STATUS=$?

if [ $SSH_EXIT_STATUS -ne 0 ]; then
    echo "❌ Part 2 failed on remote host ${MINA_NODE_IP}!"
    exit $SSH_EXIT_STATUS
else
    echo "✅ Part 2 executed successfully on ${MINA_NODE_IP}."
    echo "You can now proceed to Part 3."
fi
echo "------------------------------"
echo "[INFO] Copying 'part3.sh' to remote host ${MINA_NODE_USERNAME}@${MINA_NODE_IP}..."

scp -i "${TEMP_SSH_PRIVATE_KEY}" -o StrictHostKeyChecking=no \
    part3.sh "${MINA_NODE_USERNAME}@${MINA_NODE_IP}:/home/${MINA_NODE_USERNAME}/"

COPY_EXIT_STATUS=$?

if [ $COPY_EXIT_STATUS -ne 0 ]; then
    echo "❌ Failed to copy 'part3.sh' to remote host ${MINA_NODE_IP}!"
    exit $COPY_EXIT_STATUS
fi

echo "[INFO] Successfully copied 'part3.sh'. Executing it remotely..."

# Run part3.sh remotely over SSH
ssh -i "${TEMP_SSH_PRIVATE_KEY}" -o StrictHostKeyChecking=no \
    "${MINA_NODE_USERNAME}@${MINA_NODE_IP}" \
    "AWS_ACCESS_KEY_ID=${ACCESS_KEY_ID} AWS_SECRET_ACCESS_KEY=${SECRET_ACCESS_KEY} AWS_SESSION_TOKEN=${SESSION_TOKEN} bash ~/part3.sh"


# Capture the exit status of part3.sh remotely
SSH_EXIT_STATUS=$?

if [ $SSH_EXIT_STATUS -ne 0 ]; then
    echo "❌ Part 3 failed on remote host ${MINA_NODE_IP}!"
    echo "Check logs on the remote host and re-run part3.sh manually if needed."
    exit $SSH_EXIT_STATUS
else
    echo "✅ Part 3 executed successfully on ${MINA_NODE_IP}."
    echo "Mina block producer node setup complete and running!"
fi
