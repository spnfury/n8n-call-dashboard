/**
 * ═══════════════════════════════════════════════
 * EcomPulse — Dashboard de Confirmación de Pedidos
 * ═══════════════════════════════════════════════
 * 
 * Fork de call-dashboard-app adaptado para ecommerce.
 * Backend de voz: Pipecat + Twilio (reemplaza Vapi)
 * Base de datos: NocoDB
 */

// ═══ CONFIGURATION ═══
const CONFIG = {
    // NocoDB
    NOCODB_BASE: 'https://nocodb.example.com/api/v1/db/data/noco',
    NOCODB_TOKEN: 'YOUR_NOCODB_TOKEN',
    PROJECT_ID: 'YOUR_PROJECT_ID',

    // Tables
    ORDERS_TABLE: 'orders',           // Pedidos pendientes de confirmar
    CALL_LOGS_TABLE: 'ecom_call_logs', // Registro de llamadas
    CONFIRMED_TABLE: 'confirmed_orders', // Datos confirmados por el cliente

    // Voice Backend (Pipecat + Twilio)
    PIPECAT_API_BASE: 'http://localhost:7860', // Servidor Pipecat local
    TWILIO_WEBHOOK_URL: '',  // Se configura en Phase 2

    // n8n Webhook
    N8N_WEBHOOK_BASE: 'https://your-n8n.example.com/webhook',
    N8N_CONFIRM_ENDPOINT: '/ecom-confirm-order',
    N8N_TRIGGER_CALL: '/ecom-trigger-call',

    // Auth
    DASHBOARD_PASSWORD: 'ecom2026',

    // Limits
    MAX_CONCURRENT_CALLS: 10,
    POLL_INTERVAL_MS: 5000,
    PAGE_SIZE: 100,
};

// ═══ STATE ═══
let state = {
    orders: [],
    callLogs: [],
    confirmedOrders: [],
    currentTab: 'dashboard',
    currentDetailCall: null,
    isAuthenticated: false,
    realtimeInterval: null,
    clockInterval: null,
};

// ═══ INITIALIZATION ═══
document.addEventListener('DOMContentLoaded', () => {
    setupAuth();
    setupNavigation();
    setupClock();
    setupModals();
    setupFilters();
    setupScheduler();
    setupCSVImport();

    // Check stored auth
    if (sessionStorage.getItem('ecom_auth') === 'true') {
        authenticate();
    }
});

// ═══ AUTHENTICATION ═══
function setupAuth() {
    const form = document.getElementById('login-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const password = document.getElementById('password-input').value;
        if (password === CONFIG.DASHBOARD_PASSWORD) {
            sessionStorage.setItem('ecom_auth', 'true');
            authenticate();
        } else {
            document.getElementById('auth-error').style.display = 'block';
            document.getElementById('password-input').value = '';
        }
    });
}

function authenticate() {
    state.isAuthenticated = true;
    document.body.classList.remove('auth-hidden');
    document.getElementById('login-gate').style.display = 'none';
    loadDashboardData();
}

// ═══ NAVIGATION ═══
function setupNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;
            switchTab(target);
        });
    });
}

function switchTab(tabName) {
    state.currentTab = tabName;

    // Update tab active state
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update view
    document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));

    const viewMap = {
        'dashboard': 'view-dashboard',
        'orders': 'view-orders',
        'scheduler': 'view-scheduler',
        'realtime': 'view-realtime',
        'test': 'view-test'
    };

    document.getElementById(viewMap[tabName]).classList.add('active');

    // Start/stop realtime polling
    if (tabName === 'realtime') {
        startRealtimePolling();
    } else {
        stopRealtimePolling();
    }
}

// ═══ CLOCK ═══
function setupClock() {
    const updateClock = () => {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'Europe/Madrid'
        });
        const el = document.getElementById('live-clock');
        if (el) el.textContent = timeStr;
    };
    updateClock();
    state.clockInterval = setInterval(updateClock, 1000);
}

// ═══ DATA LOADING ═══
async function loadDashboardData() {
    try {
        await Promise.all([
            loadCallLogs(),
            loadOrders(),
        ]);
        renderDashboard();
        renderOrdersTab();
    } catch (err) {
        console.error('Error loading dashboard data:', err);
    }
}

async function loadCallLogs() {
    try {
        let allLogs = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const url = `${CONFIG.NOCODB_BASE}/${CONFIG.PROJECT_ID}/${CONFIG.CALL_LOGS_TABLE}/records?limit=${CONFIG.PAGE_SIZE}&offset=${offset}&sort=-CreatedAt`;
            const res = await fetch(url, {
                headers: { 'xc-token': CONFIG.NOCODB_TOKEN }
            });
            const data = await res.json();

            if (data.list && data.list.length > 0) {
                allLogs = allLogs.concat(data.list);
                offset += data.list.length;
                hasMore = data.list.length === CONFIG.PAGE_SIZE;
            } else {
                hasMore = false;
            }
        }

        state.callLogs = allLogs;
    } catch (err) {
        console.error('Error loading call logs:', err);
        state.callLogs = [];
    }
}

