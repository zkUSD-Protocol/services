#!/usr/bin/env bash
set -euo pipefail

################################################################################
# Part 2: Remote Setup Script (Runs on the ARM Machine)
#
# Purpose:
#   - Install AWS CLI (ARM version) if not installed
#   - Install Docker (and Docker Compose plugin) if not installed
#   - Place STS credentials in ~/.aws/credentials
#   - Verify AWS and Docker
#   - Ensure system is ready for Mina Node setup (done in Part 3).
#
# Usage:
#   This script is typically triggered via SSH from Part 1:
#     ssh -i <ssh_key> devops@<mina_node_ip> "bash part2.sh"
################################################################################

# We assume 'devops' user on Ubuntu 22.04 ARM
# Adjust as needed if you have a different user or OS

AWS_REGION="eu-central-1"
CREDENTIALS_SOURCE_FILE="assumed_role_creds"

echo "------------------------------"
echo "[INFO] Part 2: Starting remote setup..."

################################################################################
# 1) Ensure Basic Packages (curl, unzip, jq, etc.)
################################################################################
echo "[INFO] Checking base packages..."

sudo apt-get update -y
sudo apt-get install -y \
  curl \
  unzip \
  jq \
  gnupg \
  lsb-release \
  ca-certificates

echo "[INFO] Base packages installed/updated."

################################################################################
# 2) Install AWS CLI if not present
################################################################################
echo "------------------------------"
if ! command -v aws &> /dev/null; then
  echo "[INFO] AWS CLI not found. Installing..."

  ARCH=$(uname -m)
  if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
    AWSCLI_URL="https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip"
  else
    # fallback or x86_64
    AWSCLI_URL="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"
  fi

  rm -f awscliv2.zip
  curl -fsSL "$AWSCLI_URL" -o awscliv2.zip
  unzip -o awscliv2.zip
  sudo ./aws/install

  # Ensure aws is on PATH now:
  if ! command -v aws &> /dev/null; then
    echo "[ERROR] AWS CLI installation failed!"
    exit 1
  fi
  echo "[INFO] AWS CLI installed successfully."
else
  echo "[INFO] AWS CLI is already installed ($(aws --version)). Skipping."
fi

################################################################################
# 3) Place Temporary STS Credentials
################################################################################
echo "------------------------------"
if [ -f "$CREDENTIALS_SOURCE_FILE" ]; then
  echo "[INFO] Found '$CREDENTIALS_SOURCE_FILE' from Part 1. Moving to ~/.aws/credentials..."
  mkdir -p ~/.aws
  mv "$CREDENTIALS_SOURCE_FILE" ~/.aws/credentials
  chmod 600 ~/.aws/credentials
  echo "[INFO] Credentials moved to ~/.aws/credentials (default profile)."
else
  echo "[WARN] '$CREDENTIALS_SOURCE_FILE' not found in current directory."
  echo "       If you need AWS access, ensure credentials are present."
fi

echo "[INFO] Verifying AWS access..."
if aws sts get-caller-identity --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "[INFO] AWS CLI is functioning with STS credentials."
else
  echo "[WARN] STS credentials may be missing or expired. 'aws sts get-caller-identity' failed."
fi

################################################################################
# 4) Install Docker (CE) if not present
################################################################################
echo "------------------------------"
if ! command -v docker &> /dev/null; then
  echo "[INFO] Docker not found. Installing Docker CE..."

  # Add Docker’s official GPG key
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  # Set up the Docker repository
  ARCH=$(dpkg --print-architecture)
  echo \
    "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
                          docker-buildx-plugin docker-compose-plugin

  echo "[INFO] Enabling & starting Docker service..."
  sudo systemctl enable docker
  sudo systemctl start docker

  # Add current user to docker group for convenience (optional)
  if ! groups $USER | grep -q docker; then
    sudo usermod -aG docker $USER
    echo "[INFO] Added user '$USER' to group 'docker'. You might need to re-login."
  fi

  echo "[INFO] Docker installed."
else
  echo "[INFO] Docker is already installed ($(docker --version)). Skipping."
fi

echo "[INFO] Checking Docker service status..."
if ! systemctl is-active --quiet docker; then
  echo "[ERROR] Docker service is not active. Attempting to start..."
  sudo systemctl start docker
  if ! systemctl is-active --quiet docker; then
    echo "[ERROR] Unable to start Docker service."
    exit 1
  fi
fi
echo "[INFO] Docker is running."

################################################################################
# 5) Ensure Docker Compose
################################################################################
echo "------------------------------"
if docker compose version >/dev/null 2>&1; then
  echo "[INFO] Docker Compose plugin already installed ($(docker compose version))."
else
  echo "[INFO] Docker Compose plugin not found. Attempting to install again..."
  sudo apt-get install -y docker-compose-plugin
  if ! docker compose version >/dev/null 2>&1; then
    echo "[ERROR] Docker Compose plugin installation failed!"
    exit 1
  fi
  echo "[INFO] Docker Compose plugin installed successfully."
fi

################################################################################
# 6) Final Checks
################################################################################
echo "[INFO] Verifying Docker info..."
docker info || echo "[WARN] Non-zero exit from 'docker info', but continuing..."

echo "------------------------------"
echo "✅ Part 2 completed successfully!"
echo "[INFO] System is ready for Mina Node setup in Part 3."

