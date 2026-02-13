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
let activeDetailCall = null; // Global state for the currently active call in the detail view
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
    if (e.includes('contestador') || e.includes('voicemail') || e.includes('buzón')) return 'voicemail';
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

// ── Call Quality Score System ──
function calculateCallScore(call) {
    const breakdown = { duration: 0, evaluation: 0, confirmed: 0, endReason: 0, transcript: 0 };

    // 1. Duration (max 25)
    const dur = parseInt(call.duration_seconds) || 0;
    if (dur >= 60) breakdown.duration = 25;
    else if (dur >= 30) breakdown.duration = 18;
    else if (dur >= 15) breakdown.duration = 10;
    else if (dur >= 10) breakdown.duration = 5;
    else breakdown.duration = 0;

    // 2. Evaluation (max 30)
    const evalText = (call.evaluation || '').toLowerCase();
    if (evalText.includes('confirmada')) breakdown.evaluation = 30;
    else if (evalText.includes('completada')) breakdown.evaluation = 22;
    else if (evalText.includes('sin datos') || evalText.includes('incompleta')) breakdown.evaluation = 10;
    else if (evalText.includes('buzón') || evalText.includes('no contesta')) breakdown.evaluation = 5;
    else if (evalText.includes('error') || evalText.includes('rechazada')) breakdown.evaluation = 0;
    else breakdown.evaluation = 8; // Pendiente

    // 3. Confirmed data (max 20)
    const callId = call.vapi_call_id || '';
    const confData = confirmedDataMap[callId];
    if (confData) {
        let confPoints = 0;
        if (confData.name && confData.name !== '-') confPoints += 7;
        if (confData.email && confData.email !== '-') confPoints += 7;
        if (confData.rawPhone && confData.rawPhone !== '-') confPoints += 6;
        breakdown.confirmed = confPoints;
    }

    // 4. End reason (max 15)
    const reason = (call.ended_reason || '').toLowerCase();
    if (reason.includes('customer-ended') || reason.includes('customer_ended')) breakdown.endReason = 15;
    else if (reason.includes('assistant-ended') || reason.includes('assistant_ended')) breakdown.endReason = 12;
    else if (reason.includes('manual') || reason === '') breakdown.endReason = 8;
    else if (reason.includes('voicemail') || reason.includes('buzón')) breakdown.endReason = 5;
    else if (reason.includes('error') || reason.includes('fail')) breakdown.endReason = 0;
    else breakdown.endReason = 7;

    // 5. Transcript (max 10)
    const transcript = call.transcript || '';
    if (transcript.length > 200) breakdown.transcript = 10;
    else if (transcript.length > 50) breakdown.transcript = 5;
    else breakdown.transcript = 0;

    const total = breakdown.duration + breakdown.evaluation + breakdown.confirmed + breakdown.endReason + breakdown.transcript;
    return { total, breakdown };
}

function getScoreLabel(score) {
    if (score >= 80) return { emoji: '🟢', text: 'Excelente', cls: 'score-excellent' };
    if (score >= 60) return { emoji: '🔵', text: 'Buena', cls: 'score-good' };
    if (score >= 40) return { emoji: '🟡', text: 'Regular', cls: 'score-regular' };
    if (score >= 20) return { emoji: '🟠', text: 'Deficiente', cls: 'score-poor' };
    return { emoji: '🔴', text: 'Muy mala', cls: 'score-bad' };
}

