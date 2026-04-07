/**
 * Internet Monitor — Dashboard Application
 *
 * Handles data fetching, chart rendering, and live updates.
 */

// ─── Configuration ────────────────────────────────────────────────────
const REFRESH_INTERVAL = 5000;      // Live data refresh (ms)
const STATS_REFRESH = 15000;        // Stats refresh (ms)
const HEATMAP_REFRESH = 60000;      // Heatmap refresh (ms)

// ─── Chart.js Global Config ───────────────────────────────────────────
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.04)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.animation.duration = 400;
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;

// ─── Theme Management ───────────────────────────────────────────────────

const themeToggle = document.getElementById('theme-toggle');
const iconSun = document.getElementById('icon-sun');
const iconMoon = document.getElementById('icon-moon');

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    if (theme === 'light') {
        iconSun.classList.add('hidden');
        iconMoon.classList.remove('hidden');
    } else {
        iconSun.classList.remove('hidden');
        iconMoon.classList.add('hidden');
    }
    
    // Force charts to re-render to ingest new CSS variable values
    setTimeout(() => {
        updateChartColors();
    }, 15);
    updateHeatmap(); // Rebuild manually colored heatmap DOM blocks
}

function getThemeColor(colorName) {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    switch(colorName) {
        case 'textPrimary': return isLight ? '#0f172a' : '#f1f5f9';
        case 'tooltipBg': return isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(17, 24, 39, 0.95)';
        case 'borderColor': return isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.06)';
        case 'chartGrid': return isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.03)';
        case 'textSecondary': return isLight ? '#475569' : '#94a3b8';
    }
    return '';
}

function updateChartColors() {
    const tooltipBg = getThemeColor('tooltipBg');
    const textPrimary = getThemeColor('textPrimary');
    const borderColor = getThemeColor('borderColor');
    const chartGrid = getThemeColor('chartGrid');
    const textSecondary = getThemeColor('textSecondary');

    Chart.defaults.color = textSecondary;
    Chart.defaults.borderColor = borderColor;

    const charts = [liveChart, historicalChart, timeoutsChart].filter(Boolean);
    charts.forEach(chart => {
        if (chart.options.plugins && chart.options.plugins.tooltip) {
            chart.options.plugins.tooltip.backgroundColor = tooltipBg;
            chart.options.plugins.tooltip.titleColor = textPrimary;
            chart.options.plugins.tooltip.bodyColor = textPrimary;
            chart.options.plugins.tooltip.borderColor = borderColor;
        }

        const updateAxis = (axisName) => {
            if (chart.options.scales && chart.options.scales[axisName]) {
                if (chart.options.scales[axisName].grid) chart.options.scales[axisName].grid.color = chartGrid;
                if (!chart.options.scales[axisName].ticks) chart.options.scales[axisName].ticks = {};
                chart.options.scales[axisName].ticks.color = textSecondary;
            }
        };
        updateAxis('x');
        updateAxis('y');

        chart.update('none');
    });
}

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
}

// ─── State ────────────────────────────────────────────────────────────
let liveChart = null;
let historicalChart = null;
let timeoutsChart = null;
let currentRange = '6h';
let heatmapDays = 7;
let incidentsDays = 7;
let monitorMode = 'icmp';
let pingInterval = 1;
let pingTimeout = 5;

// ─── API Helpers ──────────────────────────────────────────────────────

async function api(endpoint) {
    const response = await fetch(endpoint);
    if (response.status === 401) {
        // Force re-auth
        window.location.reload();
        return null;
    }
    if (!response.ok) {
        console.error(`API error: ${response.status} ${response.statusText}`);
        return null;
    }
    return response.json();
}

function formatLatency(val) {
    if (val == null) return '—';
    return val < 10 ? val.toFixed(2) : val < 100 ? val.toFixed(1) : Math.round(val);
}

function formatNumber(val) {
    if (val == null) return '—';
    if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
    if (val >= 1_000) return (val / 1_000).toFixed(1) + 'K';
    return val.toLocaleString();
}

function formatDuration(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTime(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleTimeString();
}

function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString();
}

function formatDateTime(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString();
}

// ─── Status ───────────────────────────────────────────────────────────

