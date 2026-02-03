const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const CALL_LOGS_TABLE = 'm013en5u2cyu30j';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';

let currentCalls = [];

async function fetchData(tableId, limit = 100) {
    const res = await fetch(`${API_BASE}/${tableId}/records?limit=${limit}&sort=-CreatedAt`, {
        headers: { 'xc-token': XC_TOKEN }
    });
    const data = await res.json();
    return data.list || [];
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
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

function openDetail(index) {
    console.log('Opening detail for index:', index);
    const call = currentCalls[index];
    if (!call) {
        console.error('Call not found at index:', index);
        return;
    }

    document.getElementById('modal-title').textContent = call.lead_name || 'Llamada';
    document.getElementById('modal-subtitle').textContent = `${call.phone_called} • ${formatDate(call.call_time || call.CreatedAt)}`;
    document.getElementById('modal-transcript').textContent = call.transcript || 'No hay transcripción disponible para esta llamada.';
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

    document.getElementById('detail-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('detail-modal').style.display = 'none';
    document.getElementById('modal-audio').pause();
}

async function loadData() {
    try {
        const calls = await fetchData(CALL_LOGS_TABLE);
        currentCalls = calls;

        const totalCalls = calls.length;
        const successCalls = calls.filter(c => getBadgeClass(c.evaluation) === 'success').length;
        const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
        const totalDuration = calls.reduce((sum, c) => sum + (parseInt(c.duration_seconds) || 0), 0);
        const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

        document.getElementById('total-calls').textContent = totalCalls;
        document.getElementById('success-rate').textContent = successRate + '%';
        document.getElementById('avg-duration').textContent = formatDuration(avgDuration);

        const tbody = document.getElementById('call-table');
        if (calls.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No hay llamadas registradas aún</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        calls.forEach((call, index) => {
            const tr = document.createElement('tr');
            const vapiId = call.lead_id || call.id || call.Id || '-';
            // Extract short version of Vapi ID if it's a full UUID
            const shortId = vapiId.length > 20 ? vapiId.substring(0, 8) + '...' : vapiId;

            tr.innerHTML = `
                <td><code style="font-family: monospace; color: var(--accent); font-size: 11px;" title="${vapiId}">${shortId}</code></td>
                <td><strong>${call.lead_name || '-'}</strong></td>
                <td class="phone">${call.phone_called || '-'}</td>
                <td>${formatDate(call.call_time || call.CreatedAt)}</td>
                <td>${call.ended_reason || '-'}</td>
                <td><span class="badge ${getBadgeClass(call.evaluation)}">${call.evaluation || 'Pendiente'}</span></td>
                <td>${formatDuration(call.duration_seconds)}</td>
                <td class="table-notes">${call.notes || '-'}</td>
                <td>
                    <button class="action-btn" data-index="${index}">👁 Ver Detalle</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Event delegation for action buttons
        tbody.addEventListener('click', (e) => {
            if (e.target.classList.contains('action-btn')) {
                const index = parseInt(e.target.getAttribute('data-index'));
                openDetail(index);
            }
        });

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
            headers: {
                'xc-token': XC_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                Id: id,
                notes: notes
            })
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

// Global exposure for event listeners in HTML if needed, though we used delegation
window.openDetail = openDetail;
window.closeModal = closeModal;
window.loadData = loadData;

// Event listeners
document.getElementById('refresh-btn').addEventListener('click', loadData);
document.getElementById('close-modal').addEventListener('click', closeModal);
document.getElementById('save-notes-btn').addEventListener('click', saveNotes);
document.getElementById('detail-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('detail-modal')) {
        closeModal();
    }
});

const ADMIN_PASSWORD = 'admin123';

async function checkAuth() {
    if (localStorage.getItem('dashboard_auth') === 'true') {
        showDashboard();
    }
}

function showDashboard() {
    document.body.classList.remove('auth-hidden');
    document.getElementById('login-gate').style.display = 'none';
    loadData();
}

document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('password-input').value;
    const errorEl = document.getElementById('auth-error');

    if (password === ADMIN_PASSWORD) {
        localStorage.setItem('dashboard_auth', 'true');
        errorEl.style.display = 'none';
        showDashboard();
    } else {
        errorEl.style.display = 'block';
    }
});

// Initial check
checkAuth();