function getScoreColor(score) {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#3b82f6';
    if (score >= 40) return '#f59e0b';
    if (score >= 20) return '#f97316';
    return '#ef4444';
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
    ).slice(0, 5); // Limit to 5 most recent to avoid rate limits

    if (callsToEnrich.length === 0) return false;

    let updated = false;
    for (const call of callsToEnrich) {
        try {
            // Use local proxy to avoid CORS
            const res = await fetch(`/vapi-api/call/${call.vapi_call_id}`, {
                headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
            });
            if (!res.ok) {
                if (res.status === 429) break; // Stop if rate limited
                continue;
            }
            const vapiData = await res.json();

            if (vapiData.status !== 'ended') continue; // Call still in progress

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
            } else if (vapiData.endedReason === 'voicemail' || vapiData.endedReason === 'machine_detected' || (vapiData.analysis?.successEvaluation || '').toLowerCase().includes('contestador')) {
                evaluation = 'Contestador';
            } else if (duration && duration < 10) {
                evaluation = 'No contesta';
            } else if (vapiData.endedReason === 'customer-ended-call' && duration > 30) {
                evaluation = 'Completada';
            } else if (vapiData.endedReason === 'assistant-error') {
                evaluation = 'Error';
            }

            // Preserve 'Manual Trigger' for test calls so they stay in the Test section
            const isTestCall = (call.ended_reason || '').includes('Manual Trigger');
            const endedReason = isTestCall ? 'Manual Trigger' : (vapiData.endedReason || call.ended_reason);

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

            // Wait 500ms between calls to avoid 429
            await new Promise(r => setTimeout(r, 500));
        } catch (err) {
            console.warn('Error enriching call', call.vapi_call_id, err);
        }
    }
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
    activeDetailCall = call;

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

    // ── Render Score Gauge ──
    const scoreSec = document.getElementById('score-section');
    if (scoreSec) {
        const scoreResult = call._scoreBreakdown ? { total: call._score, breakdown: call._scoreBreakdown } : calculateCallScore(call);
        const label = getScoreLabel(scoreResult.total);
        const color = getScoreColor(scoreResult.total);
        const bd = scoreResult.breakdown;
        const dims = [
            { name: 'Duración', val: bd.duration, max: 25, icon: '⏱️' },
            { name: 'Evaluación', val: bd.evaluation, max: 30, icon: '📊' },
            { name: 'Datos Confirmados', val: bd.confirmed, max: 20, icon: '✅' },
            { name: 'Motivo Fin', val: bd.endReason, max: 15, icon: '🔚' },
            { name: 'Transcripción', val: bd.transcript, max: 10, icon: '📝' }
        ];
        scoreSec.style.display = 'block';
        scoreSec.innerHTML = `
            <div class="section-title">🏆 Score de Calidad</div>
            <div class="score-gauge-container">
                <div class="score-gauge-ring" style="--score-pct: ${scoreResult.total}%; --score-clr: ${color}">
                    <div class="score-gauge-inner">
                        <span class="score-gauge-value" style="color: ${color}">${scoreResult.total}</span>
                        <span class="score-gauge-label">${label.emoji} ${label.text}</span>
                    </div>
                </div>
                <div class="score-breakdown">
                    ${dims.map(d => `
                        <div class="score-dim">
                            <div class="score-dim-header">
                                <span>${d.icon} ${d.name}</span>
                                <span class="score-dim-val">${d.val}/${d.max}</span>
                            </div>
                            <div class="score-dim-bar">
                                <div class="score-dim-fill" style="width: ${(d.val / d.max) * 100}%; background: ${getScoreColor((d.val / d.max) * 100)}"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

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

                // Show extraction tools if transcript exists
                if (vapiData.transcript) {
                    document.getElementById('extraction-tools').style.display = 'block';
                    document.getElementById('extraction-results').style.display = 'none';
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
                const query = `(vapi_call_id,eq,${encodeURIComponent(call.vapi_call_id)})`;
                const res = await fetch(`${API_BASE}/${CONFIRMED_TABLE}/records?where=${query}`, {
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

// --- Planning / Scheduled Calls Section ---
async function fetchScheduledLeads() {
    try {
        const LEADS_TABLE = 'mgot1kl4sglenym'; // From bulk_call_manager.json
        // Fetch leads that have a planned date (removed API sort due to potential 422)
        const res = await fetch(`${API_BASE}/${LEADS_TABLE}/records?limit=100`, {
            headers: { 'xc-token': XC_TOKEN }
        });
        const data = await res.json();
        const leads = (data.list || []).filter(lead => lead.fecha_planificada);

        const plannedGrid = document.getElementById('planned-grid');
        const plannedSection = document.getElementById('planned-section');

        if (leads.length === 0) {
            plannedSection.style.display = 'none';
            return;
        }

        plannedSection.style.display = 'block';
        plannedGrid.innerHTML = '';

        const now = new Date();
        const sortedLeads = leads.sort((a, b) => utcStringToLocalDate(a.fecha_planificada) - utcStringToLocalDate(b.fecha_planificada));

        // Find the next call (first one with plannedDate > now)
        const nextCall = sortedLeads.find(l => utcStringToLocalDate(l.fecha_planificada) > now);

        sortedLeads.forEach(lead => {
            const plannedDate = utcStringToLocalDate(lead.fecha_planificada);
            const isDue = plannedDate <= now;
            const timeStr = plannedDate.toLocaleString('es-ES', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });
            const isNext = nextCall && (lead.Id === nextCall.Id || lead.id === nextCall.id);

            const card = document.createElement('div');
            card.className = `planned-card ${isDue ? 'due' : ''} ${isNext ? 'is-next' : ''}`;
            card.style.cursor = 'pointer';
            card.title = 'Click para editar este lead';
            card.innerHTML = `
                ${isNext ? '<div class="next-call-badge">Próxima Llamada</div>' : ''}
                <div class="planned-card-header">
                    <div class="planned-card-time">${isDue ? '⚡ PRIORITARIO' : '📅 ' + timeStr}</div>
                </div>
                <div class="planned-card-name">${lead.name || 'Empresa sin nombre'}</div>
                <div class="planned-card-details">
                    <div class="planned-card-item"><span>📞</span> ${lead.phone || '-'}</div>
                    <div class="planned-card-item"><span>📧</span> ${lead.email || '-'}</div>
                    <div class="planned-card-item"><span>📍</span> ${lead.address || '-'}</div>
                </div>
                <div class="planned-card-timer" data-scheduled="${lead.fecha_planificada}">
                    <span>--:--:--</span>
                </div>
            `;

            // Click to edit this lead
            card.addEventListener('click', () => {
                const leadId = lead.Id || lead.id || lead.unique_id;
                console.log('Card clicked, lead:', leadId, lead);

                const modal = document.getElementById('lead-modal');
                const form = document.getElementById('lead-form');
                const title = document.getElementById('lead-modal-title');

                form.reset();
                title.innerText = 'Editar Lead';
                document.getElementById('edit-lead-id').value = leadId || '';
                document.getElementById('edit-lead-name').value = lead.name || '';
                document.getElementById('edit-lead-phone').value = lead.phone || '';
                document.getElementById('edit-lead-email').value = lead.email || '';
                document.getElementById('edit-lead-sector').value = lead.sector || '';
                document.getElementById('edit-lead-status').value = lead.status || 'Nuevo';
                document.getElementById('edit-lead-summary').value = lead.summary || '';
                document.getElementById('edit-lead-address').value = lead.address || '';

                if (lead.fecha_planificada) {
                    document.getElementById('edit-lead-planned').value = utcToLocalDatetime(lead.fecha_planificada);
                } else {
                    document.getElementById('edit-lead-planned').value = '';
                }

                modal.classList.add('active');
            });

            plannedGrid.appendChild(card);
        });
    } catch (err) {
        console.error('Error fetching scheduled leads:', err);
    }
}

// --- Tab Navigation ---
function initTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    const views = document.querySelectorAll('.view-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');

            // Update tabs
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update views
            views.forEach(v => {
                v.classList.remove('active');
                if (v.id === `view-${target}`) {
                    v.classList.add('active');
                }
            });

            // If switching to leads, load them
            if (target === 'leads') {
                loadLeadsManager();
            }
            // If switching to scheduler, initialize defaults
            if (target === 'scheduler') {
                initSchedulerDefaults();
            }
        });
    });
}

// ── Bulk Scheduler Logic ──
const LEADS_TABLE = 'mgot1kl4sglenym';
let schedulerLeads = []; // leads fetched for preview

function initSchedulerDefaults() {
    const startInput = document.getElementById('sched-start');
    if (!startInput.value) {
        // Default: next round 5-min mark, +5 minutes from now
        const now = new Date();
        now.setMinutes(now.getMinutes() + 5);
        now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
        const y = now.getFullYear();
        const mo = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        startInput.value = `${y}-${mo}-${d}T${h}:${mi}`;
    }
}

async function fetchEligibleLeads(count, source) {
    // Fetch all leads, then filter client-side for eligible ones
    let allRecords = [];
    let offset = 0;
    const batchSize = 200;

    // Check if we should skip already-called leads
    const skipCalled = document.getElementById('sched-skip-called')?.checked ?? true;

    // Determine sort order for the API
    const sortField = 'CreatedAt';
    const sortDir = source === 'oldest' ? 'asc' : 'desc';

    while (true) {
        const url = `${API_BASE}/${LEADS_TABLE}/records?limit=${batchSize}&offset=${offset}&sort=-${sortField}`;
        const res = await fetch(url, {
            headers: { 'xc-token': XC_TOKEN }
        });
        const data = await res.json();
        const records = data.list || [];
        allRecords = allRecords.concat(records);

        if (records.length < batchSize || data.pageInfo?.isLastPage !== false) break;
        offset += batchSize;
        // Safety limit
        if (allRecords.length >= 2000) break;
    }

    // Sort
    if (source === 'oldest') {
        allRecords.sort((a, b) => new Date(a.CreatedAt) - new Date(b.CreatedAt));
    } else {
        allRecords.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
    }

    // Statuses that indicate the lead has already been called
    const calledStatuses = ['completado', 'contestador', 'voicemail', 'no contesta', 'fallido', 'interesado', 'reintentar'];

    // Filter: eligible leads
    const eligible = allRecords.filter(lead => {
        const phone = String(lead.phone || '').trim();
        // Must have a valid phone
        if (!phone || phone === '0' || phone === 'null' || phone.length < 6) return false;
        // Must not already be scheduled or in process
        const status = (lead.status || '').toLowerCase();
        if (status === 'programado' || status === 'en proceso' || status === 'llamando...') return false;
        // Must not have a pending fecha_planificada
        if (lead.fecha_planificada) return false;
        // If "skip called" is enabled, exclude leads with any call-related status
        if (skipCalled && status && calledStatuses.some(s => status.includes(s))) return false;
        return true;
    });

    console.log(`[Scheduler] skipCalled=${skipCalled}, total=${allRecords.length}, eligible=${eligible.length}`);
    return eligible.slice(0, count);
}