async function updateStatus() {
    const data = await api('/api/status');
    if (!data) return;

    const banner = document.getElementById('status-banner');
    const label = document.getElementById('status-label');
    const latency = document.getElementById('status-latency');
    const iconUp = document.getElementById('status-icon-up');
    const iconDown = document.getElementById('status-icon-down');
    const iconUnknown = document.getElementById('status-icon-unknown');

    banner.classList.remove('status-up', 'status-down', 'status-unknown');
    iconUp.classList.add('hidden');
    iconDown.classList.add('hidden');
    iconUnknown.classList.add('hidden');

    if (data.is_up === true) {
        banner.classList.add('status-up');
        iconUp.classList.remove('hidden');
        label.textContent = 'Connection Active';
        latency.textContent = `Current latency: ${formatLatency(data.last_latency)} ms`;
    } else if (data.is_up === false) {
        banner.classList.add('status-down');
        iconDown.classList.remove('hidden');
        label.textContent = 'Connection Down';
        latency.textContent = `Last timeout at ${formatTime(data.last_timestamp)}`;
    } else {
        banner.classList.add('status-unknown');
        iconUnknown.classList.remove('hidden');
        label.textContent = 'No Data';
        latency.textContent = 'Waiting for ping data...';
    }

    document.getElementById('last-update').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

// ─── Summary ────────────────────────────────────────────────────────────

async function updateSummary() {
    const rangeSelect = document.getElementById('summary-range-select');
    if (!rangeSelect) return;
    const range = rangeSelect.value;
    const summaryText = document.getElementById('summary-text');
    
    summaryText.style.opacity = '0.5';
    const data = await api(`/api/summary?range=${range}`);
    summaryText.style.opacity = '1';
    
    if (data && data.summary) {
        summaryText.textContent = data.summary;
    } else {
        summaryText.textContent = 'Failed to load summary.';
    }
}

// ─── Stats ────────────────────────────────────────────────────────────

async function updateStats() {
    const data = await api(`/api/stats?range=24h`);
    if (!data) return;

    animateValue('val-avg', formatLatency(data.avg_latency));
    animateValue('val-p95', formatLatency(data.p95_latency));
    animateValue('val-p99', formatLatency(data.p99_latency));
    animateValue('val-uptime', data.uptime_pct != null ? data.uptime_pct.toFixed(2) : '—');
    animateValue('val-timeouts', formatNumber(data.total_timeouts));
    animateValue('val-total', formatNumber(data.total_pings));

    // Color the uptime card
    const uptimeCard = document.getElementById('metric-uptime');
    const val = data.uptime_pct;
    uptimeCard.classList.remove('uptime-great', 'uptime-ok', 'uptime-bad');
    if (val != null) {
        const valEl = document.getElementById('val-uptime');
        if (val >= 99.5) valEl.style.background = 'linear-gradient(135deg, #10b981, #06b6d4)';
        else if (val >= 95) valEl.style.background = 'linear-gradient(135deg, #f59e0b, #ef4444)';
        else valEl.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        valEl.style.webkitBackgroundClip = 'text';
        valEl.style.webkitTextFillColor = 'transparent';
        valEl.style.backgroundClip = 'text';
    }
}

function animateValue(elementId, newValue) {
    const el = document.getElementById(elementId);
    if (el.textContent !== String(newValue)) {
        el.style.transform = 'scale(1.1)';
        el.textContent = newValue;
        setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
    }
}

// ─── Live Chart ───────────────────────────────────────────────────────

async function updateLiveChart() {
    const data = await api('/api/pings?range=5m&bucket=0');
    // 5m might not be supported; fall back to custom timestamps
    let pings;
    if (data && data.data) {
        pings = data.data;
    } else {
        // Fallback: use custom start/end
        const now = Math.floor(Date.now() / 1000);
        const d = await api(`/api/pings?start=${now - 300}&end=${now}&bucket=0`);
        if (!d) return;
        pings = d.data;
    }

    const labels = pings.map(p => new Date(p.timestamp * 1000));
    const latencies = pings.map(p => p.is_timeout ? null : p.latency_ms);
    const timeouts = pings.map(p => p.is_timeout ? 1 : null);

    if (!liveChart) {
        const ctx = document.getElementById('chart-live').getContext('2d');
        liveChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Latency (ms)',
                        data: latencies,
                        borderColor: '#06b6d4',
                        backgroundColor: 'rgba(6, 182, 212, 0.08)',
                        borderWidth: 1.5,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHitRadius: 8,
                        spanGaps: false,
                    },
                    {
                        label: 'Timeout',
                        data: timeouts.map((t, i) => t ? { x: labels[i], y: 0 } : null).filter(Boolean),
                        type: 'scatter',
                        backgroundColor: '#ef4444',
                        pointRadius: 4,
                        pointStyle: 'crossRot',
                    }
                ]
            },
            options: {
                scales: {
                    x: {
                        type: 'time',
                        time: { displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm' } },
                        grid: { display: false },
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'ms', font: { size: 10 } },
                        grid: { color: getThemeColor('chartGrid') },
                    }
                },
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    tooltip: {
                        backgroundColor: getThemeColor('tooltipBg'),
                        titleColor: getThemeColor('textPrimary'),
                        bodyColor: getThemeColor('textPrimary'),
                        borderColor: getThemeColor('borderColor'),
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 10,
                        callbacks: {
                            label: (ctx) => {
                                if (ctx.dataset.label === 'Timeout') return '⛔ Timeout';
                                return ctx.parsed.y != null ? `${ctx.parsed.y.toFixed(2)} ms` : 'Timeout';
                            }
                        }
                    }
                }
            }
        });
    } else {
        liveChart.data.labels = labels;
        liveChart.data.datasets[0].data = latencies;
        liveChart.data.datasets[1].data = timeouts.map((t, i) => t ? { x: labels[i], y: 0 } : null).filter(Boolean);
        liveChart.update('none');
    }
}

