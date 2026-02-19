const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const CALL_LOGS_TABLE = 'm013en5u2cyu30j';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const VAPI_API_KEY = '852080ba-ce7c-4778-b218-bf718613a2b6';

let allCalls = [];
let currentCallsPage = [];
let chartInstance = null;

async function fetchData(tableId, limit = 100) {
    const res = await fetch(`${API_BASE}/${tableId}/records?limit=${limit}&sort=-CreatedAt`, {
        headers: { 'xc-token': XC_TOKEN }
    });
    const data = await res.json();
    return data.list || [];
}

const STATUS_MAP = {
    'voicemail': 'Buzón de Voz',
    'customer-ended-call': 'Llamada Finalizada',
    'assistant-ended-call': 'Llamada Finalizada',
    'call-in-progress.error-sip-outbound-call-failed-to-connect': 'Fallo de Conexión',
    'call-in-progress.error-vapi-internal': 'Error Interno',
    'call-initiated': 'Iniciando...',
    'no-answer': 'Sin Respuesta',
    'busy': 'Ocupado'
};

function formatStatus(reason) {
    if (!reason) return '-';
    // Clean and match
    const clean = reason.toLowerCase().trim();
    return STATUS_MAP[clean] || reason;
}

function formatDate(dateStr, short = false) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (short) return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function getBadgeClass(evaluation) {
    if (!evaluation) return 'pending';
    const e = evaluation.toLowerCase();
    if (e.includes('success') || e.includes('completed')) return 'success';
    if (e.includes('fail') || e.includes('error')) return 'fail';
    return 'pending';
}

function formatDuration(seconds) {
    if (!seconds) return '-';
    const s = parseInt(seconds);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function updateChart(calls) {
    const ctx = document.getElementById('call-chart').getContext('2d');

    // Group calls by day
    const grouped = {};
    calls.forEach(c => {
        const day = formatDate(c.CreatedAt || c.call_time, true);
        grouped[day] = (grouped[day] || 0) + 1;
    });

    const labels = Object.keys(grouped).reverse();
    const data = Object.values(grouped).reverse();

    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Llamadas por Día',
                data,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointBackgroundColor: '#6366f1',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#a0a0a0', stepSize: 1 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#a0a0a0' }
                }
            }
        }
    });
}

function renderDashboard(calls) {
    currentCallsPage = calls;

    // Stats
    const totalCalls = calls.length;
    const successCalls = calls.filter(c => getBadgeClass(c.evaluation) === 'success').length;
    const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
    const totalDuration = calls.reduce((sum, c) => sum + (parseInt(c.duration_seconds) || 0), 0);
    const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

    document.getElementById('total-calls').textContent = totalCalls;
    document.getElementById('success-rate').textContent = successRate + '%';
    document.getElementById('avg-duration').textContent = formatDuration(avgDuration);

    // Table
    const tbody = document.getElementById('call-table');
    if (calls.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No hay llamadas para el periodo seleccionado</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    calls.forEach((call, index) => {
        const tr = document.createElement('tr');
        const vapiId = call.vapi_call_id || call.lead_id || call.id || call.Id || '-';
        const shortId = vapiId.length > 20 ? vapiId.substring(0, 8) + '...' : vapiId;

        const isSyncing = !call.ended_reason || call.ended_reason === 'Call Initiated' || call.ended_reason.toLowerCase().includes('in progress');
        const statusText = isSyncing ? '<span class="loading" style="font-size: 11px; color: var(--accent);">⏳ Sincronizando...</span>' : formatStatus(call.ended_reason);

        // Preview notes
        const notePreview = call.notes ? `<span class="badge" style="background: rgba(99, 102, 241, 0.1); color: var(--accent); white-space: normal; line-height: 1.2; text-align: left;">${call.notes.substring(0, 30)}${call.notes.length > 30 ? '...' : ''}</span>` : '-';

        tr.innerHTML = `
            <td><code style="font-family: monospace; color: var(--accent); font-size: 11px;" title="${vapiId}">${shortId}</code></td>
            <td><strong>${call.lead_name || '-'}</strong></td>
            <td class="phone">${call.phone_called || '-'}</td>
            <td>${formatDate(call.call_time || call.CreatedAt)}</td>
            <td>${statusText}</td>
            <td><span class="badge ${getBadgeClass(call.evaluation)}">${call.evaluation || 'Pendiente'}</span></td>
            <td>${formatDuration(call.duration_seconds)}</td>
            <td class="table-notes">${notePreview}</td>
            <td>
                <button class="action-btn" data-index="${index}">👁 Ver Detalle</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateChart(calls);
}

function applyFilters() {
    const from = document.getElementById('date-from').value;
    const to = document.getElementById('date-to').value;

    let filtered = allCalls;

    if (from) {
        const fromDate = new Date(from);
        fromDate.setHours(0, 0, 0, 0);
        filtered = filtered.filter(c => new Date(c.CreatedAt || c.call_time) >= fromDate);
    }

    if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.CreatedAt || c.call_time) <= toDate);
    }

    renderDashboard(filtered);
}

function openDetail(index) {
    const call = currentCallsPage[index];
    if (!call) return;

    document.getElementById('modal-title').textContent = call.lead_name || 'Llamada';
    document.getElementById('modal-subtitle').textContent = `${call.phone_called} • ${formatDate(call.call_time || call.CreatedAt)}`;
    document.getElementById('modal-transcript').textContent = call.transcript || 'No hay transcripción disponible.';
    document.getElementById('modal-notes').value = call.notes || '';
    document.getElementById('save-notes-btn').setAttribute('data-id', call.id || call.Id);

    const audioSec = document.getElementById('recording-section');
    const audio = document.getElementById('modal-audio');
    if (call.recording_url) {
        audioSec.style.display = 'block';
        audio.src = call.recording_url;
    } else {
        audioSec.style.display = 'none';
        audio.src = '';
    }

    const errorSec = document.getElementById('error-section');
    const errorDetail = document.getElementById('modal-error-detail');
    if (call.ended_reason && (call.ended_reason.includes('Error') || call.ended_reason.includes('fail'))) {
        errorSec.style.display = 'block';
        errorDetail.textContent = call.ended_reason;
    } else {
        errorSec.style.display = 'none';
    }

    document.getElementById('detail-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('detail-modal').style.display = 'none';
    document.getElementById('modal-audio').pause();
}

async function syncCallStatus(vapiCallId, recordId) {
    if (!vapiCallId || vapiCallId === '-' || vapiCallId.startsWith('39')) return; // Ignore invalid or manual IDs

    try {
        const res = await fetch(`https://api.vapi.ai/call/${vapiCallId}`, {
            headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
        });

        if (!res.ok) return;
        const data = await res.json();

        // Only update if the call has ended and we have a reason
        if (data.status === 'ended' && data.endedReason) {
            console.log(`Syncing call ${vapiCallId}: ${data.endedReason}`);

            const updatePayload = {
                id: recordId, // Primary key for NocoDB
                ended_reason: data.endedReason,
                duration_seconds: data.durationSeconds || 0,
                cost: data.cost || 0,
                transcript: data.transcript || '',
                recording_url: data.recordingUrl || '',
                evaluation: data.analysis?.successEvaluation || 'Completed'
            };

            // NocoDB V2 PATCH expects an array of objects for /records
            await fetch(`${API_BASE}/${CALL_LOGS_TABLE}/records`, {
                method: 'PATCH',
                headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify([updatePayload])
            });

            return true; // Signal update
        }
    } catch (err) {
        console.error(`Error syncing ${vapiCallId}:`, err);
    }
    return false;
}

