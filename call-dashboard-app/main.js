const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const CALL_LOGS_TABLE = 'm013en5u2cyu30j';
const CONFIRMED_TABLE = 'mtoilizta888pej';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';

let currentCalls = [];
let allCalls = [];
let callsChart = null;
let dateFilter = null;
let currentCallsPage = [];
let confirmedDataMap = {}; // vapi_call_id -> { name, phone, email }
let isEnriching = false; // Guard against multiple enrichment runs

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
    if (e.includes('success') || e.includes('completed') || e.includes('confirmada') || e.includes('ok')) return 'success';
    if (e.includes('fail') || e.includes('error') || e.includes('no contesta') || e.includes('rechazada')) return 'fail';
    if (e.includes('sin datos') || e.includes('incompleta')) return 'warning';
    return 'pending';
}

function formatDuration(seconds) {
    if (!seconds) return '-';
    const s = parseInt(seconds);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Unified helper to detect if a call is confirmed
function isConfirmed(call) {
    const callId = call.vapi_call_id || (typeof call.id === 'string' ? call.id : '');
    return call['Data Confirmada'] === true || call['Data Confirmada'] === 1 || call['Data Confirmada'] === '1'
        || call.is_confirmed === true || call.is_confirmed === 1 || call.is_confirmed === '1'
        || (callId && confirmedDataMap[callId]);
}

// Sanitize AI-generated contact data
function sanitizeEmail(email) {
    if (!email || email === '-') return '-';
    // Convert spoken Spanish format to real email
    let e = email.toLowerCase().trim();
    e = e.replace(/\s*arroba\s*/gi, '@');
    e = e.replace(/\s*punto\s*/gi, '.');
    e = e.replace(/\s+/g, ''); // remove remaining spaces
    return e;
}

function sanitizePhone(phone, fallbackPhone) {
    if (!phone || phone === '-') return fallbackPhone || '-';
    // If it contains too many letters, it's not a real phone number — use fallback
    const letterCount = (phone.match(/[a-záéíóúñ]/gi) || []).length;
    if (letterCount > 3) return fallbackPhone || '-';
    return phone.replace(/[^\d+\s()-]/g, '').trim() || fallbackPhone || '-';
}

function sanitizeName(name) {
    if (!name || name === '-') return '-';
    // Capitalize each word
    return name.replace(/\b\w/g, c => c.toUpperCase());
}

// Pre-fetch all confirmed data into a map keyed by vapi_call_id
async function fetchConfirmedData() {
    try {
        const res = await fetch(`${API_BASE}/${CONFIRMED_TABLE}/records?limit=200`, {
            headers: { 'xc-token': XC_TOKEN }
        });
        const data = await res.json();
        confirmedDataMap = {};
        (data.list || []).forEach(row => {
            const callId = row['Vapi Call ID'] || row.vapi_call_id || '';
            if (callId) {
                // Store raw phone for later cross-referencing with call log
                confirmedDataMap[callId] = {
                    name: sanitizeName(row['Nombre Confirmado'] || row.name || '-'),
                    rawPhone: row['Teléfono Confirmado'] || row.phone || '-',
                    email: sanitizeEmail(row['Email Confirmado'] || row.email || '-')
                };
            }
        });
    } catch (err) {
        console.error('Error fetching confirmed data:', err);
    }
}

// Enrich calls with missing data from Vapi API
async function enrichCallsFromVapi(calls) {
    const callsToEnrich = calls.filter(c =>
        c.vapi_call_id && c.vapi_call_id.startsWith('019') && !c.duration_seconds
    ).slice(0, 15); // Limit to 15 most recent

    if (callsToEnrich.length === 0) return false;

    let updated = false;
    const enrichPromises = callsToEnrich.map(async (call) => {
        try {
            const res = await fetch(`https://api.vapi.ai/call/${call.vapi_call_id}`, {
                headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
            });
            if (!res.ok) return;
            const vapiData = await res.json();

            if (vapiData.status !== 'ended') return; // Call still in progress

            // Calculate duration from messages or timestamps
            let duration = null;
            const msgs = vapiData.artifact?.messages || [];
            if (msgs.length > 0) {
                duration = Math.round(msgs[msgs.length - 1].secondsFromStart || 0);
            } else if (vapiData.startedAt && vapiData.endedAt) {
                duration = Math.round((new Date(vapiData.endedAt) - new Date(vapiData.startedAt)) / 1000);
            }

            // Determine evaluation
            const isConf = confirmedDataMap[call.vapi_call_id];
            let evaluation = 'Sin datos';
            if (isConf) {
                evaluation = 'Confirmada ✓';
            } else if (vapiData.endedReason === 'voicemail') {
                evaluation = 'Buzón';
            } else if (duration && duration < 10) {
                evaluation = 'No contesta';
            } else if (vapiData.endedReason === 'customer-ended-call' && duration > 30) {
                evaluation = 'Completada';
            } else if (vapiData.endedReason === 'assistant-error') {
                evaluation = 'Error';
            }

            const endedReason = vapiData.endedReason || call.ended_reason;

            // Update local data
            call.duration_seconds = duration;
            call.evaluation = evaluation;
            call.ended_reason = endedReason;
            call.transcript = vapiData.artifact?.transcript || call.transcript;
            call.recording_url = vapiData.artifact?.recordingUrl || call.recording_url;

            // Update NocoDB in background
            const updateData = {
                id: call.id || call.Id,
                duration_seconds: duration,
                evaluation: evaluation,
                ended_reason: endedReason
            };
            if (vapiData.artifact?.transcript) {
                updateData.transcript = vapiData.artifact.transcript.substring(0, 5000);
            }
            if (vapiData.artifact?.recordingUrl) {
                updateData.recording_url = vapiData.artifact.recordingUrl;
            }

            fetch(`${API_BASE}/${CALL_LOGS_TABLE}/records`, {
                method: 'PATCH',
                headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify([updateData])
            }).catch(err => console.warn('Failed to update call log:', err));

            updated = true;
        } catch (err) {
            console.warn('Error enriching call', call.vapi_call_id, err);
        }
    });

    await Promise.all(enrichPromises);
    return updated;
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

    const vapiId = call.vapi_call_id || call.lead_id || call.id || call.Id;

    document.getElementById('modal-title').textContent = call.lead_name || 'Llamada';
    document.getElementById('modal-subtitle').textContent = `${call.phone_called} • ${formatDate(call.call_time || call.CreatedAt)}`;

    // Set loading state for Vapi data
    const transcriptEl = document.getElementById('modal-transcript');
    const audioSec = document.getElementById('recording-section');
    const audio = document.getElementById('modal-audio');

    transcriptEl.innerHTML = '<span class="loading-pulse">⌛ Obteniendo transcripción en tiempo real desde Vapi...</span>';
    audioSec.style.display = 'none';

    document.getElementById('modal-notes').value = call.Notes || '';
    document.getElementById('save-notes-btn').setAttribute('data-id', call.id || call.Id);

    // Initial Hide Confirmed Section
    const confirmedSec = document.getElementById('confirmed-section');
    if (confirmedSec) confirmedSec.style.display = 'none';

    // Show Modal early so user sees loading state
    document.getElementById('detail-modal').style.display = 'flex';

    // 1. Fetch Real-time data from Vapi
    if (vapiId && vapiId.startsWith('019')) { // Vapi IDs usually start with 019
        try {
            const vapiRes = await fetch(`https://api.vapi.ai/call/${vapiId}`, {
                headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
            });

            if (vapiRes.ok) {
                const vapiData = await vapiRes.json();
                transcriptEl.textContent = vapiData.transcript || 'No hay transcripción disponible en Vapi.';

                if (vapiData.recordingUrl) {
                    audioSec.style.display = 'block';
                    audio.src = vapiData.recordingUrl;
                }
            } else {
                console.warn('Vapi API error:', vapiRes.status);
                transcriptEl.textContent = call.transcript || 'No hay transcripción disponible (error API Vapi).';
            }
        } catch (err) {
            console.error('Error fetching Vapi detail:', err);
            transcriptEl.textContent = call.transcript || 'No hay transcripción disponible (error de conexión).';
        }
    } else {
        // Fallback to local data if no valid Vapi ID
        transcriptEl.textContent = call.transcript || 'No hay transcripción disponible.';
        if (call.recording_url) {
            audioSec.style.display = 'block';
            audio.src = call.recording_url;
        }
    }

    // 2. Show Confirmed Data if applicable (use pre-fetched map first, fallback to API)
    if (isConfirmed(call)) {
        const confData = confirmedDataMap[call.vapi_call_id];
        if (confData && confirmedSec) {
            confirmedSec.style.display = 'block';
            document.getElementById('conf-name').textContent = confData.name;
            document.getElementById('conf-phone').textContent = sanitizePhone(confData.rawPhone, call.phone_called);
            document.getElementById('conf-email').textContent = confData.email;
        } else {
            // Fallback: fetch from API if not in map
            try {
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
    }

    const errorSec = document.getElementById('error-section');
    const errorDetail = document.getElementById('modal-error-detail');
    if (call.ended_reason && (call.ended_reason.includes('Error') || call.ended_reason.includes('fail'))) {
        errorSec.style.display = 'block';
        errorDetail.textContent = call.ended_reason;
    } else {
        errorSec.style.display = 'none';
    }
}

function closeModal() {
    document.getElementById('detail-modal').style.display = 'none';
    document.getElementById('modal-audio').pause();
}

async function loadData() {
    try {
        // Pre-fetch confirmed data in parallel with call logs
        const [calls] = await Promise.all([
            fetchData(CALL_LOGS_TABLE),
            fetchConfirmedData()
        ]);

        // Auto-evaluate confirmed calls that have no evaluation yet
        calls.forEach(call => {
            if (!call.evaluation && confirmedDataMap[call.vapi_call_id]) {
                call.evaluation = 'Confirmada ✓';
            }
        });

        allCalls = calls;
        currentCalls = calls;

        // Enrich calls with missing data from Vapi (runs in background after render)
        if (!isEnriching) {
            setTimeout(async () => {
                isEnriching = true;
                try {
                    const wasUpdated = await enrichCallsFromVapi(calls);
                    if (wasUpdated) {
                        loadData(); // Re-render with enriched data
                    }
                } finally {
                    isEnriching = false;
                }
            }, 100);
        }

        const showConfirmedOnly = document.getElementById('filter-confirmed').checked;
        const statusFilter = document.getElementById('filter-status').value;
        const companyFilter = document.getElementById('filter-company').value.toLowerCase();
        const dateRange = document.getElementById('date-range').value;

        let filteredCalls = calls;

        // Apply Company Filter
        if (companyFilter) {
            filteredCalls = filteredCalls.filter(c =>
                (c.lead_name || '').toLowerCase().includes(companyFilter)
            );
        }

        // Apply Status Filter (Success/Fail)
        if (statusFilter === 'success') {
            filteredCalls = filteredCalls.filter(c => getBadgeClass(c.evaluation) === 'success');
        } else if (statusFilter === 'fail') {
            filteredCalls = filteredCalls.filter(c => getBadgeClass(c.evaluation) === 'fail');
        }

        // Apply Confirmed Filter
        if (showConfirmedOnly) {
            filteredCalls = filteredCalls.filter(c => isConfirmed(c));
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
        const confirmedCalls = calls.filter(c => isConfirmed(c)).length;
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
            tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No hay llamadas registradas que coincidan con el filtro</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        filteredCalls.forEach((call, index) => {
            const tr = document.createElement('tr');
            const vapiId = call.vapi_call_id || call.lead_id || call.id || call.Id || '-';
            const shortId = vapiId.length > 20 ? vapiId.substring(0, 8) + '...' : vapiId;

            const confirmed = isConfirmed(call);
            if (confirmed) tr.classList.add('confirmed-row');

            // Get confirmed data from pre-fetched map
            const confData = confirmedDataMap[call.vapi_call_id];
            let confirmedCell = '❌';
            if (confirmed && confData) {
                const resolvedPhone = sanitizePhone(confData.rawPhone, call.phone_called);
                confirmedCell = `
                    <div class="confirmed-inline">
                        <span class="confirmed-badge">✅ Confirmado</span>
                        <div class="confirmed-details">
                            <div class="confirmed-detail-item"><span class="confirmed-label">👤</span> ${confData.name}</div>
                            <div class="confirmed-detail-item"><span class="confirmed-label">📧</span> ${confData.email}</div>
                            <div class="confirmed-detail-item"><span class="confirmed-label">📞</span> ${resolvedPhone}</div>
                        </div>
                    </div>`;
            } else if (confirmed) {
                confirmedCell = '<span class="confirmed-badge">✅ Confirmado</span>';
            }

            tr.innerHTML = `
                <td data-label="Call ID"><code style="font-family: monospace; color: var(--accent); font-size: 11px;" title="${vapiId}">${shortId}</code></td>
                <td data-label="Empresa"><strong>${call.lead_name || '-'}</strong></td>
                <td data-label="Teléfono" class="phone">${call.phone_called || '-'}</td>
                <td data-label="Fecha">${formatDate(call.call_time || call.CreatedAt)}</td>
                <td data-label="Resultado">${call.ended_reason || '-'}</td>
                <td data-label="Evaluación"><span class="badge ${getBadgeClass(call.evaluation)}">${call.evaluation || 'Pendiente'}</span></td>
                <td data-label="Duración">${formatDuration(call.duration_seconds)}</td>
                <td data-label="Notas" class="table-notes">${call.Notes ? `<span class="note-indicator" data-index="${index}" title="${call.Notes}" style="cursor: pointer;">📝</span>` : '-'}</td>
                <td data-label="Confirmado">${confirmedCell}</td>
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
        document.getElementById('call-table').innerHTML = '<tr><td colspan="11" class="empty-state">Error al cargar datos</td></tr>';
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
            body: JSON.stringify([{ id: id, Notes: notes }])
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
document.getElementById('filter-status').addEventListener('change', loadData);
document.getElementById('filter-company').addEventListener('input', loadData);
document.getElementById('close-modal').addEventListener('click', closeModal);
document.getElementById('save-notes-btn').addEventListener('click', saveNotes);

document.getElementById('call-table').addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('action-btn') || target.classList.contains('note-indicator')) {
        const index = parseInt(target.getAttribute('data-index'));
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