// ─── Historical Chart ─────────────────────────────────────────────────

async function updateHistoricalChart() {
    const data = await api(`/api/pings?range=${currentRange}`);
    if (!data || !data.data) return;

    const pings = data.data;
    const isBucketed = data.bucket_seconds > 0;

    let labels, avgData, minData, maxData;

    if (isBucketed) {
        labels = pings.map(p => new Date(p.bucket_ts * 1000));
        avgData = pings.map(p => p.avg_latency);
        minData = pings.map(p => p.min_latency);
        maxData = pings.map(p => p.max_latency);
    } else {
        labels = pings.map(p => new Date(p.timestamp * 1000));
        avgData = pings.map(p => p.is_timeout ? null : p.latency_ms);
        minData = null;
        maxData = null;
    }

    const datasets = [
        {
            label: isBucketed ? 'Avg Latency' : 'Latency',
            data: avgData,
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6, 182, 212, 0.06)',
            borderWidth: 1.5,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            spanGaps: false,
        }
    ];

    if (isBucketed && maxData) {
        // Add max as a light area band
        datasets.unshift({
            label: 'Max Latency',
            data: maxData,
            borderColor: 'rgba(139, 92, 246, 0.3)',
            backgroundColor: 'rgba(139, 92, 246, 0.04)',
            borderWidth: 1,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
        });
    }

    // Add timeout indicators — plot at max latency of the bucket (or avg if no max)
    // so they sit visibly on top of the chart, not hidden at y=0
    if (isBucketed) {
        const timeoutData = pings
            .filter(p => p.timeout_count > 0)
            .map(p => ({
                x: new Date(p.bucket_ts * 1000),
                y: p.max_latency || p.avg_latency || 1,
                _timeoutCount: p.timeout_count,
            }));
        if (timeoutData.length > 0) {
            datasets.push({
                label: 'Timeouts',
                data: timeoutData,
                type: 'scatter',
                backgroundColor: 'rgba(239, 68, 68, 0.85)',
                borderColor: '#ef4444',
                borderWidth: 1.5,
                pointRadius: 6,
                pointHoverRadius: 9,
                pointStyle: 'triangle',
            });
        }
    }

    if (!historicalChart) {
        const ctx = document.getElementById('chart-historical').getContext('2d');
        historicalChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            displayFormats: {
                                minute: 'HH:mm',
                                hour: 'HH:mm',
                                day: 'MMM dd',
                            }
                        },
                        grid: { display: false },
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'ms', font: { size: 10 } },
                        grid: { color: getThemeColor('chartGrid') },
                    }
                },
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    zoom: {
                        zoom: {
                            wheel: { enabled: true, speed: 0.05 },
                            pinch: { enabled: true },
                            mode: 'x',
                        },
                        pan: {
                            enabled: true,
                            mode: 'x',
                        }
                    },
                    tooltip: {
                        backgroundColor: getThemeColor('tooltipBg'),
                        titleColor: getThemeColor('textPrimary'),
                        bodyColor: getThemeColor('textPrimary'),
                        borderColor: getThemeColor('borderColor'),
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 10,
                    },
                    legend: {
                        display: true,
                        labels: {
                            boxWidth: 12,
                            padding: 16,
                            usePointStyle: true,
                        }
                    }
                }
            }
        });
    } else {
        historicalChart.data.labels = labels;
        // Prevent Chart.js from completely destructing and rebuilding its internal meta array 
        // by modifying existing elements in-place to avoid huge UI stutters
        if (historicalChart.data.datasets.length === datasets.length) {
            for (let i = 0; i < datasets.length; i++) {
                historicalChart.data.datasets[i].data = datasets[i].data;
                historicalChart.data.datasets[i].label = datasets[i].label;
            }
        } else {
            historicalChart.data.datasets = datasets;
        }
        historicalChart.update('none'); // Snaps UI instantly, disabling extreme bezier-tension mathematical calculation loads
    }
}