function renderSchedulePreview(leads, startTime, spacingMinutes) {
    const summaryEl = document.getElementById('sched-summary');
    const statsEl = document.getElementById('sched-summary-stats');
    const timelineEl = document.getElementById('sched-timeline');
    const executeBtn = document.getElementById('sched-execute-btn');

    if (leads.length === 0) {
        summaryEl.style.display = 'block';
        statsEl.innerHTML = '';
        timelineEl.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">⚠️ No se encontraron leads elegibles con los criterios seleccionados</div>';
        executeBtn.disabled = true;
        return;
    }

    const totalDuration = (leads.length - 1) * spacingMinutes;
    const endTime = new Date(startTime.getTime() + totalDuration * 60000);

    const hours = Math.floor(totalDuration / 60);
    const mins = totalDuration % 60;
    const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    statsEl.innerHTML = `
        <div class="sched-stat accent">📊 ${leads.length} leads</div>
        <div class="sched-stat warning">⏱️ ${durationStr} total</div>
        <div class="sched-stat success">🏁 Fin: ${endTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
    `;

    let html = '';
    leads.forEach((lead, i) => {
        const callTime = new Date(startTime.getTime() + i * spacingMinutes * 60000);
        const timeStr = callTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const dateStr = callTime.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

        html += `
            <div class="timeline-item" id="sched-item-${i}">
                <div class="timeline-index">${i + 1}</div>
                <div class="timeline-info">
                    <div class="timeline-name">${lead.name || 'Sin nombre'}</div>
                    <div class="timeline-phone">📞 ${lead.phone}</div>
                </div>
                <div class="timeline-time">
                    ${timeStr}
                    <small>${dateStr}</small>
                </div>
            </div>
        `;
    });

    timelineEl.innerHTML = html;
    summaryEl.style.display = 'block';
    executeBtn.disabled = false;
}

async function executeScheduling(leads, startTime, spacingMinutes, assistantId) {
    const progressEl = document.getElementById('sched-progress');
    const progressBar = document.getElementById('sched-progress-bar');
    const progressText = document.getElementById('sched-progress-text');
    const progressLog = document.getElementById('sched-progress-log');
    const executeBtn = document.getElementById('sched-execute-btn');
    const previewBtn = document.getElementById('sched-preview-btn');

    progressEl.style.display = 'block';
    executeBtn.disabled = true;
    previewBtn.disabled = true;
    progressLog.innerHTML = '';

    let success = 0;
    let errors = 0;

    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        const leadId = lead.Id || lead.id;
        const callTime = new Date(startTime.getTime() + i * spacingMinutes * 60000);
        const utcTime = localDatetimeToUTC(callTime.getFullYear() + '-' +
            String(callTime.getMonth() + 1).padStart(2, '0') + '-' +
            String(callTime.getDate()).padStart(2, '0') + 'T' +
            String(callTime.getHours()).padStart(2, '0') + ':' +
            String(callTime.getMinutes()).padStart(2, '0'));

        console.log(`[Scheduler] Scheduling lead ${i + 1}/${leads.length}: Id=${leadId}, time=${utcTime}`);

        if (!leadId) {
            errors++;
            progressLog.innerHTML += `<div style="color: var(--danger);">✗ ${lead.name || lead.phone}: Sin ID válido para actualizar</div>`;
            continue;
        }

        try {
            const patchData = {
                Id: leadId,
                status: 'Programado',
                fecha_planificada: utcTime
            };
            if (assistantId) patchData.assistant_id = assistantId;

            const res = await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                method: 'PATCH',
                headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify([patchData])
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            success++;
            const timelineItem = document.getElementById(`sched-item-${i}`);
            if (timelineItem) {
                timelineItem.classList.add('done');
                timelineItem.querySelector('.timeline-index').textContent = '✓';
            }
            progressLog.innerHTML += `<div style="color: var(--success);">✓ ${lead.name || lead.phone} → ${callTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>`;
        } catch (err) {
            errors++;
            const timelineItem = document.getElementById(`sched-item-${i}`);
            if (timelineItem) timelineItem.classList.add('error-item');
            progressLog.innerHTML += `<div style="color: var(--danger);">✗ ${lead.name || lead.phone}: ${err.message}</div>`;
        }

        // Update progress
        const pct = Math.round(((i + 1) / leads.length) * 100);
        progressBar.style.width = `${pct}%`;
        progressText.textContent = `${i + 1} / ${leads.length} — ${success} ✓ ${errors > 0 ? errors + ' ✗' : ''}`;

        // Scroll log to bottom
        progressLog.scrollTop = progressLog.scrollHeight;
    }

    // Final status
    progressText.innerHTML = `<span style="color: var(--success); font-weight: 600;">✅ Completado: ${success} programados</span>${errors > 0 ? ` <span style="color: var(--danger);">(${errors} errores)</span>` : ''}`;
    executeBtn.disabled = false;
    previewBtn.disabled = false;
    executeBtn.textContent = '✅ Hecho — Programar más';
}

// Event Listeners for Scheduler
document.getElementById('sched-preview-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sched-preview-btn');
    const count = parseInt(document.getElementById('sched-count').value) || 50;
    const source = document.getElementById('sched-source').value;
    const startStr = document.getElementById('sched-start').value;
    const spacing = parseInt(document.getElementById('sched-spacing').value) || 2;

    if (!startStr) {
        alert('Por favor, selecciona una fecha y hora de inicio');
        return;
    }

    btn.textContent = '⏳ Buscando leads...';
    btn.disabled = true;

    try {
        console.log('[Scheduler] Fetching eligible leads:', { count, source });
        schedulerLeads = await fetchEligibleLeads(count, source);
        console.log('[Scheduler] Found eligible leads:', schedulerLeads.length, schedulerLeads.map(l => ({ Id: l.Id, id: l.id, name: l.name, status: l.status })));
        const startTime = new Date(startStr);
        renderSchedulePreview(schedulerLeads, startTime, spacing);
    } catch (err) {
        console.error('[Scheduler] Error fetching leads:', err);
        alert('Error al buscar leads: ' + err.message);
    } finally {
        btn.textContent = '🔍 Ver Preview';
        btn.disabled = false;
    }
});

document.getElementById('sched-execute-btn').addEventListener('click', async () => {
    console.log('[Scheduler] Execute clicked, leads:', schedulerLeads.length);
    if (schedulerLeads.length === 0) {
        alert('No hay leads para programar. Haz click en "Ver Preview" primero.');
        return;
    }

    const startStr = document.getElementById('sched-start').value;
    const spacing = parseInt(document.getElementById('sched-spacing').value) || 2;
    const startTime = new Date(startStr);
    const assistantId = document.getElementById('sched-assistant').value;

    console.log('[Scheduler] Config:', { startStr, spacing, startTime, assistantId, leadsCount: schedulerLeads.length });

    const confirmed = confirm(`¿Programar ${schedulerLeads.length} llamadas empezando a las ${startTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}?`);
    if (!confirmed) return;

    document.getElementById('sched-execute-btn').textContent = '⏳ Programando...';
    await executeScheduling(schedulerLeads, startTime, spacing, assistantId);
});

// --- Lead Management Logic ---
let allLeads = [];

