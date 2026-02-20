#!/usr/bin/env node
/**
 * Batch enrich all "Call Initiated" calls in NocoDB with real data from Vapi API.
 * Run: node enrich_pending_calls.mjs
 */

const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const CALL_LOGS_TABLE = 'm013en5u2cyu30j';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const VAPI_API_KEY = '852080ba-ce7c-4778-b218-bf718613a2b6';

function mapEndedReason(reason) {
    if (!reason) return 'Desconocido';
    const r = reason.toLowerCase();
    if (r.includes('sip') && r.includes('failed')) return 'Sin conexión (SIP)';
    if (r.includes('sip') && r.includes('busy')) return 'Línea ocupada';
    if (r.includes('sip') && r.includes('503')) return 'Servicio no disponible';
    if (r === 'customer-busy') return 'Línea ocupada';
    if (r === 'customer-ended-call') return 'Cliente colgó';
    if (r === 'assistant-ended-call') return 'Asistente finalizó';
    if (r === 'silence-timed-out') return 'Sin respuesta (silencio)';
    if (r === 'voicemail') return 'Contestador automático';
    if (r === 'machine_detected') return 'Máquina detectada';
    if (r === 'assistant-error') return 'Error del asistente';
    if (r.includes('no-answer') || r.includes('noanswer')) return 'No contesta';
    if (r.includes('error')) return 'Error: ' + reason.split('.').pop();
    return reason;
}

function evaluateCall(endedReason, duration) {
    const r = (endedReason || '').toLowerCase();
    if (r.includes('sip') && (r.includes('failed') || r.includes('error'))) return 'Fallida';
    if (endedReason === 'customer-busy') return 'Ocupado';
    if (endedReason === 'voicemail' || endedReason === 'machine_detected') return 'Contestador';
    if (endedReason === 'silence-timed-out') return duration > 10 ? 'Sin respuesta' : 'No contesta';
    if (duration > 0 && duration < 10) return 'No contesta';
    if (endedReason === 'customer-ended-call' && duration > 30) return 'Completada';
    if (endedReason === 'assistant-ended-call' && duration > 30) return 'Completada';
    if (endedReason === 'customer-ended-call' && duration <= 30) return 'Colgó rápido';
    if (endedReason === 'assistant-error') return 'Error';
    if (duration > 0) return 'Completada';
    return 'Sin datos';
}

async function main() {
    // Fetch all "Call Initiated" calls from NocoDB
    const url = `${API_BASE}/${CALL_LOGS_TABLE}/records?limit=200&sort=-CreatedAt&where=(ended_reason,eq,Call Initiated)`;
    const res = await fetch(url, { headers: { 'xc-token': XC_TOKEN } });
    const data = await res.json();
    const calls = data.list || [];

    console.log(`\n📞 Found ${calls.length} calls with "Call Initiated" to enrich\n`);

    let enriched = 0, errors = 0, skipped = 0;

    for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const vapiId = call.vapi_call_id;
        if (!vapiId) { skipped++; continue; }

        try {
            const vapiRes = await fetch(`https://api.vapi.ai/call/${vapiId}`, {
                headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
            });

            if (vapiRes.status === 429) {
                console.log('⚠️  Rate limited, waiting 5s...');
                await new Promise(r => setTimeout(r, 5000));
                i--; // Retry this call
                continue;
            }

            if (!vapiRes.ok) {
                console.log(`  ❌ ${vapiId.slice(0, 12)}... HTTP ${vapiRes.status}`);
                errors++;
                continue;
            }

            const vapiData = await vapiRes.json();

            if (vapiData.status !== 'ended') {
                console.log(`  ⏳ ${vapiId.slice(0, 12)}... still ${vapiData.status}`);
                skipped++;
                continue;
            }

            // Calculate duration
            let duration = 0;
            const msgs = vapiData.artifact?.messages || [];
            if (msgs.length > 0) {
                duration = Math.round(msgs[msgs.length - 1].secondsFromStart || 0);
            } else if (vapiData.startedAt && vapiData.endedAt) {
                duration = Math.round((new Date(vapiData.endedAt) - new Date(vapiData.startedAt)) / 1000);
            }

            const evaluation = evaluateCall(vapiData.endedReason, duration);
            const endedReason = mapEndedReason(vapiData.endedReason);

            // Update NocoDB
            const updateData = {
                id: call.Id,
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

            await fetch(`${API_BASE}/${CALL_LOGS_TABLE}/records`, {
                method: 'PATCH',
                headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify([updateData])
            });

            enriched++;
            const icon = evaluation === 'Completada' ? '✅' :
                evaluation === 'Fallida' ? '❌' :
                    evaluation === 'Ocupado' ? '📵' :
                        evaluation === 'Contestador' ? '📞' :
                            evaluation === 'No contesta' ? '🔕' : '⚠️';
            console.log(`  ${icon} [${i + 1}/${calls.length}] ${vapiId.slice(0, 12)}... → ${endedReason} | ${evaluation} | ${duration}s`);

            // Rate limit protection
            await new Promise(r => setTimeout(r, 350));
        } catch (err) {
            console.log(`  💥 ${vapiId.slice(0, 12)}... Error: ${err.message}`);
            errors++;
        }
    }

    console.log(`\n✨ Done! Enriched: ${enriched} | Skipped: ${skipped} | Errors: ${errors}\n`);
}

main().catch(console.error);