// ─── Timeout Events Chart ─────────────────────────────────────────────

async function updateTimeoutsChart() {
    // Show timeout count per bucket over the selected range
    const data = await api(`/api/pings?range=${currentRange}`);
    if (!data || !data.data) return;

    const pings = data.data;
    const isBucketed = data.bucket_seconds > 0;

    let labels, timeoutCounts;

    if (isBucketed) {
        labels = pings.map(p => new Date(p.bucket_ts * 1000));
        timeoutCounts = pings.map(p => p.timeout_count || 0);
    } else {
        // For raw data, bucket manually into 1-minute bins
        const bins = {};
        pings.forEach(p => {
            const bucket = Math.floor(p.timestamp / 60) * 60;
            if (!bins[bucket]) bins[bucket] = { count: 0, timeouts: 0 };
            bins[bucket].count++;
            if (p.is_timeout) bins[bucket].timeouts++;
        });
        const sortedBuckets = Object.keys(bins).sort((a, b) => a - b);
        labels = sortedBuckets.map(ts => new Date(ts * 1000));
        timeoutCounts = sortedBuckets.map(ts => bins[ts].timeouts);
    }

    // Calculate loss percentage per bucket weighted by true elapsed time
    let lossPct;
    if (isBucketed) {
        lossPct = pings.map(p => {
            if (p.total_count <= 0) return 0;
            const success = p.total_count - p.timeout_count;
            const upSecs = success * pingInterval;
            const downSecs = p.timeout_count * pingTimeout;
            const totSecs = upSecs + downSecs;
            return totSecs > 0 ? (downSecs / totSecs) * 100 : 0;
        });
    } else {
        lossPct = timeoutCounts; // For raw, just show count
    }

    if (!timeoutsChart) {
        const ctx = document.getElementById('chart-timeouts').getContext('2d');
        timeoutsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Timeouts',
                    data: timeoutCounts,
                    lossPctArray: lossPct,
                    isBucketedData: isBucketed,
                    backgroundColor: timeoutCounts.map(c =>
                        c > 0 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(16, 185, 129, 0.15)'
                    ),
                    borderColor: timeoutCounts.map(c =>
                        c > 0 ? '#ef4444' : 'rgba(16, 185, 129, 0.3)'
                    ),
                    borderWidth: 1,
                    borderRadius: 3,
                }]
            },
            options: {
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            displayFormats: {
                                minute: 'HH:mm',
                                hour: 'HH:mm',
                                day: 'MMM dd',
                            }
                        },
                        grid: { display: false },
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Timeouts',
                            font: { size: 10 }
                        },
                        grid: { color: getThemeColor('chartGrid') },
                        ticks: {
                            stepSize: 1,
                            precision: 0,
                        }
                    }
                },
                plugins: {
                    zoom: {
                        zoom: {
                            wheel: { enabled: true, speed: 0.05 },
                            pinch: { enabled: true },
                            mode: 'x',
                        },
                        pan: {
                            enabled: true,
                            mode: 'x',
                        }
                    },
                    tooltip: {
                        backgroundColor: getThemeColor('tooltipBg'),
                        titleColor: getThemeColor('textPrimary'),
                        bodyColor: getThemeColor('textPrimary'),
                        borderColor: getThemeColor('borderColor'),
                        borderWidth: 1,
                        cornerRadius: 8,
                        callbacks: {
                            label: (ctx) => {
                                const ds = ctx.dataset;
                                const tc = ctx.parsed.y;
                                if (ds.isBucketedData && ds.lossPctArray) {
                                    const pct = ds.lossPctArray[ctx.dataIndex];
                                    return `${tc} timeout${tc !== 1 ? 's' : ''} (${pct.toFixed(1)}% loss)`;
                                }
                                return `${tc} timeout${tc !== 1 ? 's' : ''}`;
                            }
                        }
                    }
                }
            }
        });
    } else {
        timeoutsChart.data.labels = labels;
        timeoutsChart.data.datasets[0].data = timeoutCounts;
        timeoutsChart.data.datasets[0].lossPctArray = lossPct;
        timeoutsChart.data.datasets[0].isBucketedData = isBucketed;
        timeoutsChart.data.datasets[0].backgroundColor = timeoutCounts.map(c =>
            c > 0 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(16, 185, 129, 0.15)'
        );
        timeoutsChart.data.datasets[0].borderColor = timeoutCounts.map(c =>
            c > 0 ? '#ef4444' : 'rgba(16, 185, 129, 0.3)'
        );
        timeoutsChart.update('none');
    }
}