async function loadOrders() {
    try {
        let allOrders = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const url = `${CONFIG.NOCODB_BASE}/${CONFIG.PROJECT_ID}/${CONFIG.ORDERS_TABLE}/records?limit=${CONFIG.PAGE_SIZE}&offset=${offset}&sort=-CreatedAt`;
            const res = await fetch(url, {
                headers: { 'xc-token': CONFIG.NOCODB_TOKEN }
            });
            const data = await res.json();

            if (data.list && data.list.length > 0) {
                allOrders = allOrders.concat(data.list);
                offset += data.list.length;
                hasMore = data.list.length === CONFIG.PAGE_SIZE;
            } else {
                hasMore = false;
            }
        }

        state.orders = allOrders;
    } catch (err) {
        console.error('Error loading orders:', err);
        state.orders = [];
    }
}

// ═══ DASHBOARD RENDERING ═══
function renderDashboard() {
    const logs = getFilteredLogs();

    // Stats
    const totalCalls = logs.length;
    const confirmed = logs.filter(c => c.order_status === 'Confirmado').length;
    const modified = logs.filter(c => c.order_status === 'Modificado').length;
    const cancelled = logs.filter(c => c.order_status === 'Cancelado').length;
    const confirmRate = totalCalls > 0 ? Math.round((confirmed / totalCalls) * 100) : 0;

    // Average order value
    const ordersWithTotal = logs.filter(c => c.order_total && c.order_total > 0);
    const avgOrderValue = ordersWithTotal.length > 0
        ? (ordersWithTotal.reduce((sum, c) => sum + parseFloat(c.order_total || 0), 0) / ordersWithTotal.length).toFixed(2)
        : '—';

    animateCounter('total-calls', totalCalls);
    animateCounter('confirmed-count', confirmed);
    animateCounter('modified-count', modified);
    animateCounter('cancelled-count', cancelled);
    document.getElementById('confirmation-rate').textContent = `${confirmRate}%`;
    document.getElementById('avg-order-value').textContent = avgOrderValue !== '—' ? `${avgOrderValue}€` : '—';

    // Render call history table
    renderCallTable(logs, 'call-table');

    // Render chart
    renderChart(logs);

    // Test tab
    renderTestCalls();
}

function animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;

    const duration = 600;
    const start = parseInt(el.textContent) || 0;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        const current = Math.round(start + (target - start) * eased);
        el.textContent = current;
        if (progress < 1) requestAnimationFrame(update);
    }

    requestAnimationFrame(update);
}

function getFilteredLogs() {
    let filtered = [...state.callLogs];

    // Filter out test calls
    filtered = filtered.filter(c => !isTestCall(c));

    // Search filter
    const search = document.getElementById('filter-company')?.value?.toLowerCase() || '';
    if (search) {
        filtered = filtered.filter(c =>
            (c.customer_name || '').toLowerCase().includes(search) ||
            (c.order_number || '').toLowerCase().includes(search) ||
            (c.phone_called || '').toLowerCase().includes(search)
        );
    }

    // Status filter
    const statusFilter = document.getElementById('filter-status')?.value || 'all';
    if (statusFilter !== 'all') {
        const statusMap = {
            'confirmed': 'Confirmado',
            'modified': 'Modificado',
            'cancelled': 'Cancelado',
            'unreachable': 'No contesta'
        };
        filtered = filtered.filter(c => c.order_status === statusMap[statusFilter]);
    }

    // Amount filter
    const amountFilter = document.getElementById('filter-score')?.value || 'all';
    if (amountFilter !== 'all') {
        const [min, max] = amountFilter.replace('+', '-9999').split('-').map(Number);
        filtered = filtered.filter(c => {
            const total = parseFloat(c.order_total || 0);
            return total >= min && total <= (max || 9999);
        });
    }

    // Confirmed filter
    const confirmedOnly = document.getElementById('filter-confirmed')?.checked;
    if (confirmedOnly) {
        filtered = filtered.filter(c => c.order_status === 'Confirmado');
    }

    return filtered;
}

function isTestCall(call) {
    return call.is_test === true || call.is_test === 1;
}

function renderCallTable(logs, tableId) {
    const tbody = document.getElementById(tableId);
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No hay llamadas registradas</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(call => {
        const date = call.CreatedAt ? new Date(call.CreatedAt).toLocaleString('es-ES', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        }) : '—';

        const duration = call.duration ? formatDuration(call.duration) : '—';
        const statusClass = getOrderStatusClass(call.order_status);
        const isConfirmed = call.order_status === 'Confirmado';

        return `
            <tr class="${isConfirmed ? 'confirmed-row' : ''}" data-call-id="${call.Id}">
                <td data-label="Call ID">
                    <span style="font-family: monospace; font-size: 11px; color: var(--text-secondary);">
                        ${(call.call_id || '—').substring(0, 12)}...
                    </span>
                    <button class="action-btn" onclick="copyToClipboard('${call.call_id}')" title="Copiar ID" style="margin-left: 4px; padding: 2px 6px;">📋</button>
                </td>
                <td data-label="Cliente"><strong>${call.customer_name || '—'}</strong></td>
                <td data-label="Nº Pedido"><span style="color: var(--accent); font-weight: 600;">${call.order_number || '—'}</span></td>
                <td data-label="Teléfono" class="phone">${call.phone_called || '—'}</td>
                <td data-label="Fecha">${date}</td>
                <td data-label="Resultado">
                    <span class="badge ${call.call_result === 'success' ? 'success' : call.call_result === 'voicemail' ? 'voicemail' : 'fail'}">
                        ${call.call_result || '—'}
                    </span>
                </td>
                <td data-label="Duración">${duration}</td>
                <td data-label="Importe" style="font-weight: 600;">${call.order_total ? call.order_total + '€' : '—'}</td>
                <td data-label="Estado">
                    <span class="order-status-badge ${statusClass}">${call.order_status || 'Pendiente'}</span>
                </td>
                <td data-label="Detalle">
                    <button class="action-btn" onclick="openCallDetail('${call.Id}')">📄 Ver</button>
                </td>
            </tr>
        `;
    }).join('');
}

