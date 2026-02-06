const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const CALL_LOGS_TABLE = 'm013en5u2cyu30j';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';

let currentCalls = [];
let allCalls = [];
let callsChart = null;
let dateFilter = null;
let currentCallsPage = [];

async function fetchData(tableId, limit = 100) {
    const res = await fetch(`${API_BASE}/${tableId}/records?limit=${limit}&sort=-CreatedAt`, {
        headers: { 'xc-token': XC_TOKEN }
    });
    const data = await res.json();
    return data.list || [];
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

function renderChart(calls) {
    const ctx = document.getElementById('callsChart').getContext('2d');

    // Process data for the last 7 days or matching the filter
    const last7Days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toISOString().split('T')[0];
    }).reverse();

    const statsByDate = last7Days.reduce((acc, date) => {
        acc[date] = { total: 0, success: 0 };
        return acc;
    }, {});

    calls.forEach(call => {
        const date = new Date(call.call_time || call.CreatedAt).toISOString().split('T')[0];
        if (statsByDate[date]) {
            statsByDate[date].total++;
            if (getBadgeClass(call.evaluation) === 'success') {
                statsByDate[date].success++;
            }
        }
    });

    const labels = Object.keys(statsByDate).map(d => d.split('-').slice(1).reverse().join('/'));
    const totalData = Object.values(statsByDate).map(s => s.total);
    const successData = Object.values(statsByDate).map(s => s.success);

    if (callsChart) {
        callsChart.destroy();
    }

    callsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Total Llamadas',
                    data: totalData,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 3,
                    pointRadius: 4,
                    pointBackgroundColor: '#6366f1'
                },
                {
                    label: 'Éxitos',
                    data: successData,
                    borderColor: '#10b981',
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.4,
                    borderWidth: 3,
                    pointRadius: 4,
                    pointBackgroundColor: '#10b981'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 15, 20, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', stepSize: 1 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
}