async function loadLeadsManager() {
    const tbody = document.getElementById('leads-master-table');
    tbody.innerHTML = '<tr><td colspan="7" class="loading">Cargando lista de leads...</td></tr>';

    try {
        const LEADS_TABLE = 'mgot1kl4sglenym';
        // Paginate to fetch ALL leads
        let allRecords = [];
        let offset = 0;
        const batchSize = 200;

        while (true) {
            const res = await fetch(`${API_BASE}/${LEADS_TABLE}/records?limit=${batchSize}&offset=${offset}`, {
                headers: { 'xc-token': XC_TOKEN }
            });
            const data = await res.json();
            const records = data.list || [];
            allRecords = allRecords.concat(records);
            if (records.length < batchSize || data.pageInfo?.isLastPage !== false) break;
            offset += batchSize;
            if (allRecords.length >= 5000) break; // Safety limit
        }

        allLeads = allRecords;
        renderLeadsTable(allLeads);
        updateLeadsKPIs(allLeads);
    } catch (err) {
        console.error('Error loading leads:', err);
        tbody.innerHTML = '<tr><td colspan="7" class="error">Error al cargar leads</td></tr>';
    }
}

function updateLeadsKPIs(leads) {
    const total = leads.length;
    const nuevos = leads.filter(l => {
        const s = (l.status || '').toLowerCase();
        return !s || s === 'nuevo';
    }).length;
    const programados = leads.filter(l => (l.status || '').toLowerCase() === 'programado').length;
    const completados = leads.filter(l => (l.status || '').toLowerCase() === 'completado').length;
    const interesados = leads.filter(l => (l.status || '').toLowerCase() === 'interesado').length;
    const fallidos = leads.filter(l => {
        const s = (l.status || '').toLowerCase();
        return s === 'fallido' || s === 'reintentar';
    }).length;

    // Conversion rate = (interesados + completados) / total
    const conversionRate = total > 0 ? Math.round(((interesados + completados) / total) * 100) : 0;

    // Animate KPI values
    animateKPIValue('kpi-total-leads', total);
    animateKPIValue('kpi-nuevos', nuevos);
    animateKPIValue('kpi-programados', programados);
    animateKPIValue('kpi-completados', completados);
    animateKPIValue('kpi-interesados', interesados);
    animateKPIValue('kpi-fallidos', fallidos);

    const convEl = document.getElementById('kpi-conversion');
    if (convEl) convEl.textContent = conversionRate + '%';

    // Update progress bars (percentage of total)
    setKPIBar('kpi-bar-nuevos', total > 0 ? (nuevos / total) * 100 : 0);
    setKPIBar('kpi-bar-programados', total > 0 ? (programados / total) * 100 : 0);
    setKPIBar('kpi-bar-completados', total > 0 ? (completados / total) * 100 : 0);
    setKPIBar('kpi-bar-interesados', total > 0 ? (interesados / total) * 100 : 0);
    setKPIBar('kpi-bar-fallidos', total > 0 ? (fallidos / total) * 100 : 0);
}

function animateKPIValue(id, targetValue) {
    const el = document.getElementById(id);
    if (!el) return;
    const duration = 600;
    const start = performance.now();
    const startVal = parseInt(el.textContent) || 0;
    function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        el.textContent = Math.round(startVal + (targetValue - startVal) * eased);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function setKPIBar(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    setTimeout(() => { el.style.width = Math.max(pct, 2) + '%'; }, 100);
}

// --- Automation Toggle Logic ---
async function initAutomationToggle() {
    const toggle = document.getElementById('automation-toggle');
    const CONFIG_TABLE = 'm4044lwk0p6f721';

    try {
        const query = '(Key,eq,automation_enabled)';
        const res = await fetch(`${API_BASE}/${CONFIG_TABLE}/records?where=${query}`, {
            headers: { 'xc-token': XC_TOKEN }
        });
        const data = await res.json();
        const config = data.list && data.list[0];
        if (config) {
            toggle.checked = config.Value === 'true';
            window.automationConfigId = config.Id || config.id;
        } else {
            console.warn('Automation config not found — toggle defaults to OFF');
            toggle.checked = false;
        }
    } catch (err) {
        console.error('Error fetching automation config:', err);
        toggle.checked = false;
    }

    toggle.addEventListener('change', async () => {
        try {
            await fetch(`${API_BASE}/${CONFIG_TABLE}/records`, {
                method: 'PATCH',
                headers: {
                    'xc-token': XC_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify([{
                    Id: window.automationConfigId,
                    Value: toggle.checked ? 'true' : 'false'
                }])
            });
        } catch (err) {
            console.error('Error updating automation config:', err);
        }
    });
}

// --- Bulk CSV Import ---
function initBulkImport() {
    const importBtn = document.getElementById('btn-import-csv');
    const fileInput = document.getElementById('csv-import');

    importBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const leads = results.data.map(row => {
                    // Use CSV ID if present, otherwise generate one
                    const uid = row.unique_id || ('lead_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));

                    return {
                        unique_id: uid,
                        name: row.name || row.Empresa || row.empresa || '',
                        phone: row.phone || row.Teléfono || row.telefono || '',
                        email: row.email || row.Email || '',
                        sector: row.sector || row.Sector || '',
                        summary: row.summary || '',
                        address: row.address || '',
                        website: row.website || '',
                        url: row.url || '',
                        status: 'Nuevo'
                    };
                }).filter(l => l.phone && l.phone !== '0' && l.phone !== 'N/A');

                if (leads.length === 0) return alert('No se encontraron leads válidos en el CSV (se requiere columna phone/telefono)');

                if (confirm(`¿Importar ${leads.length} leads?`)) {
                    importBtn.innerText = '⏳ Importando...';
                    importBtn.disabled = true;

                    try {
                        const LEADS_TABLE = 'mgot1kl4sglenym';
                        for (let i = 0; i < leads.length; i += 50) {
                            const batch = leads.slice(i, i + 50);
                            await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                                method: 'POST',
                                headers: {
                                    'xc-token': XC_TOKEN,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(batch)
                            });
                        }
                        alert('¡Importación completada!');
                        loadLeadsManager();
                    } catch (err) {
                        console.error('Error importing leads:', err);
                        alert('Error durante la importación');
                    } finally {
                        importBtn.innerHTML = '📂 Importar CSV';
                        importBtn.disabled = false;
                        fileInput.value = '';
                    }
                }
            }
        });
    });
}