function getOrderStatusClass(status) {
    const map = {
        'Pendiente': 'pendiente',
        'Confirmado': 'confirmado',
        'Modificado': 'modificado',
        'Cancelado': 'cancelado',
        'Entregado': 'entregado',
        'No contesta': 'no-contesta',
        'Contestador': 'contestador',
        'Programado': 'programado'
    };
    return map[status] || 'pendiente';
}

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// ═══ CHART ═══
let dashboardChart = null;

function renderChart(logs) {
    const canvas = document.getElementById('callsChart');
    if (!canvas) return;

    // Group by date (last 7 days)
    const days = 7;
    const dateMap = {};
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        dateMap[key] = { total: 0, confirmed: 0, modified: 0, cancelled: 0 };
    }

    logs.forEach(call => {
        if (!call.CreatedAt) return;
        const key = call.CreatedAt.split('T')[0];
        if (dateMap[key]) {
            dateMap[key].total++;
            if (call.order_status === 'Confirmado') dateMap[key].confirmed++;
            if (call.order_status === 'Modificado') dateMap[key].modified++;
            if (call.order_status === 'Cancelado') dateMap[key].cancelled++;
        }
    });

    const labels = Object.keys(dateMap).map(d => {
        const date = new Date(d + 'T12:00:00');
        return date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
    });

    if (dashboardChart) dashboardChart.destroy();

    dashboardChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Confirmados',
                    data: Object.values(dateMap).map(d => d.confirmed),
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderRadius: 6,
                    order: 2
                },
                {
                    label: 'Modificados',
                    data: Object.values(dateMap).map(d => d.modified),
                    backgroundColor: 'rgba(245, 158, 11, 0.7)',
                    borderRadius: 6,
                    order: 3
                },
                {
                    label: 'Cancelados',
                    data: Object.values(dateMap).map(d => d.cancelled),
                    backgroundColor: 'rgba(239, 68, 68, 0.5)',
                    borderRadius: 6,
                    order: 4
                },
                {
                    label: 'Total Llamadas',
                    data: Object.values(dateMap).map(d => d.total),
                    type: 'line',
                    borderColor: '#67e8f9',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    tension: 0.4,
                    fill: true,
                    pointRadius: 4,
                    pointBackgroundColor: '#67e8f9',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: '#8899a6', font: { size: 12 }, padding: 20 }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8899a6' }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8899a6', stepSize: 1 }
                }
            }
        }
    });
}

// ═══ ORDERS TAB ═══
function renderOrdersTab() {
    const orders = state.orders;

    // KPIs
    const total = orders.length;
    const pendientes = orders.filter(o => o.status === 'Pendiente' || !o.status).length;
    const llamando = orders.filter(o => o.status === 'Programado').length;
    const confirmados = orders.filter(o => o.status === 'Confirmado').length;
    const modificados = orders.filter(o => o.status === 'Modificado').length;
    const cancelados = orders.filter(o => o.status === 'Cancelado').length;
    const conversionRate = total > 0 ? Math.round((confirmados / total) * 100) : 0;

    animateCounter('kpi-total-orders', total);
    animateCounter('kpi-pendientes', pendientes);
    animateCounter('kpi-llamando', llamando);
    animateCounter('kpi-confirmados', confirmados);
    animateCounter('kpi-modificados', modificados);
    animateCounter('kpi-cancelados', cancelados);
    document.getElementById('kpi-conversion').textContent = `${conversionRate}%`;

    // KPI bars
    if (total > 0) {
        setBarWidth('kpi-bar-pendientes', (pendientes / total) * 100);
        setBarWidth('kpi-bar-llamando', (llamando / total) * 100);
        setBarWidth('kpi-bar-confirmados', (confirmados / total) * 100);
        setBarWidth('kpi-bar-modificados', (modificados / total) * 100);
        setBarWidth('kpi-bar-cancelados', (cancelados / total) * 100);
    }

    // Orders table
    renderOrdersTable(orders);
}

function setBarWidth(id, pct) {
    const el = document.getElementById(id);
    if (el) {
        setTimeout(() => { el.style.width = `${Math.min(pct, 100)}%`; }, 100);
    }
}