// ─── Heatmap ──────────────────────────────────────────────────────────

function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getLatencyColor(avgLatency) {
    if (avgLatency == null) return getCssVar('--heatmap-empty');      // No data
    
    let excellent = monitorMode === 'http' ? 140 : 65;
    let great = monitorMode === 'http' ? 160 : 85;
    let good = monitorMode === 'http' ? 200 : 110;
    let moderate = monitorMode === 'http' ? 250 : 150;
    let high = monitorMode === 'http' ? 350 : 200;
    let veryHigh = monitorMode === 'http' ? 500 : 300;

    if (avgLatency <= excellent) return '#059669'; // Excellent
    if (avgLatency <= great) return '#10b981';     // Great
    if (avgLatency <= good) return '#34d399';      // Good
    if (avgLatency <= moderate) return '#fbbf24';  // Moderate
    if (avgLatency <= high) return '#f59e0b';      // High
    if (avgLatency <= veryHigh) return '#ef4444';  // Very high
    return '#dc2626';                              // Extreme
}

function getLossColor(timeoutPct, hasData) {
    if (!hasData) return getCssVar('--heatmap-empty');                // No data
    if (timeoutPct <= 2) return '#059669';        // Excellent
    if (timeoutPct > 2 && timeoutPct <= 5) return '#fbbf24';          // Warning
    if (timeoutPct > 5 && timeoutPct <= 20) return '#f59e0b';          // High
    if (timeoutPct > 20 && timeoutPct <= 50) return '#ef4444';         // Bad
    return '#dc2626';                              // Extreme
}

