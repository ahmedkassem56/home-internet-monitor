#!/bin/bash
# ================================================================
# Internet Monitor — Install Script
# Run as root: sudo bash setup.sh
# ================================================================

set -euo pipefail

APP_DIR="/opt/internet-monitor"
DATA_DIR="${APP_DIR}/data"
SERVICE_USER="monitor"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================"
echo "  Internet Monitor — Installer"
echo "============================================"
echo ""

# ─── Check root ─────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    echo "Error: This script must be run as root (sudo bash setup.sh)"
    exit 1
fi

# ─── Create service user ────────────────────────────────────────
if ! id -u "${SERVICE_USER}" &>/dev/null; then
    echo "[1/7] Creating service user '${SERVICE_USER}'..."
    useradd --system --no-create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
else
    echo "[1/7] Service user '${SERVICE_USER}' already exists."
fi

# ─── Create directories ─────────────────────────────────────────
echo "[2/7] Creating application directory..."
mkdir -p "${APP_DIR}"
mkdir -p "${DATA_DIR}"

# ─── Copy files ──────────────────────────────────────────────────
echo "[3/7] Copying application files..."
cp -r "${SCRIPT_DIR}/monitor" "${APP_DIR}/"
cp -r "${SCRIPT_DIR}/web" "${APP_DIR}/"
cp "${SCRIPT_DIR}/requirements.txt" "${APP_DIR}/"

# Copy config only if it doesn't already exist (preserve user changes)
if [[ ! -f "${APP_DIR}/config.yaml" ]]; then
    cp "${SCRIPT_DIR}/config.yaml" "${APP_DIR}/"
    echo "     → Default config.yaml installed. EDIT IT before starting!"
else
    echo "     → Existing config.yaml preserved."
fi

# ─── Set up Python virtualenv ────────────────────────────────────
echo "[4/7] Setting up Python virtual environment..."
python3 -m venv "${APP_DIR}/venv"
"${APP_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${APP_DIR}/venv/bin/pip" install --quiet -r "${APP_DIR}/requirements.txt"

# ─── Set permissions ─────────────────────────────────────────────
echo "[5/7] Setting permissions..."
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"
# Ensure the ping command can be used by the service user
# On most Linux systems, ping is already setuid or has cap_net_raw

# ─── Install systemd services ───────────────────────────────────
echo "[6/7] Installing systemd services..."
cp "${SCRIPT_DIR}/ping-monitor.service" /etc/systemd/system/
cp "${SCRIPT_DIR}/ping-monitor-web.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable ping-monitor.service
systemctl enable ping-monitor-web.service

# ─── Start services ─────────────────────────────────────────────
echo "[7/7] Starting services..."
systemctl start ping-monitor.service
systemctl start ping-monitor-web.service

# ─── Done ────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  ✅ Installation Complete!"
echo "============================================"
echo ""
echo "  Dashboard:  http://$(hostname -I | awk '{print $1}'):8080"
echo "  Username:   admin"
echo "  Password:   changeme  (CHANGE THIS!)"
echo ""
echo "  Config:     ${APP_DIR}/config.yaml"
echo "  Database:   ${DATA_DIR}/pings.db"
echo ""
echo "  Commands:"
echo "    sudo systemctl status ping-monitor"
echo "    sudo systemctl status ping-monitor-web"
echo "    sudo journalctl -u ping-monitor -f"
echo "    sudo journalctl -u ping-monitor-web -f"
echo ""
echo "  ⚠️  IMPORTANT: Edit ${APP_DIR}/config.yaml"
echo "     and change the auth password!"
echo ""
echo "     Then restart: sudo systemctl restart ping-monitor-web"
echo ""
