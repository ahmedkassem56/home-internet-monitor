#!/bin/bash
# ================================================================
# Internet Monitor — Update Script
# Run as root: sudo bash update.sh
# ================================================================

set -euo pipefail

APP_DIR="/opt/internet-monitor"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================"
echo "  Internet Monitor — Updater"
echo "============================================"
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
    echo "Error: This script must be run as root (sudo bash update.sh)"
    exit 1
fi

if [[ ! -d "${APP_DIR}" ]]; then
    echo "Error: Application not found in ${APP_DIR}. Please run setup.sh first."
    exit 1
fi

echo "[1/4] Stopping services..."
systemctl stop ping-monitor.service || true
systemctl stop ping-monitor-web.service || true

echo "[2/4] Copying updated application files..."
cp -r "${SCRIPT_DIR}/monitor" "${APP_DIR}/"
cp -r "${SCRIPT_DIR}/web" "${APP_DIR}/"
cp "${SCRIPT_DIR}/requirements.txt" "${APP_DIR}/"

# Re-apply permissions
chown -R monitor:monitor "${APP_DIR}/monitor"
chown -R monitor:monitor "${APP_DIR}/web"

echo "[3/4] Updating Python dependencies (if any)..."
# We run pip install again just in case requirements.txt was updated by the new code
sudo -u monitor "${APP_DIR}/venv/bin/pip" install --quiet -r "${APP_DIR}/requirements.txt"

echo "[4/4] Starting services..."
# If systemd service units changed, we reload systemd
cp "${SCRIPT_DIR}/ping-monitor.service" /etc/systemd/system/
cp "${SCRIPT_DIR}/ping-monitor-web.service" /etc/systemd/system/
systemctl daemon-reload

systemctl start ping-monitor.service
systemctl start ping-monitor-web.service

echo ""
echo "============================================"
echo "  ✅ Update Complete!"
echo "============================================"
echo "  Services restarted successfully."