async function updateHeatmap() {
    const tzOffset = -new Date().getTimezoneOffset();
    const data = await api(`/api/hourly?days=${heatmapDays}&tz=${tzOffset}`);

    if (!data || !data.data || data.data.length === 0) {
        const loadingMsg = '<div class="heatmap-loading">No heatmap data available yet. Waiting for data to accumulate...</div>';
        document.getElementById('latency-heatmap-container').innerHTML = loadingMsg;
        document.getElementById('loss-heatmap-container').innerHTML = loadingMsg;
        return;
    }

    const hourlyData = data.data;

    // Group by date
    const dateMap = {};
    hourlyData.forEach(h => {
        if (!dateMap[h.date_str]) dateMap[h.date_str] = {};
        dateMap[h.date_str][h.hour_of_day] = h;
    });

    const dates = Object.keys(dateMap).sort();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Define function to render a single heatmap grid
    const renderGrid = (type) => {
        let html = '';

        // Hour labels row
        html += '<div class="heatmap-hour-labels">';
        for (let h = 0; h < 24; h++) {
            html += `<div class="heatmap-hour-label">${h.toString().padStart(2, '0')}</div>`;
        }
        html += '</div>';

        // Data rows
        html += '<div class="heatmap-grid">';
        dates.forEach(date => {
            const d = new Date(date + 'T12:00:00');
            const dayName = dayNames[d.getDay()];
            const label = `${dayName} ${date.substring(5)}`;

            html += '<div class="heatmap-row">';
            html += `<div class="heatmap-label">${label}</div>`;

            for (let h = 0; h < 24; h++) {
                const cell = dateMap[date][h];
                if (cell) {
                    const cellTotal = cell.total_count || 0;
                    const cellTimeouts = cell.timeout_count || 0;
                    
                    const cellSuccess = cellTotal - cellTimeouts;
                    const upSecs = cellSuccess * pingInterval;
                    const downSecs = cellTimeouts * pingTimeout;
                    const totSecs = upSecs + downSecs;
                    const cellLossPct = totSecs > 0 ? (downSecs / totSecs) * 100 : 0;

                    let color = '';
                    let tooltip = '';

                    if (type === 'latency') {
                        color = getLatencyColor(cell.avg_latency);
                        const avgStr = cell.avg_latency != null ? cell.avg_latency.toFixed(1) + 'ms' : 'N/A';
                        tooltip = `${date} ${h.toString().padStart(2, '0')}:00 | Avg Latency: ${avgStr}`;
                    } else {
                        color = getLossColor(cellLossPct, true);
                        tooltip = `${date} ${h.toString().padStart(2, '0')}:00 | Loss: ${cellLossPct.toFixed(2)}% (${cell.timeout_count} timeouts)`;
                    }

                    html += `<div class="heatmap-cell" style="background:${color}" data-tooltip="${tooltip}"></div>`;
                } else {
                    html += `<div class="heatmap-cell" style="background:var(--heatmap-empty)" data-tooltip="${date} ${h.toString().padStart(2, '0')}:00 | No data"></div>`;
                }
            }
            html += '</div>';
        });
        html += '</div>';
        return html;
    };

    // Render both grids
    let latencyHtml = renderGrid('latency');
    let lossHtml = renderGrid('loss');

    // Add unique legends
    latencyHtml += `
        <div class="heatmap-legend">
            <span class="heatmap-legend-label">Excellent</span>
            <div class="heatmap-legend-block" style="background:#059669"></div>
            <div class="heatmap-legend-block" style="background:#10b981"></div>
            <div class="heatmap-legend-block" style="background:#34d399"></div>
            <span class="heatmap-legend-label">Good</span>
            <div class="heatmap-legend-block" style="background:#fbbf24"></div>
            <div class="heatmap-legend-block" style="background:#f59e0b"></div>
            <span class="heatmap-legend-label">High</span>
            <div class="heatmap-legend-block" style="background:#ef4444"></div>
            <div class="heatmap-legend-block" style="background:#dc2626"></div>
            <span class="heatmap-legend-label">Severe</span>
            <div class="heatmap-legend-block" style="background:#1e293b"></div>
            <span class="heatmap-legend-label">No Data</span>
        </div>
    `;

    lossHtml += `
        <div class="heatmap-legend">
            <span class="heatmap-legend-label"><=2%</span>
            <div class="heatmap-legend-block" style="background:#059669"></div>
            <span class="heatmap-legend-label">>2%</span>
            <div class="heatmap-legend-block" style="background:#fbbf24"></div>
            <span class="heatmap-legend-label">>5%</span>
            <div class="heatmap-legend-block" style="background:#f59e0b"></div>
            <span class="heatmap-legend-label">>20%</span>
            <div class="heatmap-legend-block" style="background:#ef4444"></div>
            <span class="heatmap-legend-label">>50%</span>
            <div class="heatmap-legend-block" style="background:#dc2626"></div>
            <span class="heatmap-legend-label">Extreme</span>
            <div class="heatmap-legend-block" style="background:#1e293b"></div>
            <span class="heatmap-legend-label">No Data</span>
        </div>
    `;

    document.getElementById('latency-heatmap-container').innerHTML = latencyHtml;
    document.getElementById('loss-heatmap-container').innerHTML = lossHtml;
}

