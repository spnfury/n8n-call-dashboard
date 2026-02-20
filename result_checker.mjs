#!/usr/bin/env node
/**
 * RESULT CHECKER - Verifica llamadas completadas y gestiona reintentos
 * 
 * Flujo:
 * 1. Busca leads con status "Completado" que se llamaron hoy
 * 2. Verifica en Vapi si la llamada realmente conectó
 * 3. Si falló (SIP error/busy): marca como "Reintentar" (intento 1) o "Fallido" (intento 2+)
 * 4. Si fue "Reintentar": programa nueva llamada en +30min
 * 
 * Uso: node result_checker.mjs
 *   --dry-run    Solo muestra qué haría (por defecto)
 *   --execute    Aplica los cambios
 */

const API = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const LEADS = 'mgot1kl4sglenym';
const LOGS = 'm013en5u2cyu30j';
const VAPI_KEY = '852080ba-ce7c-4778-b218-bf718613a2b6';

const DRY_RUN = !process.argv.includes('--execute');

const FAIL_REASONS = [
    'failed-to-connect',
    'providerfault',
    'sip-503',
    'service-unavailable'
];

const RETRY_REASONS = [
    'customer-busy',
    'customer-did-not-answer'
];

async function fetchJson(url, opts = {}) {
    const res = await fetch(url, opts);
    return res.json();
}

async function main() {
    console.log('🔍 RESULT CHECKER');
    console.log('='.repeat(50));
    if (DRY_RUN) console.log('⚠️  DRY-RUN mode\n');

    // 1. Get recent call logs (today) with vapi_call_id
    const today = new Date().toISOString().slice(0, 10);
    let allLogs = [];
    let offset = 0;
    while (true) {
        const data = await fetchJson(
            `${API}/${LOGS}/records?limit=200&offset=${offset}&sort=-call_time&fields=id,lead_name,phone_called,vapi_call_id,ended_reason,call_time`,
            { headers: { 'xc-token': XC } }
        );
        allLogs = allLogs.concat(data.list || []);
        if ((data.list || []).length < 200) break;
        offset += 200;
    }

    const todayLogs = allLogs.filter(l => (l.call_time || '').startsWith(today));
    console.log(`Call logs hoy: ${todayLogs.length}`);

    // 2. Get leads with status=Completado
    const leadsData = await fetchJson(
        `${API}/${LEADS}/records?limit=200&where=(status,eq,Completado)&fields=unique_id,name,phone,status,intentos`,
        { headers: { 'xc-token': XC } }
    );
    const completedLeads = leadsData.list || [];
    console.log(`Leads en Completado: ${completedLeads.length}`);

    // 3. For each completed lead, find their log and check Vapi
    const actions = [];

    for (const lead of completedLeads) {
        const phone = (lead.phone || '').replace(/\D/g, '');
        const cleanPhone = phone.startsWith('34') ? '+' + phone : '+34' + phone;

        // Find matching log from today
        const log = todayLogs.find(l => l.phone_called === cleanPhone);
        if (!log || !log.vapi_call_id) continue;

        // Check Vapi call status
        try {
            const vapiData = await fetchJson(`https://api.vapi.ai/call/${log.vapi_call_id}`, {
                headers: { 'Authorization': `Bearer ${VAPI_KEY}` }
            });

            const reason = vapiData.endedReason || '';
            const intentos = parseInt(lead.intentos) || 0;

            const isSipFail = FAIL_REASONS.some(r => reason.includes(r));
            const isRetryable = RETRY_REASONS.some(r => reason === r);

            if (isSipFail || isRetryable) {
                const newIntentos = intentos + 1;
                if (newIntentos >= 2) {
                    actions.push({
                        type: 'fallido',
                        leadId: lead.unique_id,
                        name: lead.name,
                        reason,
                        intentos: newIntentos
                    });
                } else {
                    const retryDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
                    actions.push({
                        type: 'reintentar',
                        leadId: lead.unique_id,
                        name: lead.name,
                        reason,
                        intentos: newIntentos,
                        retryDate
                    });
                }
            }
        } catch (e) {
            console.error(`  Error checking ${lead.name}: ${e.message}`);
        }
    }

    // 4. Show and apply actions
    const reintentarActions = actions.filter(a => a.type === 'reintentar');
    const fallidoActions = actions.filter(a => a.type === 'fallido');

    console.log(`\n🔄 A Reintentar: ${reintentarActions.length}`);
    for (const a of reintentarActions) {
        console.log(`  🔄 ${a.name} (${a.reason}) → Reintentar en 30min`);
    }

    console.log(`❌ A Fallido: ${fallidoActions.length}`);
    for (const a of fallidoActions) {
        console.log(`  ❌ ${a.name} (${a.reason}) → Fallido (${a.intentos} intentos)`);
    }

    if (actions.length === 0) {
        console.log('\n✅ No hay acciones pendientes');
        return;
    }

    if (DRY_RUN) {
        console.log('\n⚠️  Ejecuta con --execute para aplicar cambios');
        return;
    }

    // Apply actions
    for (const a of reintentarActions) {
        await fetch(`${API}/${LEADS}/records`, {
            method: 'PATCH',
            headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
            body: JSON.stringify([{
                unique_id: a.leadId,
                status: 'Reintentar',
                intentos: a.intentos,
                fecha_planificada: a.retryDate
            }])
        });
        console.log(`  ✅ ${a.name} → Reintentar`);
    }

    for (const a of fallidoActions) {
        await fetch(`${API}/${LEADS}/records`, {
            method: 'PATCH',
            headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
            body: JSON.stringify([{
                unique_id: a.leadId,
                status: 'Fallido',
                intentos: a.intentos,
                fecha_planificada: null
            }])
        });
        console.log(`  ✅ ${a.name} → Fallido`);
    }

    console.log('\n✅ Cambios aplicados');
}

main().catch(e => console.error('Error:', e));