async function syncPendingCalls() {
    const pending = allCalls.filter(c =>
        !c.ended_reason ||
        c.ended_reason === 'Call Initiated' ||
        c.ended_reason.toLowerCase().includes('in progress')
    );

    if (pending.length === 0) return;

    console.log(`Checking ${pending.length} pending calls...`);

    let updatedAny = false;
    for (const call of pending) {
        const success = await syncCallStatus(call.vapi_call_id, call.id || call.Id);
        if (success) updatedAny = true;
    }

    if (updatedAny) {
        // Refresh local data silenty
        const updatedCalls = await fetchData(CALL_LOGS_TABLE);
        allCalls = updatedCalls;
        applyFilters();
    }
}

async function loadData() {
    try {
        const calls = await fetchData(CALL_LOGS_TABLE);
        allCalls = calls;
        applyFilters();

        // Start background sync for pending ones
        syncPendingCalls();
    } catch (err) {
        console.error('Error:', err);
        document.getElementById('call-table').innerHTML = '<tr><td colspan="9" class="empty-state">Error al cargar datos</td></tr>';
    }
}

async function saveNotes() {
    const btn = document.getElementById('save-notes-btn');
    const id = btn.getAttribute('data-id');
    const notes = document.getElementById('modal-notes').value;

    if (!id) return;
    btn.disabled = true;
    btn.textContent = '⌛ Guardando...';

    try {
        const res = await fetch(`${API_BASE}/${CALL_LOGS_TABLE}/records`, {
            method: 'PATCH',
            headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify([{ id: id, notes: notes }])
        });

        if (res.ok) {
            btn.textContent = '✅ Guardado';
            setTimeout(() => {
                btn.textContent = '💾 Guardar Notas';
                btn.disabled = false;
                loadData();
            }, 1500);
        } else {
            throw new Error('Failed to save');
        }
    } catch (err) {
        console.error('Error saving notes:', err);
        btn.textContent = '❌ Error';
        btn.disabled = false;
    }
}

// Event listeners
document.getElementById('refresh-btn').addEventListener('click', loadData);
document.getElementById('close-modal').addEventListener('click', closeModal);
document.getElementById('save-notes-btn').addEventListener('click', saveNotes);
document.getElementById('date-from').addEventListener('change', applyFilters);
document.getElementById('date-to').addEventListener('change', applyFilters);

document.getElementById('call-table').addEventListener('click', (e) => {
    if (e.target.classList.contains('action-btn')) {
        const index = parseInt(e.target.getAttribute('data-index'));
        openDetail(index);
    }
});

document.getElementById('detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'detail-modal') closeModal();
});

document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ADMIN_PASSWORD = 'admin123';
    const password = document.getElementById('password-input').value;
    if (password === ADMIN_PASSWORD) {
        localStorage.setItem('dashboard_auth', 'true');
        showDashboard();
    } else {
        document.getElementById('auth-error').style.display = 'block';
    }
});

function showDashboard() {
    document.body.classList.remove('auth-hidden');
    document.getElementById('login-gate').style.display = 'none';
    loadData();
}

function checkAuth() {
    if (localStorage.getItem('dashboard_auth') === 'true') {
        showDashboard();
    }
}

checkAuth();