function renderLeadsTable(leads) {
    const tbody = document.getElementById('leads-master-table');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (leads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 40px; color: var(--text-secondary);">No se encontraron leads</td></tr>';
        return;
    }

    tbody.innerHTML = leads.map(lead => {
        const leadId = lead.unique_id || lead.Id || lead.id;
        // Escape single quotes for HTML onclick attributes
        const escapedName = (lead.name || 'Sin nombre').replace(/'/g, "\\'");
        const escapedPhone = (lead.phone || '').replace(/'/g, "\\'");
        const escapedId = (leadId || '').toString().replace(/'/g, "\\'");

        return `
            <tr data-id="${escapedId}">
                <td><strong>${lead.name || 'Sin nombre'}</strong></td>
                <td><small class="text-muted">${lead.sector || '-'}</small></td>
                <td>${lead.phone || '-'}</td>
                <td>${lead.email || '-'}</td>
                <td><span class="status-badge ${getBadgeStatusClass(lead.status)}">${lead.status || 'Nuevo'}</span></td>
                <td>${lead.fecha_planificada ? utcStringToLocalDate(lead.fecha_planificada).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                <td class="actions-cell">
                    <button class="btn-detail" onclick="triggerManualCall('${escapedPhone}', '${escapedName}')" title="Llamar ahora">📞</button>
                    <button class="btn-detail" onclick="openLeadEditor('${escapedId}')" title="Editar">✏️</button>
                </td>
            </tr>
        `;
    }).join('');
}

function getBadgeStatusClass(status) {
    const s = (status || '').toLowerCase();
    if (s.includes('nuevo')) return 'badge-info';
    if (s.includes('completado')) return 'badge-success';
    if (s.includes('reintentar')) return 'badge-warning';
    if (s.includes('fallido')) return 'badge-danger';
    if (s.includes('interesado')) return 'badge-success';
    if (s.includes('contestador') || s.includes('voicemail')) return 'badge-voicemail';
    return 'badge-secondary';
}

// Global search for leads
document.getElementById('lead-search').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allLeads.filter(l =>
        (l.name || '').toLowerCase().includes(query) ||
        (l.email || '').toLowerCase().includes(query) ||
        (l.phone || '').toLowerCase().includes(query)
    );
    renderLeadsTable(filtered);
});

// --- Lead Editor Modal Control ---
function openLeadEditor(leadId = null) {
    const modal = document.getElementById('lead-modal');
    const form = document.getElementById('lead-form');
    const title = document.getElementById('lead-modal-title');

    form.reset();
    document.getElementById('edit-lead-id').value = leadId || '';

    if (leadId) {
        title.innerText = 'Editar Lead';
        const lead = allLeads.find(l => (l.unique_id || l.Id || l.id).toString() === leadId.toString());
        if (lead) {
            document.getElementById('edit-lead-name').value = lead.name || '';
            document.getElementById('edit-lead-phone').value = lead.phone || '';
            document.getElementById('edit-lead-email').value = lead.email || '';
            document.getElementById('edit-lead-sector').value = lead.sector || '';
            document.getElementById('edit-lead-status').value = lead.status || 'Nuevo';
            document.getElementById('edit-lead-summary').value = lead.summary || '';
            document.getElementById('edit-lead-address').value = lead.address || '';
            if (lead.fecha_planificada) {
                // Convert UTC NocoDB value to local datetime-local format
                document.getElementById('edit-lead-planned').value = utcToLocalDatetime(lead.fecha_planificada);
            } else {
                document.getElementById('edit-lead-planned').value = '';
            }
        }
    } else {
        title.innerText = 'Nuevo Lead';
        document.getElementById('edit-lead-status').value = 'Nuevo';
    }

    modal.classList.add('active');
}

function closeLeadModal() {
    document.getElementById('lead-modal').classList.remove('active');
}

// Attach event listeners for lead modal
document.getElementById('close-lead-modal').addEventListener('click', closeLeadModal);
document.getElementById('cancel-lead-save').addEventListener('click', closeLeadModal);
document.getElementById('btn-add-lead').addEventListener('click', () => openLeadEditor());

// Form submission for creating/updating leads
document.getElementById('lead-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = e.target.querySelector('button[type="submit"]');
    const leadId = document.getElementById('edit-lead-id').value;

    const leadData = {
        name: document.getElementById('edit-lead-name').value,
        phone: document.getElementById('edit-lead-phone').value,
        email: document.getElementById('edit-lead-email').value,
        sector: document.getElementById('edit-lead-sector').value,
        status: document.getElementById('edit-lead-status').value,
        summary: document.getElementById('edit-lead-summary').value,
        address: document.getElementById('edit-lead-address').value,
        fecha_planificada: document.getElementById('edit-lead-planned').value ? localDatetimeToUTC(document.getElementById('edit-lead-planned').value) : null
    };

    saveBtn.innerText = 'Guardando...';
    saveBtn.disabled = true;

    try {
        const LEADS_TABLE = 'mgot1kl4sglenym';
        let res;

        if (leadId) {
            // Update
            leadData.unique_id = leadId;
            res = await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                method: 'PATCH',
                headers: {
                    'xc-token': XC_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify([leadData])
            });
        } else {
            // Create - Generate a unique_id if not present (usually NocoDB handles PK, but unique_id is our custom pk)
            leadData.unique_id = 'lead_' + Date.now();
            res = await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                method: 'POST',
                headers: {
                    'xc-token': XC_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify([leadData])
            });
        }

        if (res.ok) {
            closeLeadModal();
            loadLeadsManager(); // Refresh table
            fetchScheduledLeads(); // Refresh calendar if changed
        } else {
            const err = await res.json();
            alert('Error al guardar: ' + (err.message || 'Error desconocido'));
        }
    } catch (err) {
        console.error('Error saving lead:', err);
        alert('Error de conexión al guardar el lead');
    } finally {
        saveBtn.innerText = 'Guardar Cambios';
        saveBtn.disabled = false;
    }
});

// Expose functions to global scope for button onclicks
window.openLeadEditor = openLeadEditor;
window.triggerManualCall = async function (phone, name) {
    if (!phone) return alert('No hay teléfono disponible');
    // Reuse existing logic from manual call modal
    document.getElementById('manual-phone').value = phone;
    document.getElementById('manual-company').value = name;
    document.getElementById('manual-lead-name').value = name;
    document.getElementById('manual-call-modal').classList.add('active');
};

