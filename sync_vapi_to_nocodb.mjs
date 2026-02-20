#!/usr/bin/env node
// Re-sync missing legitimate calls from Vapi to NocoDB
// Only imports calls that have legitimate ended reasons (not error floods)

const VAPI_KEY = '852080ba-ce7c-4778-b218-bf718613a2b6';
const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const LOGS_TABLE = 'm013en5u2cyu30j';
const LEADS_TABLE = 'mgot1kl4sglenym';

// Error patterns to exclude (flood/infra errors, not real calls)
const ERROR_PATTERNS = [
    'sip-503',
    'providerfault',
    'service-unavailable',
    'failed-to-connect'
];

async function main() {
    console.log('🔄 SINCRONIZACIÓN VAPI → NocoDB');
    console.log('='.repeat(50));

    // 1. Get all Vapi calls from today
    const vapiRes = await fetch('https://api.vapi.ai/call?limit=100', {
        headers: { 'Authorization': `Bearer ${VAPI_KEY}` }
    });
    const vapiCalls = await vapiRes.json();
    if (!Array.isArray(vapiCalls)) {
        console.error('Error Vapi:', vapiCalls);
        return;
    }

    const todayCalls = vapiCalls.filter(c => c.createdAt?.startsWith('2026-02-16'));
    console.log(`Llamadas Vapi hoy: ${todayCalls.length}`);

    // 2. Get all NocoDB call log IDs
    let allNocoIds = new Set();
    let offset = 0;
    while (true) {
        const res = await fetch(`${API_BASE}/${LOGS_TABLE}/records?limit=200&offset=${offset}&fields=vapi_call_id`, {
            headers: { 'xc-token': XC }
        });
        const data = await res.json();
        (data.list || []).forEach(r => allNocoIds.add(r.vapi_call_id));
        if ((data.list || []).length < 200) break;
        offset += 200;
    }
    console.log(`IDs en NocoDB: ${allNocoIds.size}`);

    // 3. Get leads for name lookup
    let allLeads = [];
    offset = 0;
    while (true) {
        const res = await fetch(`${API_BASE}/${LEADS_TABLE}/records?limit=200&offset=${offset}&fields=unique_id,name,phone`, {
            headers: { 'xc-token': XC }
        });
        const data = await res.json();
        allLeads = allLeads.concat(data.list || []);
        if ((data.list || []).length < 200) break;
        offset += 200;
    }

    // Build phone → name map
    const phoneToName = new Map();
    allLeads.forEach(l => {
        if (l.phone) {
            const clean = l.phone.replace(/\D/g, '');
            phoneToName.set(clean, l.name);
            if (!clean.startsWith('34')) phoneToName.set('34' + clean, l.name);
        }
    });

    // 4. Find missing legitimate calls
    const missing = todayCalls.filter(c => {
        if (allNocoIds.has(c.id)) return false; // Already in NocoDB
        const reason = c.endedReason || '';
        // Exclude error flood calls
        if (ERROR_PATTERNS.some(p => reason.includes(p))) return false;
        return true;
    });

    console.log(`\nLlamadas legítimas faltantes: ${missing.length}`);

    if (missing.length === 0) {
        console.log('✅ Todo sincronizado!');
        return;
    }

    // 5. Insert missing calls
    const records = missing.map(c => {
        const phone = c.customer?.number || '';
        const cleanPhone = phone.replace(/\D/g, '');
        const leadName = phoneToName.get(cleanPhone) || 'Desconocido';
        const duration = c.endedAt && c.startedAt
            ? Math.round((new Date(c.endedAt) - new Date(c.startedAt)) / 1000)
            : 0;

        return {
            vapi_call_id: c.id,
            lead_name: leadName,
            phone_called: phone,
            call_time: c.createdAt,
            ended_reason: c.endedReason || 'N/A',
            duration_seconds: duration,
            evaluation: duration > 30 ? 'Sin datos' : null
        };
    });

    console.log('\nInsertando:');
    records.forEach(r => {
        console.log(`  📞 ${r.lead_name.substring(0, 35).padEnd(35)} | ${r.phone_called} | ${r.ended_reason.substring(0, 30)} | ${r.duration_seconds}s`);
    });

    // Insert in batches
    let inserted = 0;
    for (let i = 0; i < records.length; i += 10) {
        const batch = records.slice(i, i + 10);
        const res = await fetch(`${API_BASE}/${LOGS_TABLE}/records`, {
            method: 'POST',
            headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
            body: JSON.stringify(batch)
        });
        if (res.ok) {
            inserted += batch.length;
        } else {
            console.error(`Error insertando lote: ${res.status}`);
        }
    }

    console.log(`\n✅ ${inserted} llamadas sincronizadas a NocoDB`);

    // Final count
    const finalRes = await fetch(`${API_BASE}/${LOGS_TABLE}/records?limit=1`, {
        headers: { 'xc-token': XC }
    });
    const finalData = await finalRes.json();
    console.log(`Total call_logs ahora: ${finalData.pageInfo?.totalRows}`);
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
