# Internet Quality Monitor

A robust, lightweight latency monitoring system designed to run on a Linux VPS. It continuously pings a target (like a home router over WireGuard), stores the results in a high-performance SQLite time-series database, and visualizes the data via a beautiful, responsive web dashboard.

This tool is specifically built to track down and prove ISP dropouts and latency spikes.

## Features

- **Continuous Pinging:** Runs as a standalone systemd daemon, accurately recording latency and timeouts down to the second.
- **Efficient Storage:** Uses SQLite with WAL mode for concurrent write/read operations. It easily handles millions of ping records per month.
- **Smart Downsampling:** The API automatically downsamples data over large time ranges (e.g., 30 days) to keep the web dashboard extremely fast and responsive.
- **Beautiful Dashboard:**
  - Dark mode with glassmorphism UI.
  - Live, real-time latency chart (auto-refreshing).
  - Historical zoomable time-series charts (1h, 6h, 24h, 7d, 30d).
  - Hourly heatmaps to easily spot recurring patterns (e.g., nightly throttling).
  - Daily summary tables and uptime statistics.
- **Basic Auth:** Protects your data on public interfaces.
- **Zero Dependencies (Frontend):** Uses vanilla HTML/CSS/JS with Chart.js included via CDN. No build pipelines or Node.js required.

## Installation (VPS)

1. **Copy the files** to your VPS.
2. **Make the install script executable and run it as root:**
   ```bash
   chmod +x setup.sh
   sudo ./setup.sh
   ```
3. **Edit the configuration file:**
   ```bash
   sudo nano /opt/internet-monitor/config.yaml
   ```
   **Important Settings to change:**
   - `target`: The IP address of the device you want to ping (e.g., your router's WireGuard IP `10.200.0.2`).
   - `auth.username` and `auth.password`: Change the default credentials before exposing the dashboard to the internet.
   - `interval`: The time in seconds between pings (Default is `1`). By setting it to 1, you can expect ~86,400 ping records per day.
4. **Restart the web service to apply auth changes:**
    ```bash
    sudo systemctl restart ping-monitor-web
    ```

## Usage

Access the dashboard by navigating to the IP of your VPS on port 8080 (unless changed in `config.yaml`):

```
http://<your-vps-ip>:8080
```

## Architecture

The system consists of two separate systemd services for reliability:

1. **`ping-monitor`**: A Python daemon that continuously sends ICMP echo requests and writes the results to `/opt/internet-monitor/data/pings.db`. It also handles automatic data retention duties.
2. **`ping-monitor-web`**: A FastAPI application that serves the static dashboard files and exposes a set of REST APIs for querying and aggregating the ping data.

## System Management

If you need to check the status or logs of the services, use `systemctl` and `journalctl`:

**Check Status:**
```bash
sudo systemctl status ping-monitor
sudo systemctl status ping-monitor-web
```

**View Logs:**
```bash
sudo journalctl -u ping-monitor -f
sudo journalctl -u ping-monitor-web -f
```

## Uninstall

If you wish to remove the monitoring suite from your server:

```bash
sudo systemctl stop ping-monitor ping-monitor-web
sudo systemctl disable ping-monitor ping-monitor-web
sudo rm /etc/systemd/system/ping-monitor*.service
sudo systemctl daemon-reload
sudo userdel monitor
sudo rm -rf /opt/internet-monitor
```
(Warning: This will also delete your recorded data in `/opt/internet-monitor/data/pings.db`).