function renderOrdersTable(orders) {
    const tbody = document.getElementById('orders-master-table');
    if (!tbody) return;

    // Apply search filter
    let filtered = [...orders];
    const search = document.getElementById('order-search')?.value?.toLowerCase() || '';
    if (search) {
        filtered = filtered.filter(o =>
            (o.order_number || '').toLowerCase().includes(search) ||
            (o.customer_name || '').toLowerCase().includes(search) ||
            (o.phone || '').toLowerCase().includes(search) ||
            (o.products || '').toLowerCase().includes(search)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No hay pedidos. Importa un CSV o crea uno nuevo.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(order => {
        const statusClass = getOrderStatusClass(order.status || 'Pendiente');
        const nextCall = order.planned_call ? new Date(order.planned_call).toLocaleString('es-ES', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        }) : '—';

        return `
            <tr data-order-id="${order.Id}">
                <td data-label="Nº Pedido"><strong style="color: var(--accent);">${order.order_number || '—'}</strong></td>
                <td data-label="Cliente">${order.customer_name || '—'}</td>
                <td data-label="Teléfono" class="phone">${order.phone || '—'}</td>
                <td data-label="Productos" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${order.products || ''}">${order.products || '—'}</td>
                <td data-label="Total" style="font-weight: 700;">${order.total ? order.total + '€' : '—'}</td>
                <td data-label="Dirección" style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${order.address || ''}">${order.address || '—'}</td>
                <td data-label="Estado"><span class="order-status-badge ${statusClass}">${order.status || 'Pendiente'}</span></td>
                <td data-label="Próx. Llamada">${nextCall}</td>
                <td data-label="Acciones">
                    <div style="display: flex; gap: 6px;">
                        <button class="action-btn" onclick="editOrder('${order.Id}')">✏️</button>
                        <button class="action-btn" onclick="callOrder('${order.Id}')" title="Llamar ahora" style="border-color: rgba(16,185,129,0.3); color: var(--accent);">📞</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ═══ TEST CALLS ═══
function renderTestCalls() {
    const testCalls = state.callLogs.filter(c => isTestCall(c));

    const total = testCalls.length;
    const success = testCalls.filter(c => c.call_result === 'success').length;
    const failed = testCalls.filter(c => c.call_result === 'fail' || c.call_result === 'error').length;
    const voicemail = testCalls.filter(c => c.call_result === 'voicemail').length;

    document.getElementById('test-total').textContent = total;
    document.getElementById('test-success').textContent = success;
    document.getElementById('test-failed').textContent = failed;
    document.getElementById('test-voicemail').textContent = voicemail;

    renderCallTable(testCalls, 'test-call-table');
}

// ═══ CALL DETAIL MODAL ═══
window.openCallDetail = function (callId) {
    const call = state.callLogs.find(c => String(c.Id) === String(callId));
    if (!call) return;

    state.currentDetailCall = call;

    document.getElementById('modal-title').textContent = `Confirmación — ${call.customer_name || 'Sin nombre'}`;
    document.getElementById('modal-subtitle').textContent = `${call.order_number || ''} | ${call.phone_called || ''}`;

    // Order info
    const orderSection = document.getElementById('order-info-section');
    if (call.order_number || call.order_total) {
        orderSection.style.display = 'block';
        document.getElementById('order-number').textContent = call.order_number || '—';
        document.getElementById('order-total').textContent = call.order_total ? `${call.order_total}€` : '—';
        document.getElementById('order-products').textContent = call.order_products || '—';
        document.getElementById('order-address').textContent = call.order_address || '—';
    } else {
        orderSection.style.display = 'none';
    }

    // Transcript
    document.getElementById('modal-transcript').textContent = call.transcript || 'No hay transcripción disponible.';

    // Recording
    const recordingSection = document.getElementById('recording-section');
    if (call.recording_url) {
        recordingSection.style.display = 'block';
        document.getElementById('modal-audio').src = call.recording_url;
    } else {
        recordingSection.style.display = 'none';
    }

    // Error
    const errorSection = document.getElementById('error-section');
    if (call.error_message) {
        errorSection.style.display = 'block';
        document.getElementById('modal-error-detail').textContent = call.error_message;
    } else {
        errorSection.style.display = 'none';
    }

    // Confirmed data
    const confirmedSection = document.getElementById('confirmed-section');
    if (call.order_status === 'Confirmado' || call.order_status === 'Modificado') {
        confirmedSection.style.display = 'block';
        document.getElementById('conf-name').textContent = call.confirmed_name || call.customer_name || '—';
        document.getElementById('conf-address').textContent = call.confirmed_address || '—';
        document.getElementById('conf-phone').textContent = call.confirmed_phone || call.phone_called || '—';
        document.getElementById('conf-products').textContent = call.confirmed_products || '—';
        document.getElementById('conf-modifications').textContent = call.modifications || 'Ninguna';
    } else {
        confirmedSection.style.display = 'none';
    }

    // Notes
    document.getElementById('modal-notes').value = call.notes || '';

    // Show modal
    const modal = document.getElementById('detail-modal');
    modal.style.display = 'flex';
};

// ═══ MODALS ═══
function setupModals() {
    // Detail modal
    document.getElementById('close-modal').addEventListener('click', () => {
        document.getElementById('detail-modal').style.display = 'none';
    });

    // Manual call modal
    document.getElementById('manual-call-fab').addEventListener('click', () => {
        document.getElementById('manual-call-modal').style.display = 'flex';
    });
    document.getElementById('close-manual-modal').addEventListener('click', () => {
        document.getElementById('manual-call-modal').style.display = 'none';
    });

    // Order editor modal
    const closeOrderModal = document.getElementById('close-order-modal');
    if (closeOrderModal) {
        closeOrderModal.addEventListener('click', () => {
            document.getElementById('order-modal').style.display = 'none';
        });
    }
    const cancelOrderSave = document.getElementById('cancel-order-save');
    if (cancelOrderSave) {
        cancelOrderSave.addEventListener('click', () => {
            document.getElementById('order-modal').style.display = 'none';
        });
    }

    // Schedule toggle
    const schedToggle = document.getElementById('manual-schedule-toggle');
    if (schedToggle) {
        schedToggle.addEventListener('change', () => {
            document.getElementById('manual-schedule-fields').style.display = schedToggle.checked ? 'block' : 'none';
        });
    }

    // Save notes
    document.getElementById('save-notes-btn').addEventListener('click', saveNotes);

    // Trigger call
    document.getElementById('trigger-call-btn').addEventListener('click', triggerManualCall);

    // New order button
    const btnAddOrder = document.getElementById('btn-add-order');
    if (btnAddOrder) {
        btnAddOrder.addEventListener('click', () => openOrderEditor(null));
    }

    // Order form submit
    const orderForm = document.getElementById('order-form');
    if (orderForm) {
        orderForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveOrder();
        });
    }

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadDashboardData();
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });
}

// ═══ FILTERS ═══
function setupFilters() {
    const filterInputs = ['filter-company', 'filter-status', 'filter-score', 'filter-confirmed'];
    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => renderDashboard());
            el.addEventListener('input', () => renderDashboard());
        }
    });

    // Date range (Flatpickr)
    if (typeof flatpickr !== 'undefined') {
        flatpickr('#date-range', {
            mode: 'range',
            locale: 'es',
            dateFormat: 'd/m/Y',
            theme: 'dark',
            onChange: () => renderDashboard()
        });
    }

    // Order search
    const orderSearch = document.getElementById('order-search');
    if (orderSearch) {
        orderSearch.addEventListener('input', () => renderOrdersTab());
    }
}

// ═══ MANUAL CALL (Pipecat Integration) ═══
async function triggerManualCall() {
    const btn = document.getElementById('trigger-call-btn');
    const feedback = document.getElementById('call-feedback');

    const customerName = document.getElementById('manual-lead-name').value.trim();
    const orderNumber = document.getElementById('manual-order-number').value.trim();
    const orderTotal = document.getElementById('manual-order-total').value;
    const products = document.getElementById('manual-order-products').value.trim();
    const address = document.getElementById('manual-order-address').value.trim();
    const phone = document.getElementById('manual-phone').value.trim();
    const assistantId = document.getElementById('manual-assistant').value;

    if (!customerName || !phone) {
        feedback.textContent = '❌ Nombre y teléfono son obligatorios';
        feedback.style.color = 'var(--danger)';
        return;
    }

    btn.disabled = true;
    feedback.textContent = '📞 Iniciando llamada...';
    feedback.style.color = 'var(--accent)';
    feedback.style.display = 'block';

    try {
        // Check if scheduling
        const isScheduled = document.getElementById('manual-schedule-toggle').checked;
        const scheduledTime = document.getElementById('manual-schedule-time')?.value;

        const payload = {
            customer_name: customerName,
            order_number: orderNumber,
            order_total: orderTotal,
            products: products,
            address: address,
            phone: phone,
            assistant_id: assistantId,
            scheduled_time: isScheduled ? scheduledTime : null,
        };

        // Call n8n webhook to trigger the call via Pipecat
        const res = await fetch(`${CONFIG.N8N_WEBHOOK_BASE}${CONFIG.N8N_TRIGGER_CALL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            feedback.textContent = isScheduled
                ? `✅ Llamada programada para ${new Date(scheduledTime).toLocaleString('es-ES')}`
                : `✅ Llamada iniciada — ID: ${data.call_id || 'OK'}`;
            feedback.style.color = 'var(--success)';

            // Reload data after a delay
            setTimeout(loadDashboardData, 3000);
        } else {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch (err) {
        console.error('Error triggering call:', err);
        feedback.textContent = `❌ Error: ${err.message}`;
        feedback.style.color = 'var(--danger)';
    } finally {
        btn.disabled = false;
    }
}

// ═══ ORDER EDITOR ═══
window.editOrder = function (orderId) {
    const order = state.orders.find(o => String(o.Id) === String(orderId));
    if (!order) return;
    openOrderEditor(order);
};

function openOrderEditor(order) {
    document.getElementById('order-modal-title').textContent = order ? '📦 Editar Pedido' : '📦 Nuevo Pedido';
    document.getElementById('edit-order-id').value = order ? order.Id : '';
    document.getElementById('edit-order-number').value = order?.order_number || '';
    document.getElementById('edit-customer-name').value = order?.customer_name || '';
    document.getElementById('edit-customer-phone').value = order?.phone || '';
    document.getElementById('edit-customer-email').value = order?.email || '';
    document.getElementById('edit-order-products').value = order?.products || '';
    document.getElementById('edit-order-total').value = order?.total || '';
    document.getElementById('edit-order-status').value = order?.status || 'Pendiente';
    document.getElementById('edit-order-address').value = order?.address || '';
    document.getElementById('edit-order-notes').value = order?.notes || '';
    document.getElementById('edit-order-planned').value = order?.planned_call ? order.planned_call.slice(0, 16) : '';

    document.getElementById('order-modal').style.display = 'flex';
}

async function saveOrder() {
    const id = document.getElementById('edit-order-id').value;
    const data = {
        order_number: document.getElementById('edit-order-number').value,
        customer_name: document.getElementById('edit-customer-name').value,
        phone: document.getElementById('edit-customer-phone').value,
        email: document.getElementById('edit-customer-email').value,
        products: document.getElementById('edit-order-products').value,
        total: document.getElementById('edit-order-total').value,
        status: document.getElementById('edit-order-status').value,
        address: document.getElementById('edit-order-address').value,
        notes: document.getElementById('edit-order-notes').value,
        planned_call: document.getElementById('edit-order-planned').value || null,
    };

    try {
        const url = id
            ? `${CONFIG.NOCODB_BASE}/${CONFIG.PROJECT_ID}/${CONFIG.ORDERS_TABLE}/records`
            : `${CONFIG.NOCODB_BASE}/${CONFIG.PROJECT_ID}/${CONFIG.ORDERS_TABLE}/records`;

        const method = id ? 'PATCH' : 'POST';
        const body = id ? { Id: parseInt(id), ...data } : data;

        await fetch(url, {
            method,
            headers: {
                'xc-token': CONFIG.NOCODB_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        document.getElementById('order-modal').style.display = 'none';
        await loadOrders();
        renderOrdersTab();
    } catch (err) {
        console.error('Error saving order:', err);
        alert('Error al guardar el pedido');
    }
}

window.callOrder = function (orderId) {
    const order = state.orders.find(o => String(o.Id) === String(orderId));
    if (!order) return;

    // Pre-fill manual call modal
    document.getElementById('manual-lead-name').value = order.customer_name || '';
    document.getElementById('manual-order-number').value = order.order_number || '';
    document.getElementById('manual-order-total').value = order.total || '';
    document.getElementById('manual-order-products').value = order.products || '';
    document.getElementById('manual-order-address').value = order.address || '';
    document.getElementById('manual-phone').value = order.phone || '';

    document.getElementById('manual-call-modal').style.display = 'flex';
};

// ═══ NOTES ═══
async function saveNotes() {
    const call = state.currentDetailCall;
    if (!call) return;

    const notes = document.getElementById('modal-notes').value;

    try {
        await fetch(`${CONFIG.NOCODB_BASE}/${CONFIG.PROJECT_ID}/${CONFIG.CALL_LOGS_TABLE}/records`, {
            method: 'PATCH',
            headers: {
                'xc-token': CONFIG.NOCODB_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ Id: call.Id, notes })
        });

        call.notes = notes;
        const btn = document.getElementById('save-notes-btn');
        btn.textContent = '✅ Guardado';
        setTimeout(() => { btn.textContent = '💾 Guardar Notas'; }, 2000);
    } catch (err) {
        console.error('Error saving notes:', err);
    }
}

// ═══ CSV IMPORT ═══
function setupCSVImport() {
    const btn = document.getElementById('btn-import-csv');
    const input = document.getElementById('csv-import');

    if (btn && input) {
        btn.addEventListener('click', () => input.click());
        input.addEventListener('change', handleCSVImport);
    }
}

async function handleCSVImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            const orders = results.data.map(row => ({
                order_number: row.order_number || row['Nº Pedido'] || row.numero_pedido || '',
                customer_name: row.customer_name || row.Cliente || row.nombre || '',
                phone: row.phone || row.Telefono || row.telefono || '',
                email: row.email || row.Email || '',
                products: row.products || row.Productos || row.productos || '',
                total: row.total || row.Total || row.importe || '',
                address: row.address || row.Direccion || row.direccion || '',
                status: 'Pendiente'
            })).filter(o => o.phone && o.customer_name);

            if (orders.length === 0) {
                alert('No se encontraron pedidos válidos en el CSV');
                return;
            }

            try {
                // Batch insert
                for (let i = 0; i < orders.length; i += 10) {
                    const batch = orders.slice(i, i + 10);
                    await fetch(`${CONFIG.NOCODB_BASE}/${CONFIG.PROJECT_ID}/${CONFIG.ORDERS_TABLE}/records`, {
                        method: 'POST',
                        headers: {
                            'xc-token': CONFIG.NOCODB_TOKEN,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(batch)
                    });
                }

                alert(`✅ ${orders.length} pedidos importados correctamente`);
                await loadOrders();
                renderOrdersTab();
            } catch (err) {
                console.error('Error importing CSV:', err);
                alert('Error al importar el CSV');
            }
        }
    });

    e.target.value = '';
}

// ═══ SCHEDULER ═══
function setupScheduler() {
    const previewBtn = document.getElementById('sched-preview-btn');
    const executeBtn = document.getElementById('sched-execute-btn');

    if (previewBtn) previewBtn.addEventListener('click', previewSchedule);
    if (executeBtn) executeBtn.addEventListener('click', executeSchedule);

    // Set default start time to now + 1 hour
    const startInput = document.getElementById('sched-start');
    if (startInput) {
        const now = new Date();
        now.setHours(now.getHours() + 1, 0, 0, 0);
        startInput.value = now.toISOString().slice(0, 16);
    }
}

let scheduledItems = [];

function previewSchedule() {
    const count = parseInt(document.getElementById('sched-count').value) || 50;
    const source = document.getElementById('sched-source').value;
    const skipCalled = document.getElementById('sched-skip-called').checked;
    const startTime = new Date(document.getElementById('sched-start').value);
    const spacing = parseInt(document.getElementById('sched-spacing').value) || 2;

    // Filter eligible orders
    let eligible = state.orders.filter(o => o.phone && o.phone.length >= 9);

    if (skipCalled) {
        eligible = eligible.filter(o =>
            !o.status || o.status === 'Pendiente' || o.status === 'Nuevo'
        );
    }

    // Sort by source preference
    if (source === 'oldest') {
        eligible.sort((a, b) => new Date(a.CreatedAt) - new Date(b.CreatedAt));
    } else if (source === 'highest') {
        eligible.sort((a, b) => (parseFloat(b.total) || 0) - (parseFloat(a.total) || 0));
    } else {
        eligible.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
    }

    eligible = eligible.slice(0, count);

    scheduledItems = eligible.map((order, i) => {
        const callTime = new Date(startTime.getTime() + i * spacing * 60000);
        return { ...order, scheduledTime: callTime };
    });

    // Render preview
    const summary = document.getElementById('sched-summary');
    const stats = document.getElementById('sched-summary-stats');
    const timeline = document.getElementById('sched-timeline');

    if (scheduledItems.length === 0) {
        summary.style.display = 'block';
        timeline.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">No hay pedidos elegibles para programar.</p>';
        return;
    }

    stats.innerHTML = `
        <div class="sched-stat accent">📦 ${scheduledItems.length} pedidos</div>
        <div class="sched-stat success">🕐 ${startTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
        <div class="sched-stat warning">⏱️ cada ${spacing} min</div>
    `;

    timeline.innerHTML = scheduledItems.map((item, i) => `
        <div class="timeline-item" id="timeline-${i}">
            <div class="timeline-index">${i + 1}</div>
            <div class="timeline-info">
                <div class="timeline-name">${item.customer_name || 'Sin nombre'} — ${item.order_number || ''}</div>
                <div class="timeline-phone">${item.phone}</div>
            </div>
            <div class="timeline-time">
                ${item.scheduledTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                <small>${item.total ? item.total + '€' : ''}</small>
            </div>
        </div>
    `).join('');

    summary.style.display = 'block';
    document.getElementById('sched-execute-btn').disabled = false;
}

async function executeSchedule() {
    if (scheduledItems.length === 0) return;

    const executeBtn = document.getElementById('sched-execute-btn');
    executeBtn.disabled = true;

    const progress = document.getElementById('sched-progress');
    const progressBar = document.getElementById('sched-progress-bar');
    const progressText = document.getElementById('sched-progress-text');
    const progressLog = document.getElementById('sched-progress-log');

    progress.style.display = 'block';

    const assistantId = document.getElementById('sched-assistant').value;
    let completed = 0;

    for (const item of scheduledItems) {
        try {
            // Update progress
            completed++;
            const pct = (completed / scheduledItems.length) * 100;
            progressBar.style.width = `${pct}%`;
            progressText.textContent = `${completed} / ${scheduledItems.length}`;

            // Schedule the order via n8n
            await fetch(`${CONFIG.NOCODB_BASE}/${CONFIG.PROJECT_ID}/${CONFIG.ORDERS_TABLE}/records`, {
                method: 'PATCH',
                headers: {
                    'xc-token': CONFIG.NOCODB_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    Id: item.Id,
                    status: 'Programado',
                    planned_call: item.scheduledTime.toISOString(),
                    assistant_id: assistantId
                })
            });

            progressLog.innerHTML += `<div>✅ ${item.customer_name} — ${item.order_number} → ${item.scheduledTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>`;

            // Mark timeline item
            const timelineEl = document.getElementById(`timeline-${scheduledItems.indexOf(item)}`);
            if (timelineEl) timelineEl.classList.add('done');

        } catch (err) {
            progressLog.innerHTML += `<div style="color: var(--danger);">❌ Error: ${item.customer_name} — ${err.message}</div>`;
        }
    }

    progressLog.innerHTML += `<div style="margin-top: 8px; font-weight: 600; color: var(--success);">🎉 Programación completada</div>`;

    // Reload data
    await loadOrders();
    renderOrdersTab();
}

// ═══ REALTIME MONITORING ═══
function startRealtimePolling() {
    if (state.realtimeInterval) return;
    fetchRealtimeData();
    state.realtimeInterval = setInterval(fetchRealtimeData, CONFIG.POLL_INTERVAL_MS);
}

function stopRealtimePolling() {
    if (state.realtimeInterval) {
        clearInterval(state.realtimeInterval);
        state.realtimeInterval = null;
    }
}

async function fetchRealtimeData() {
    try {
        // Fetch active calls from Pipecat API
        const res = await fetch(`${CONFIG.PIPECAT_API_BASE}/active-calls`);

        if (!res.ok) {
            updateRealtimeUI({ active: [], queued: 0, ringing: 0, totalToday: 0 });
            return;
        }

        const data = await res.json();
        updateRealtimeUI(data);
    } catch (err) {
        // Pipecat server not running — show empty state
        updateRealtimeUI({ active: [], queued: 0, ringing: 0, totalToday: 0 });
    }
}

function updateRealtimeUI(data) {
    const activeCalls = data.active || [];
    const queued = data.queued || 0;
    const ringing = data.ringing || 0;
    const totalToday = data.totalToday || 0;

    document.getElementById('rt-active-count').textContent = activeCalls.length;
    document.getElementById('rt-queued-count').textContent = queued;
    document.getElementById('rt-ringing-count').textContent = ringing;
    document.getElementById('rt-total-today').textContent = totalToday;

    // Tab badge
    const badge = document.getElementById('realtime-badge');
    const tabEl = document.getElementById('nav-tab-realtime');
    if (activeCalls.length > 0) {
        badge.style.display = 'inline-flex';
        badge.textContent = activeCalls.length;
        tabEl.classList.add('has-live');
    } else {
        badge.style.display = 'none';
        tabEl.classList.remove('has-live');
    }

    // Status pill
    const statusPill = document.getElementById('realtime-status');
    const statusText = document.getElementById('realtime-status-text');
    if (activeCalls.length > 0) {
        statusPill.classList.add('active');
        statusText.textContent = `${activeCalls.length} activa${activeCalls.length > 1 ? 's' : ''}`;
    } else {
        statusPill.classList.remove('active');
        statusText.textContent = 'Sin llamadas activas';
    }

    // Grid
    const grid = document.getElementById('realtime-calls-grid');
    if (activeCalls.length === 0) {
        grid.innerHTML = `
            <div class="realtime-empty-state">
                <div class="realtime-empty-icon">📡</div>
                <h3>Sin llamadas activas</h3>
                <p>El sistema escanea automáticamente cada 5 segundos.</p>
            </div>
        `;
    } else {
        grid.innerHTML = activeCalls.map(call => `
            <div class="realtime-call-card status-active">
                <div class="realtime-call-header">
                    <div class="realtime-call-info">
                        <div class="realtime-call-phone">
                            📞 ${call.phone || '—'}
                            <span style="font-weight: 400; font-size: 13px; color: var(--text-secondary);">${call.customer_name || ''}</span>
                        </div>
                    </div>
                    <span class="order-status-badge confirmado" style="font-size: 10px;">${call.order_number || ''}</span>
                </div>
            </div>
        `).join('');
    }
}

// Realtime refresh button
const rtRefresh = document.getElementById('realtime-refresh-btn');
if (rtRefresh) rtRefresh.addEventListener('click', fetchRealtimeData);

// ═══ UTILITIES ═══
window.copyToClipboard = function (text) {
    navigator.clipboard.writeText(text).then(() => {
        // Brief visual feedback could be added here
    }).catch(err => console.error('Copy failed:', err));
};

window._toggleDetailTest = function () {
    const call = state.currentDetailCall;
    if (!call) return;

    const newValue = !isTestCall(call);

    fetch(`${CONFIG.NOCODB_BASE}/${CONFIG.PROJECT_ID}/${CONFIG.CALL_LOGS_TABLE}/records`, {
        method: 'PATCH',
        headers: { 'xc-token': CONFIG.NOCODB_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Id: call.Id, is_test: newValue })
    }).then(() => {
        call.is_test = newValue;
        const btn = document.getElementById('toggle-test-btn');
        btn.querySelector('.toggle-test-label').textContent = newValue ? 'Es Test ✅' : 'Marcar como Test';
        btn.classList.toggle('active', newValue);
        renderDashboard();
    });
};

window._retryCall = function () {
    const call = state.currentDetailCall;
    if (!call) return;

    // Pre-fill manual call modal with this call's data
    document.getElementById('manual-lead-name').value = call.customer_name || '';
    document.getElementById('manual-order-number').value = call.order_number || '';
    document.getElementById('manual-order-total').value = call.order_total || '';
    document.getElementById('manual-order-products').value = call.order_products || '';
    document.getElementById('manual-order-address').value = call.order_address || '';
    document.getElementById('manual-phone').value = call.phone_called || '';

    document.getElementById('detail-modal').style.display = 'none';
    document.getElementById('manual-call-modal').style.display = 'flex';
};

console.log('🛒 EcomPulse v0.1.0 initialized');
