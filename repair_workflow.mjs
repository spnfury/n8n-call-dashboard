#!/usr/bin/env node
// Script de reparación para el workflow General Protect - 16/02/2026
// Arregla: 
// 1. Leads con status="Programado" y fecha_planificada=NULL (les asigna una fecha)
// 2. Limpia call_logs con error SIP 503 de la avalancha del 16/02
// 3. Resumen del estado actual

const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const LEADS_TABLE = 'mgot1kl4sglenym';
const CALL_LOGS_TABLE = 'm013en5u2cyu30j';

const DRY_RUN = !process.argv.includes('--execute');

async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        ...opts,
        headers: {
            'xc-token': XC_TOKEN,
            'Content-Type': 'application/json',
            ...(opts.headers || {})
        }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
    }
    return res.json();
}

async function main() {
    console.log('='.repeat(60));
    console.log('🔧 REPARACIÓN WORKFLOW GENERAL PROTECT');
    console.log('='.repeat(60));
    if (DRY_RUN) {
        console.log('⚠️  MODO DRY-RUN: ejecuta con --execute para aplicar cambios\n');
    }

    // ─── 1. Fix leads with NULL fecha_planificada ────────────────
    console.log('\n── 1. Leads sin fecha_planificada ──');
    const nullDateLeads = await api(
        `/${LEADS_TABLE}/records?limit=200&where=(status,eq,Programado)~and(fecha_planificada,is,null)&fields=unique_id,name,phone,fecha_planificada,status`
    );
    const nullList = nullDateLeads.list || [];
    console.log(`   Encontrados: ${nullList.length}`);

    if (nullList.length > 0) {
        // Assign dates staggered every 2 minutes from now + 5 min
        const now = new Date();
        for (let i = 0; i < nullList.length; i++) {
            const lead = nullList[i];
            const futureDate = new Date(now.getTime() + (5 + i * 2) * 60 * 1000);
            const isoDate = futureDate.toISOString();
            console.log(`   → ${lead.name}: asignando fecha ${isoDate}`);

            if (!DRY_RUN) {
                await api(`/${LEADS_TABLE}/records`, {
                    method: 'PATCH',
                    body: JSON.stringify([{
                        unique_id: lead.unique_id,
                        fecha_planificada: isoDate
                    }])
                });
                console.log(`     ✅ Actualizado`);
            }
        }
    }

    // ─── 2. Clean SIP 503 error logs from today ──────────────────
    console.log('\n── 2. Limpieza de call_logs con error SIP 503 ──');
    let allSipErrors = [];
    let offset = 0;
    while (true) {
        const data = await api(`/${CALL_LOGS_TABLE}/records?limit=200&offset=${offset}&sort=-call_time`);
        const records = data.list || [];
        const errors = records.filter(r => {
            const reason = (r.ended_reason || '');
            return reason.includes('sip-503') || reason.includes('service-unavailable') ||
                reason.includes('providerfault');
        });
        allSipErrors = allSipErrors.concat(errors.map(e => ({ id: e.id, name: e.lead_name, reason: e.ended_reason })));
        if (records.length < 200) break;
        offset += 200;
        if (offset > 2000) break;
    }

    console.log(`   Errores SIP 503 encontrados: ${allSipErrors.length}`);
    if (allSipErrors.length > 0) {
        console.log(`   Primeros 5:`);
        allSipErrors.slice(0, 5).forEach(e => console.log(`     → id=${e.id} | ${e.name} | ${e.reason?.substring(0, 60)}`));
    }

    if (allSipErrors.length > 0 && !DRY_RUN) {
        let deleted = 0;
        for (let i = 0; i < allSipErrors.length; i += 10) {
            const batch = allSipErrors.slice(i, i + 10).map(e => ({ id: e.id }));
            const res = await fetch(`${API_BASE}/${CALL_LOGS_TABLE}/records`, {
                method: 'DELETE',
                headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify(batch)
            });
            if (res.ok) {
                deleted += batch.length;
                process.stdout.write(`\r   Eliminados ${deleted}/${allSipErrors.length}`);
            }
        }
        console.log(`\n   ✅ ${deleted} registros con error SIP eliminados`);
    }

    // ─── 3. Summary ──────────────────────────────────────────────
    console.log('\n── 3. Resumen del estado actual ──');
    const totalProgramado = await api(`/${LEADS_TABLE}/records?limit=1&where=(status,eq,Programado)`);
    const totalCompletado = await api(`/${LEADS_TABLE}/records?limit=1&where=(status,eq,Completado)`);
    const totalLogs = await api(`/${CALL_LOGS_TABLE}/records?limit=1`);

    console.log(`   Total leads Programados: ${totalProgramado.pageInfo?.totalRows || '?'}`);
    console.log(`   Total leads Completados: ${totalCompletado.pageInfo?.totalRows || '?'}`);
    console.log(`   Total call_logs: ${totalLogs.pageInfo?.totalRows || '?'}`);

    console.log('\n' + '='.repeat(60));
    if (DRY_RUN) {
        console.log('Para aplicar los cambios, ejecuta: node repair_workflow.mjs --execute');
    } else {
        console.log('✅ Reparación completada.');
    }
    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