// ─── Daily Summary Table ──────────────────────────────────────────────

async function updateDailyTable() {
    const tzOffset = -new Date().getTimezoneOffset();
    const data = await api(`/api/daily?days=30&tz=${tzOffset}`);
    if (!data || !data.data) return;

    const tbody = document.getElementById('daily-table-body');

    if (data.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="table-loading">No data available yet.</td></tr>';
        return;
    }

    tbody.innerHTML = data.data.map(d => {
        const uptimeClass = d.uptime_pct >= 99.5 ? 'uptime-good' : d.uptime_pct >= 95 ? 'uptime-warn' : 'uptime-bad';
        const timeoutClass = d.total_timeouts > 0 ? 'timeout-count has-timeouts' : 'timeout-count';

        return `<tr>
            <td>${d.date_str}</td>
            <td>${formatLatency(d.avg_latency)} ms</td>
            <td>${formatLatency(d.min_latency)} ms</td>
            <td>${formatLatency(d.max_latency)} ms</td>
            <td class="${timeoutClass}">${d.total_timeouts.toLocaleString()}</td>
            <td>${d.total_pings.toLocaleString()}</td>
            <td class="${uptimeClass}">${d.uptime_pct.toFixed(2)}%</td>
        </tr>`;
    }).join('');
}

// ─── Incidents Table ──────────────────────────────────────────────────

async function updateIncidentsTable() {
    const data = await api(`/api/incidents?days=${incidentsDays}`);
    if (!data || !data.data) return;

    const tbody = document.getElementById('incidents-table-body');
    const incidents = data.data;

    if (incidents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="table-loading">No incidents detected in this period! 🎉</td></tr>';
        return;
    }

    tbody.innerHTML = incidents.map(i => {
        const badgeClass = i.type === 'Outage' ? 'badge-outage' : 'badge-latency';
        const typeHtml = `<span class="type-badge ${badgeClass}">${i.type}</span>` +
            (i.ongoing ? ' <span class="type-badge badge-ongoing">Ongoing</span>' : '');

        let severityText = '';
        if (i.type === 'Outage') {
            severityText = `Loss: <strong>${i.max_loss.toFixed(1)}%</strong>`;
        } else {
            severityText = `Max ping: <strong>${formatLatency(i.max_latency)}ms</strong>`;
        }

        return `<tr>
            <td style="white-space: nowrap;">${formatDateTime(i.start_ts)}</td>
            <td style="font-weight: 600; color: var(--text-primary);">${formatDuration(i.duration_minutes)}</td>
            <td>${typeHtml}</td>
            <td style="color: var(--text-secondary);">${severityText}</td>
        </tr>`;
    }).join('');
}


// ─── Info ─────────────────────────────────────────────────────────────

async function updateInfo() {
    const data = await api('/api/info');
    if (!data) return;

    document.getElementById('header-target').textContent = data.target;
    document.getElementById('info-db-size').textContent = data.database.db_size_mb + ' MB';
    document.getElementById('info-records').textContent = formatNumber(data.database.row_count);
    document.getElementById('info-since').textContent = formatDate(data.database.oldest_timestamp);
    document.getElementById('info-interval').textContent = data.interval + 's';
}

// ─── Range Picker Handlers ────────────────────────────────────────────

document.getElementById('range-picker').addEventListener('click', (e) => {
    if (!e.target.classList.contains('range-btn')) return;

    // Update active state
    document.querySelectorAll('#range-picker .range-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');

    currentRange = e.target.dataset.range;

    // Destroy and recreate charts for new range
    if (historicalChart) { historicalChart.destroy(); historicalChart = null; }
    if (timeoutsChart) { timeoutsChart.destroy(); timeoutsChart = null; }

    updateHistoricalChart();
    updateTimeoutsChart();
});