async function loadData(skipEnrichment = false) {
    try {
        // Initialize UI components once
        if (!window.tabsInitialized) {
            initTabs();
            initBulkImport();
            initAutomationToggle();
            window.tabsInitialized = true;
        }

        // Fetch planning data in background
        fetchScheduledLeads();

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

        // Separate test/manual calls from campaign calls
        // Test calls are identified by ended_reason='Manual Trigger' OR lead_name='Test Manual'
        const isTestCall = (c) => (c.ended_reason || '').includes('Manual Trigger') || (c.lead_name || '').toLowerCase() === 'test manual';
        const testCalls = calls.filter(c => isTestCall(c));
        const campaignCalls = calls.filter(c => !isTestCall(c));

        // Calculate scores for all calls (before filters)
        calls.forEach(c => {
            const scoreResult = calculateCallScore(c);
            c._score = scoreResult.total;
            c._scoreBreakdown = scoreResult.breakdown;
        });

        // Enrich calls with missing data from Vapi (runs in background after render)
        if (!isEnriching && !skipEnrichment) {
            setTimeout(async () => {
                isEnriching = true;
                try {
                    const wasUpdated = await enrichCallsFromVapi(calls);
                    if (wasUpdated) {
                        loadData(true); // Re-render with enriched data, but skip further enrichment cycles
                    }
                } finally {
                    isEnriching = false;
                }
            }, 100);
        }

        const showConfirmedOnly = document.getElementById('filter-confirmed').checked;
        const statusFilter = document.getElementById('filter-status').value;
        const companyFilter = document.getElementById('filter-company').value.toLowerCase();
        const scoreFilter = document.getElementById('filter-score').value;
        const dateRange = document.getElementById('date-range').value;

        let filteredCalls = campaignCalls;

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
        // Apply Score Filter
        if (scoreFilter !== 'all') {
            const [minS, maxS] = scoreFilter.split('-').map(Number);
            filteredCalls = filteredCalls.filter(c => (c._score || 0) >= minS && (c._score || 0) <= maxS);
        }

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


        const totalCalls = campaignCalls.length;
        const confirmedCalls = campaignCalls.filter(c => isConfirmed(c)).length;
        const confirmationRate = totalCalls > 0 ? Math.round((confirmedCalls / totalCalls) * 100) : 0;

        const successCalls = campaignCalls.filter(c => getBadgeClass(c.evaluation) === 'success').length;
        const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
        const totalDuration = campaignCalls.reduce((sum, c) => sum + (parseInt(c.duration_seconds) || 0), 0);
        const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
        const avgScore = totalCalls > 0 ? Math.round(campaignCalls.reduce((sum, c) => sum + (c._score || 0), 0) / totalCalls) : 0;

        document.getElementById('total-calls').textContent = totalCalls;
        document.getElementById('success-rate').textContent = successRate + '%';
        document.getElementById('avg-duration').textContent = formatDuration(avgDuration);
        document.getElementById('avg-score').textContent = avgScore;
        const avgScoreLabel = getScoreLabel(avgScore);
        document.getElementById('avg-score').style.color = getScoreColor(avgScore);
        document.getElementById('avg-score-label').textContent = avgScoreLabel.emoji + ' ' + avgScoreLabel.text;

        // New KPIs
        document.getElementById('confirmed-count').textContent = confirmedCalls;
        document.getElementById('confirmation-rate').textContent = confirmationRate + '%';

        const tbody = document.getElementById('call-table');
        if (filteredCalls.length === 0) {
            tbody.innerHTML = '<tr><td colspan="12" class="empty-state">No hay llamadas registradas que coincidan con el filtro</td></tr>';
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

            const scoreVal = call._score || 0;
            const scoreLbl = getScoreLabel(scoreVal);
            const scoreClr = getScoreColor(scoreVal);

            tr.innerHTML = `
                <td data-label="Call ID"><code style="font-family: monospace; color: var(--accent); font-size: 11px;" title="${vapiId}">${shortId}</code></td>
                <td data-label="Empresa"><strong>${call.lead_name || '-'}</strong></td>
                <td data-label="Teléfono" class="phone">${call.phone_called || '-'}</td>
                <td data-label="Fecha">${formatDate(call.call_time || call.CreatedAt)}</td>
                <td data-label="Resultado">${call.ended_reason || '-'}</td>
                <td data-label="Evaluación"><span class="badge ${getBadgeClass(call.evaluation)}">${call.evaluation || 'Pendiente'}</span></td>
                <td data-label="Duración">${formatDuration(call.duration_seconds)}</td>
                <td data-label="Score"><span class="score-badge ${scoreLbl.cls}" style="--score-color: ${scoreClr}">${scoreLbl.emoji} ${scoreVal}</span></td>
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

        // Render test calls section
        renderTestCalls(testCalls);
    } catch (err) {
        console.error('Error:', err);
        document.getElementById('call-table').innerHTML = '<tr><td colspan="12" class="empty-state">Error al cargar datos</td></tr>';
    }
}

// --- Test / Manual Calls Rendering ---
function renderTestCalls(testCalls) {
    const tbody = document.getElementById('test-call-table');
    if (!tbody) return;

    // Update test KPIs
    const total = testCalls.length;
    const success = testCalls.filter(c => getBadgeClass(c.evaluation) === 'success').length;
    const failed = testCalls.filter(c => getBadgeClass(c.evaluation) === 'fail').length;
    const voicemail = testCalls.filter(c => getBadgeClass(c.evaluation) === 'voicemail').length;

    document.getElementById('test-total').textContent = total;
    document.getElementById('test-success').textContent = success;
    document.getElementById('test-failed').textContent = failed;
    document.getElementById('test-voicemail').textContent = voicemail;

    if (total === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No hay llamadas de test registradas. Las llamadas manuales aparecerán aquí.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    testCalls.forEach((call, idx) => {
        const tr = document.createElement('tr');
        const vapiId = call.vapi_call_id || call.lead_id || call.id || call.Id || '-';
        const shortId = vapiId.length > 20 ? vapiId.substring(0, 8) + '...' : vapiId;

        const confirmed = isConfirmed(call);
        if (confirmed) tr.classList.add('confirmed-row');

        const confData = confirmedDataMap[call.vapi_call_id];
        let confirmedCell = '❌';
        if (confirmed && confData) {
            confirmedCell = `<span class="confirmed-badge">✅ Confirmado</span>`;
        } else if (confirmed) {
            confirmedCell = '<span class="confirmed-badge">✅</span>';
        }

        const scoreVal = call._score || 0;
        const scoreLbl = getScoreLabel(scoreVal);
        const scoreClr = getScoreColor(scoreVal);

        // Find the real index in allCalls for openDetail
        const globalIndex = allCalls.indexOf(call);

        tr.innerHTML = `
            <td data-label="Call ID"><code style="font-family: monospace; color: #a855f7; font-size: 11px;" title="${vapiId}">${shortId}</code></td>
            <td data-label="Empresa"><strong>${call.lead_name || '-'}</strong></td>
            <td data-label="Teléfono" class="phone">${call.phone_called || '-'}</td>
            <td data-label="Fecha">${formatDate(call.call_time || call.CreatedAt)}</td>
            <td data-label="Resultado">${call.ended_reason || '-'}</td>
            <td data-label="Evaluación"><span class="badge ${getBadgeClass(call.evaluation)}">${call.evaluation || 'Pendiente'}</span></td>
            <td data-label="Duración">${formatDuration(call.duration_seconds)}</td>
            <td data-label="Score"><span class="score-badge ${scoreLbl.cls}" style="--score-color: ${scoreClr}">${scoreLbl.emoji} ${scoreVal}</span></td>
            <td data-label="Confirmado">${confirmedCell}</td>
            <td>
                <button class="action-btn test-detail-btn" data-global-index="${globalIndex}">👁 Ver Detalle</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Attach click handler for test detail buttons
    tbody.querySelectorAll('.test-detail-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const globalIndex = parseInt(btn.getAttribute('data-global-index'));
            if (globalIndex >= 0) openDetail(globalIndex);
        });
    });
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
document.getElementById('filter-score').addEventListener('change', loadData);
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

// --- Timezone Helper ---
// Convert a datetime-local input value (local time) to UTC string for NocoDB
// Input: '2026-02-12T13:00' (local CET) → Output: '2026-02-12 12:00:00' (UTC)
function localDatetimeToUTC(datetimeLocalValue) {
    if (!datetimeLocalValue) return null;
    const localDate = new Date(datetimeLocalValue); // parses as local time
    const utcYear = localDate.getUTCFullYear();
    const utcMonth = String(localDate.getUTCMonth() + 1).padStart(2, '0');
    const utcDay = String(localDate.getUTCDate()).padStart(2, '0');
    const utcHours = String(localDate.getUTCHours()).padStart(2, '0');
    const utcMinutes = String(localDate.getUTCMinutes()).padStart(2, '0');
    return `${utcYear}-${utcMonth}-${utcDay} ${utcHours}:${utcMinutes}:00`;
}