async function openDetail(index) {
    const call = currentCallsPage[index];
    if (!call) return;

    document.getElementById('modal-title').textContent = call.lead_name || 'Llamada';
    document.getElementById('modal-subtitle').textContent = `${call.phone_called} • ${formatDate(call.call_time || call.CreatedAt)}`;
    document.getElementById('modal-transcript').textContent = call.transcript || 'No hay transcripción disponible.';
    document.getElementById('modal-notes').value = call.notes || '';
    document.getElementById('save-notes-btn').setAttribute('data-id', call.id || call.Id);

    // Initial Hide Confirmed Section
    const confirmedSec = document.getElementById('confirmed-section');
    if (confirmedSec) confirmedSec.style.display = 'none';

    // Fetch Confirmed Data if applicable
    if (call.is_confirmed === true || call.is_confirmed === 1 || call.is_confirmed === '1') {
        try {
            const CONFIRMED_TABLE = 'mtoilizta888pej'; // Table ID for confirmed_data
            const res = await fetch(`${API_BASE}/${CONFIRMED_TABLE}/records?where=(vapi_call_id,eq,${call.vapi_call_id})`, {
                headers: { 'xc-token': XC_TOKEN }
            });
            const data = await res.json();
            const confirmed = data.list ? data.list[0] : null;

            if (confirmed && confirmedSec) {
                confirmedSec.style.display = 'block';
                document.getElementById('conf-name').textContent = confirmed.name || '-';
                document.getElementById('conf-phone').textContent = confirmed.phone || '-';
                document.getElementById('conf-email').textContent = confirmed.email || '-';
            }
        } catch (err) {
            console.error('Error fetching confirmed data:', err);
        }
    }

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

async function loadData() {
    try {
        const calls = await fetchData(CALL_LOGS_TABLE);
        allCalls = calls;
        currentCalls = calls;

        const showConfirmedOnly = document.getElementById('filter-confirmed').checked;
        const dateRange = document.getElementById('date-range').value;

        let filteredCalls = calls;

        // Apply Confirmed Filter
        if (showConfirmedOnly) {
            filteredCalls = filteredCalls.filter(c => c.is_confirmed === true || c.is_confirmed === 1 || c.is_confirmed === '1');
        }

        // Apply Date Filter
        if (dateRange && dateRange.includes(' a ')) {
            const [start, end] = dateRange.split(' a ').map(d => new Date(d));
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            filteredCalls = filteredCalls.filter(c => {
                const callDate = new Date(c.call_time || c.CreatedAt);
                return callDate >= start && callDate <= end;
            });
        }

        const totalCalls = calls.length;
        const confirmedCalls = calls.filter(c => c.is_confirmed === true || c.is_confirmed === 1 || c.is_confirmed === '1').length;
        const confirmationRate = totalCalls > 0 ? Math.round((confirmedCalls / totalCalls) * 100) : 0;

        const successCalls = calls.filter(c => getBadgeClass(c.evaluation) === 'success').length;
        const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
        const totalDuration = calls.reduce((sum, c) => sum + (parseInt(c.duration_seconds) || 0), 0);
        const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

        document.getElementById('total-calls').textContent = totalCalls;
        document.getElementById('success-rate').textContent = successRate + '%';
        document.getElementById('avg-duration').textContent = formatDuration(avgDuration);

        // New KPIs
        document.getElementById('confirmed-count').textContent = confirmedCalls;
        document.getElementById('confirmation-rate').textContent = confirmationRate + '%';

        const tbody = document.getElementById('call-table');
        if (filteredCalls.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No hay llamadas registradas que coincidan con el filtro</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        filteredCalls.forEach((call, index) => {
            const tr = document.createElement('tr');
            const vapiId = call.vapi_call_id || call.lead_id || call.id || call.Id || '-';
            const shortId = vapiId.length > 20 ? vapiId.substring(0, 8) + '...' : vapiId;

            const isConfirmed = call.is_confirmed === true || call.is_confirmed === 1 || call.is_confirmed === '1';
            if (isConfirmed) tr.classList.add('confirmed-row');

            tr.innerHTML = `
                <td><code style="font-family: monospace; color: var(--accent); font-size: 11px;" title="${vapiId}">${shortId}</code></td>
                <td><strong>${call.lead_name || '-'}</strong></td>
                <td class="phone">${call.phone_called || '-'}</td>
                <td>${formatDate(call.call_time || call.CreatedAt)}</td>
                <td>${call.ended_reason || '-'}</td>
                <td><span class="badge ${getBadgeClass(call.evaluation)}">${call.evaluation || 'Pendiente'}</span></td>
                <td>${formatDuration(call.duration_seconds)}</td>
                <td class="table-notes">${call.notes || '-'}</td>
                <td>${isConfirmed ? '✅' : '❌'}</td>
                <td>
                    <button class="action-btn" data-index="${index}">👁 Ver Detalle</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Update Chart
        renderChart(filteredCalls);
        currentCallsPage = filteredCalls;
    } catch (err) {
        console.error('Error:', err);
        document.getElementById('call-table').innerHTML = '<tr><td colspan="10" class="empty-state">Error al cargar datos</td></tr>';
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
document.getElementById('filter-confirmed').addEventListener('change', loadData);
document.getElementById('close-modal').addEventListener('click', closeModal);
document.getElementById('save-notes-btn').addEventListener('click', saveNotes);

document.getElementById('call-table').addEventListener('click', (e) => {
    if (e.target.classList.contains('action-btn')) {
        const index = parseInt(e.target.getAttribute('data-index'));
        openDetail(index);
    }
});

document.getElementById('detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'detail-modal' || e.target.classList.contains('modal')) closeModal();
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

    // Initialize Flatpickr
    dateFilter = flatpickr("#date-range", {
        mode: "range",
        dateFormat: "Y-m-d",
        locale: "es",
        maxDate: "today",
        onChange: function (selectedDates, dateStr) {
            if (selectedDates.length === 2) {
                loadData();
            }
        }
    });

    loadData();
}

function checkAuth() {
    if (localStorage.getItem('dashboard_auth') === 'true') {
        showDashboard();
    }
}

checkAuth();

// --- Manual Vapi Call Integration ---
const VAPI_API_KEY = '852080ba-ce7c-4778-b218-bf718613a2b6';
const VAPI_ASSISTANT_ID = '49e56db1-1f20-4cf1-b031-9cea9fba73cb';
const VAPI_PHONE_NUMBER_ID = '611c8c8e-ab43-4af0-8df0-f2f8fac8115b';

function normalizePhone(phone) {
    let p = phone.toString().replace(/\D/g, '');
    if (!p) return '';
    return p.startsWith('34') ? '+' + p : '+34' + p;
}

async function triggerManualCall() {
    const name = document.getElementById('manual-lead-name').value;
    const company = document.getElementById('manual-company').value;
    const phone = document.getElementById('manual-phone').value;
    const feedback = document.getElementById('call-feedback');
    const btn = document.getElementById('trigger-call-btn');

    if (!name || !phone || !company) {
        feedback.textContent = '❌ Por favor, rellena todos los campos';
        feedback.className = 'feedback-error';
        return;
    }

    const formattedPhone = normalizePhone(phone);

    btn.disabled = true;
    btn.textContent = '⌛ Iniciando Llamada...';
    feedback.textContent = 'Conectando con Vapi AI...';
    feedback.className = 'feedback-loading';

    try {
        // 1. Call Vapi AI
        const vapiRes = await fetch('https://api.vapi.ai/call', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer: { number: formattedPhone },
                assistantId: VAPI_ASSISTANT_ID,
                phoneNumberId: VAPI_PHONE_NUMBER_ID,
                assistantOverrides: {
                    variableValues: {
                        nombre: name,
                        empresa: company,
                        tel_contacto: formattedPhone
                    }
                }
            })
        });

        const vapiData = await vapiRes.json();

        if (!vapiRes.ok) throw new Error(vapiData.message || 'Error en Vapi AI');

        feedback.textContent = '✅ Llamada iniciada. Registrando en log...';

        // 2. Log to NocoDB
        const logRes = await fetch(`${API_BASE}/${CALL_LOGS_TABLE}/records`, {
            method: 'POST',
            headers: {
                'xc-token': XC_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                vapi_call_id: vapiData.id,
                lead_name: company || name,
                phone_called: formattedPhone,
                call_time: new Date().toISOString(),
                ended_reason: 'Manual Trigger'
            })
        });

        if (logRes.ok) {
            feedback.textContent = '🚀 ¡Llamada lanzada con éxito!';
            feedback.className = 'feedback-success';
            setTimeout(() => {
                closeManualModal();
                loadData();
            }, 2000);
        } else {
            throw new Error('Error al guardar log en NocoDB');
        }

    } catch (err) {
        console.error('Manual Call Error:', err);
        feedback.textContent = `❌ Error: ${err.message}`;
        feedback.className = 'feedback-error';
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Lanzar Llamada';
    }
}

function openManualModal() {
    document.getElementById('manual-call-modal').style.display = 'flex';
    document.getElementById('manual-lead-name').value = '';
    document.getElementById('manual-phone').value = '';
    document.getElementById('manual-company').value = '';
    document.getElementById('call-feedback').textContent = '';
}

function closeManualModal() {
    document.getElementById('manual-call-modal').style.display = 'none';
}

document.getElementById('manual-call-fab').addEventListener('click', openManualModal);
document.getElementById('close-manual-modal').addEventListener('click', closeManualModal);
document.getElementById('trigger-call-btn').addEventListener('click', triggerManualCall);
document.getElementById('manual-call-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('manual-call-modal')) {
        closeManualModal();
    }
});