document.getElementById('heatmap-range').addEventListener('click', (e) => {
    if (!e.target.classList.contains('range-btn')) return;

    document.querySelectorAll('#heatmap-range .range-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');

    heatmapDays = parseInt(e.target.dataset.days);
    updateHeatmap();
});

document.getElementById('incidents-range').addEventListener('click', (e) => {
    if (!e.target.classList.contains('range-btn')) return;

    document.querySelectorAll('#incidents-range .range-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');

    incidentsDays = parseInt(e.target.dataset.days);
    updateIncidentsTable();
});

// ─── Initialization ───────────────────────────────────────────────────

async function init() {
    // Load persisted theme synchronously
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);

    // Fetch Configuration Settings
    try {
        const settings = await api('/api/settings');
        if (settings && settings.mode) monitorMode = settings.mode;
        if (settings && settings.interval) pingInterval = settings.interval;
        if (settings && settings.timeout) pingTimeout = settings.timeout;
    } catch(e) {
        console.error("Failed to load settings:", e);
    }

    // Dropdown for Summary
    const summarySelect = document.getElementById('summary-range-select');
    if (summarySelect) {
        summarySelect.addEventListener('change', () => {
            updateSummary();
        });
    }

    // Tooltip setup
    const globalTooltip = document.getElementById('global-tooltip');

    document.addEventListener('mouseover', (e) => {
        if (e.target.classList.contains('heatmap-cell') && e.target.dataset.tooltip) {
            globalTooltip.textContent = e.target.dataset.tooltip;
            globalTooltip.classList.add('visible');
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (e.target.classList.contains('heatmap-cell')) {
            globalTooltip.style.left = e.clientX + 'px';
            globalTooltip.style.top = e.clientY + 'px';
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (e.target.classList.contains('heatmap-cell')) {
            globalTooltip.classList.remove('visible');
        }
    });

    // Staggered initial load — prevent flooding the main thread on startup.
    // Priority 1 (immediate): visible status + summary text — renders above the fold
    updateStatus();
    updateSummary();
    updateStats();

    // Priority 2 (short delay): live chart is small and fast
    setTimeout(() => updateLiveChart(), 100);

    // Priority 3 (after first paint settles): heavy historical charts
    setTimeout(() => updateHistoricalChart(), 300);
    setTimeout(() => updateTimeoutsChart(), 600);

    // Priority 4 (background): heatmap, tables, incidents — user must scroll to see these
    setTimeout(() => updateHeatmap(), 900);
    setTimeout(() => updateDailyTable(), 1200);
    setTimeout(() => updateIncidentsTable(), 1500);
    setTimeout(() => updateInfo(), 1800);

    // Set up refresh intervals
    setInterval(() => {
        updateStatus();
        updateLiveChart();
    }, REFRESH_INTERVAL);

    let lastDynamicRefresh = 0;
    setInterval(() => {
        const now = Date.now();
        updateStats(); // 24h ranges are lightweight, always keep synced
        updateSummary(); // Sync short text summary

        // Throttle Chart JS UI refreshes based on range scale to eliminate massive unneeded calculation stutters
        let shouldRefreshCharts = false;
        if (currentRange === '1h' || currentRange === '6h') {
            shouldRefreshCharts = true; // refresh every 15s
        } else if (currentRange === '24h') {
            if (now - lastDynamicRefresh >= 59000) shouldRefreshCharts = true; // refresh every 1 minute
        } else {
            if (now - lastDynamicRefresh >= 299000) shouldRefreshCharts = true; // refresh every 5 minutes
        }

        if (shouldRefreshCharts || lastDynamicRefresh === 0) {
            updateHistoricalChart();
            updateTimeoutsChart();
            lastDynamicRefresh = now;
        }
    }, STATS_REFRESH);

    setInterval(() => {
        updateHeatmap();
        updateDailyTable();
        updateIncidentsTable();
        updateInfo();
    }, HEATMAP_REFRESH);
}

// Start
init().catch(console.error);