// Convert a UTC date string from NocoDB to a datetime-local input value (local time)
// Input: '2026-02-12 12:00:00' (UTC) → Output: '2026-02-12T13:00' (local CET)
function utcToLocalDatetime(utcStr) {
    if (!utcStr) return '';
    // Parse as UTC by appending 'Z' if no timezone info
    const normalized = utcStr.replace(' ', 'T');
    const asUTC = normalized.endsWith('Z') ? normalized : normalized + 'Z';
    const d = new Date(asUTC);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Convert a UTC date string to a local Date object for display/comparison
function utcStringToLocalDate(utcStr) {
    if (!utcStr) return new Date(NaN);
    const normalized = utcStr.replace(' ', 'T');
    const asUTC = normalized.endsWith('Z') ? normalized : normalized + 'Z';
    return new Date(asUTC);
}

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
    const assistantId = document.getElementById('manual-assistant').value;
    const isScheduled = document.getElementById('manual-schedule-toggle').checked;
    const scheduledTime = document.getElementById('manual-schedule-time').value;
    const feedback = document.getElementById('call-feedback');
    const btn = document.getElementById('trigger-call-btn');

    if (!name || !phone || !company) {
        feedback.textContent = '❌ Por favor, rellena todos los campos';
        feedback.className = 'feedback-error';
        return;
    }

    if (isScheduled && !scheduledTime) {
        feedback.textContent = '❌ Por favor, elige una hora para programar';
        feedback.className = 'feedback-error';
        return;
    }

    const formattedPhone = normalizePhone(phone);
    btn.disabled = true;

    if (isScheduled) {
        // --- SCHEDULE FOR LATER ---
        btn.textContent = '⌛ Programando Llamada...';
        feedback.textContent = 'Guardando programación en NocoDB...';
        feedback.className = 'feedback-loading';

        try {
            const LEADS_TABLE = 'mgot1kl4sglenym';
            const leadPayload = {
                unique_id: 'lead_' + Date.now(),
                name: name,
                phone: formattedPhone,
                email: '',
                sector: '',
                summary: company || '',
                address: '',
                fecha_planificada: localDatetimeToUTC(scheduledTime)
            };

            console.log('Scheduling lead payload:', JSON.stringify(leadPayload));

            const res = await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                method: 'POST',
                headers: {
                    'xc-token': XC_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(leadPayload)
            });

            if (res.ok) {
                feedback.textContent = '📅 ¡Llamada programada con éxito!';
                feedback.className = 'feedback-success';
                setTimeout(() => {
                    closeManualModal();
                    loadData();
                    fetchScheduledLeads();
                }, 2000);
            } else {
                const errBody = await res.json();
                console.error('NocoDB Schedule Error Response:', res.status, errBody);
                throw new Error(errBody.msg || errBody.message || `Error ${res.status} al guardar`);
            }
        } catch (err) {
            console.error('Schedule Error:', err);
            feedback.textContent = `❌ Error: ${err.message}`;
            feedback.className = 'feedback-error';
        } finally {
            btn.disabled = false;
            btn.textContent = '📅 Programar Llamada';
        }
        return;
    }

    // --- IMMEDIATE CALL ---
    btn.textContent = '⌛ Iniciando Llamada...';
    feedback.textContent = 'Conectando con Vapi AI...';
    feedback.className = 'feedback-loading';

    try {
        // 1. Call Vapi AI via local proxy to avoid CORS
        const vapiRes = await fetch('/vapi-api/call', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer: { number: formattedPhone },
                assistantId: assistantId,
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
            setTimeout(async () => {
                closeManualModal();
                loadData();

                // 3. Clear scheduled status in Leads table so it disappears from Planning section
                try {
                    const LEADS_TABLE = 'mgot1kl4sglenym';
                    // Search by raw phone first (as stored in DB), then normalized
                    const rawPhone = document.getElementById('manual-phone').value.trim();
                    const normalizedPhone = normalizePhone(formattedPhone);

                    console.log(`[Persistence] Searching for lead: raw=${rawPhone}, normalized=${normalizedPhone}`);

                    // Try raw phone first (many leads stored without +34)
                    let searchRes = await fetch(`${API_BASE}/${LEADS_TABLE}/records?where=(phone,eq,${encodeURIComponent(rawPhone)})`, {
                        headers: { 'xc-token': XC_TOKEN }
                    });
                    let searchData = await searchRes.json();
                    let leadToClear = searchData.list && searchData.list[0];

                    // If not found, try normalized phone
                    if (!leadToClear && normalizedPhone !== rawPhone) {
                        searchRes = await fetch(`${API_BASE}/${LEADS_TABLE}/records?where=(phone,eq,${encodeURIComponent(normalizedPhone)})`, {
                            headers: { 'xc-token': XC_TOKEN }
                        });
                        searchData = await searchRes.json();
                        leadToClear = searchData.list && searchData.list[0];
                    }

                    if (leadToClear && leadToClear.fecha_planificada) {
                        const leadId = leadToClear.Id || leadToClear.id;
                        console.log(`[Persistence] Found lead ${leadId}. Clearing fecha_planificada...`);
                        await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                            method: 'PATCH',
                            headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
                            body: JSON.stringify([{
                                Id: leadId,
                                fecha_planificada: null
                            }])
                        });
                        console.log('[Persistence] Successfully cleared lead status.');
                        setTimeout(fetchScheduledLeads, 500);
                    } else {
                        console.warn('[Persistence] No scheduled lead found for phone:', rawPhone, normalizedPhone);
                    }
                } catch (e) {
                    console.error('[Persistence] Error clearing lead status:', e);
                }
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
    document.getElementById('manual-schedule-toggle').checked = false;
    document.getElementById('manual-schedule-fields').style.display = 'none';
    document.getElementById('trigger-call-btn').textContent = '🚀 Lanzar Llamada';
    document.getElementById('call-feedback').textContent = '';

    // Default time + 5 min
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now - tzOffset)).toISOString().slice(0, 16);
    document.getElementById('manual-schedule-time').value = localISOTime;
}

function closeManualModal() {
    document.getElementById('manual-call-modal').style.display = 'none';
}

document.getElementById('manual-call-fab').addEventListener('click', openManualModal);
document.getElementById('close-manual-modal').addEventListener('click', closeManualModal);
document.getElementById('trigger-call-btn').addEventListener('click', triggerManualCall);

// Toggle listeners
document.getElementById('manual-schedule-toggle').addEventListener('change', (e) => {
    const fields = document.getElementById('manual-schedule-fields');
    const btn = document.getElementById('trigger-call-btn');
    if (e.target.checked) {
        fields.style.display = 'block';
        btn.textContent = '📅 Programar Llamada';
        btn.style.background = 'var(--accent)';
    } else {
        fields.style.display = 'none';
        btn.textContent = '🚀 Lanzar Llamada';
        btn.style.background = 'var(--success)';
    }
});

document.getElementById('manual-call-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('manual-call-modal')) {
        closeManualModal();
    }
});

// --- Transcript Extraction Logic ---

function extractInfoFromTranscript(text) {
    if (!text) return { name: '', email: '', phone: '' };

    const lines = text.split('\n');
    let email = '', phone = '', name = '';

    // Standard Email Regex
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    // Spanish Phone Regex
    const phoneRegex = /(?:\+34|0034|34)?[ -]?(?:[6789]\d{8}|[6789]\d{2}[ -]\d{3}[ -]\d{3}|[6789]\d{2}[ -]\d{2}[ -]\d{2}[ -]\d{2})/;
    // Name Heuristics (Simplified and case-insensitive)
    const nameHeuristics = [
        /soy\s+([A-ZÁÉÍÓÚÑa-z]+(?:\s+[A-ZÁÉÍÓÚÑa-z]+){0,4})/i,
        /me llamo\s+([A-ZÁÉÍÓÚÑa-z]+(?:\s+[A-ZÁÉÍÓÚÑa-z]+){0,4})/i,
        /soy el\s+([A-ZÁÉÍÓÚÑa-z]+(?:\s+[A-ZÁÉÍÓÚÑa-z]+){0,4})/i,
        /soy la\s+([A-ZÁÉÍÓÚÑa-z]+(?:\s+[A-ZÁÉÍÓÚÑa-z]+){0,4})/i,
        /nombre es\s+([A-ZÁÉÍÓÚÑa-z]+(?:\s+[A-ZÁÉÍÓÚÑa-z]+){0,4})/i
    ];

    for (const line of lines) {
        const isUser = line.toLowerCase().includes('user:') || line.toLowerCase().includes('lead:');

        // Extract Email
        if (!email) {
            const m = line.match(emailRegex);
            if (m) email = m[0];
        }

        // Extract Phone
        if (!phone) {
            const m = line.match(phoneRegex);
            if (m) phone = m[0].trim();
        }

        // Extract Name (Prioritize User lines)
        if (!name || (isUser && name.toLowerCase().includes('violeta'))) {
            for (const regex of nameHeuristics) {
                const m = line.match(regex);
                if (m && m[1]) {
                    const detected = m[1].trim();
                    const lower = detected.toLowerCase();
                    if (!['violeta', 'marcos', 'asistente', 'compañera'].some(forbidden => lower.includes(forbidden))) {
                        name = detected;
                        break;
                    }
                }
            }
        }
    }

    return { email, phone, name };
}

document.getElementById('extract-transcript-btn').addEventListener('click', () => {
    const transcript = document.getElementById('modal-transcript').textContent;
    const results = extractInfoFromTranscript(transcript);
    const feedback = document.getElementById('extraction-feedback');

    document.getElementById('ext-name').value = results.name;
    document.getElementById('ext-email').value = results.email;
    document.getElementById('ext-phone').value = results.phone;

    document.getElementById('extraction-results').style.display = 'block';
    feedback.textContent = '✨ Análisis completado. Revisa y pulsa Actualizar.';
    feedback.style.color = 'var(--accent)';
});

document.getElementById('apply-extraction-btn').addEventListener('click', async () => {
    if (!activeDetailCall) return;

    const btn = document.getElementById('apply-extraction-btn');
    const feedback = document.getElementById('extraction-feedback');

    const name = document.getElementById('ext-name').value;
    const email = document.getElementById('ext-email').value;
    const phone = document.getElementById('ext-phone').value;

    btn.disabled = true;
    btn.textContent = '⌛ Actualizando Lead...';
    feedback.textContent = 'Buscando lead asociado en NocoDB...';

    try {
        const LEADS_TABLE = 'mgot1kl4sglenym';
        const phoneCalled = activeDetailCall.phone_called;
        const normalizedSearch = normalizePhone(phoneCalled);

        // 1. Find the lead by normalized phone (encoded for special chars like +)
        const query = `(phone,eq,${encodeURIComponent(normalizedSearch)})`;
        const searchRes = await fetch(`${API_BASE}/${LEADS_TABLE}/records?where=${query}`, {
            headers: { 'xc-token': XC_TOKEN }
        });
        const searchData = await searchRes.json();
        const lead = searchData.list && searchData.list[0];

        if (!lead) {
            throw new Error('No se encontró un lead con el teléfono ' + phoneCalled);
        }

        const leadId = lead.id || lead.Id;

        // 2. Update the lead
        const updatePayload = {
            name: name || lead.name,
            email: email || lead.email,
            phone: phone || lead.phone,
            status: 'Interesado' // Auto-update status as we have contact info
        };

        const updateRes = await fetch(`${API_BASE}/${LEADS_TABLE}/records/${leadId}`, {
            method: 'PATCH',
            headers: {
                'xc-token': XC_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatePayload)
        });

        if (updateRes.ok) {
            feedback.textContent = '✅ ¡Lead actualizado con éxito!';
            feedback.style.color = 'var(--success)';
            setTimeout(() => {
                document.getElementById('extraction-results').style.display = 'none';
                loadData();
                fetchScheduledLeads();
            }, 2000);
        } else {
            throw new Error('Error al actualizar en NocoDB');
        }

    } catch (err) {
        console.error('Extraction Apply Error:', err);
        feedback.textContent = `❌ ${err.message}`;
        feedback.style.color = 'var(--danger)';
    } finally {
        btn.disabled = false;
        btn.textContent = '💾 Actualizar Lead Relacionado';
    }
});

// --- Live Clock & Timer Logic ---
function updatePlannedTimers() {
    const timers = document.querySelectorAll('.planned-card-timer');
    if (timers.length === 0) return;

    const now = new Date();

    timers.forEach(timer => {
        const scheduledStr = timer.getAttribute('data-scheduled');
        if (!scheduledStr) return;

        const scheduledAt = utcStringToLocalDate(scheduledStr);
        const diff = scheduledAt - now;
        const span = timer.querySelector('span');

        if (diff <= 0) {
            // Show overdue status instead of "Llamando..." — the call may or may not have been triggered
            const overdueMinutes = Math.abs(Math.floor(diff / 60000));
            if (overdueMinutes < 2) {
                span.textContent = '⏳ Lanzando...';
            } else {
                span.textContent = `⏰ Vencida hace ${overdueMinutes}min`;
            }
            span.className = 'timer-urgent';
            return;
        }

        const totalSeconds = Math.floor(diff / 1000);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;

        const timeStr = `${h > 0 ? h + 'h ' : ''}${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
        span.textContent = timeStr;

        // Visual Urgency
        if (totalSeconds < 300) { // < 5 mins
            span.className = 'timer-urgent';
        } else if (totalSeconds < 3600) { // < 1 hour
            span.className = 'timer-warning';
        } else {
            span.className = '';
        }
    });
}

function updateLiveClock() {
    const clockEl = document.getElementById('live-clock');
    if (!clockEl) return;

    const now = new Date();

    // Also update planned timers to stay in sync
    updatePlannedTimers();

    const options = {
        timeZone: 'Europe/Madrid',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };

    try {
        const timeStr = new Intl.DateTimeFormat('es-ES', options).format(now);
        clockEl.textContent = timeStr;
    } catch (err) {
        clockEl.textContent = now.toLocaleTimeString('es-ES');
    }
}

// Start the clock and update every second
setInterval(updateLiveClock, 1000);
document.addEventListener('DOMContentLoaded', updateLiveClock);
updateLiveClock();
