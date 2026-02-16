#!/usr/bin/env node
// EMERGENCY CLEANUP - Limpieza masiva de logs de error y fix de leads vencidos

const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const LOGS_TABLE = 'm013en5u2cyu30j';
const LEADS_TABLE = 'mgot1kl4sglenym';

async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        ...opts,
        headers: { 'xc-token': XC, 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    return res;
}

async function main() {
    console.log('🚨 EMERGENCY CLEANUP');
    console.log('='.repeat(50));

    // ─── 1. Delete ALL error/duplicate logs ──────────────
    console.log('\n── 1. Eliminar TODOS los logs de error y duplicados ──');

    let totalDeleted = 0;

    // Delete logs with Error in ended_reason
    let keepDeleting = true;
    while (keepDeleting) {
        const res = await api(`/${LOGS_TABLE}/records?limit=200&where=(ended_reason,like,%25Error%25)&fields=id`);
        const data = await res.json();
        const records = data.list || [];

        if (records.length === 0) { keepDeleting = false; break; }

        for (let i = 0; i < records.length; i += 10) {
            const batch = records.slice(i, i + 10).map(r => ({ id: r.id }));
            const delRes = await fetch(`${API_BASE}/${LOGS_TABLE}/records`, {
                method: 'DELETE',
                headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
                body: JSON.stringify(batch)
            });
            if (delRes.ok) totalDeleted += batch.length;
            process.stdout.write(`\r   Eliminados errores: ${totalDeleted}`);
        }
    }
    console.log(`\n   ✅ ${totalDeleted} logs de error eliminados`);

    // Delete duplicate "Call Initiated" logs (same phone, multiple entries within 1 minute)
    console.log('\n── 2. Eliminar logs duplicados de "Call Initiated" ──');

    // Get all Call Initiated logs
    let allInitiated = [];
    let offset = 0;
    while (true) {
        const res = await api(`/${LOGS_TABLE}/records?limit=200&offset=${offset}&where=(ended_reason,eq,Call Initiated)&sort=-call_time&fields=id,lead_name,phone_called,call_time`);
        const data = await res.json();
        allInitiated = allInitiated.concat(data.list || []);
        if ((data.list || []).length < 200) break;
        offset += 200;
    }

    console.log(`   Total "Call Initiated" logs: ${allInitiated.length}`);

    // Find duplicates - same phone within 5 minutes = duplicate
    const seen = new Map(); // phone -> earliest call_time id
    const duplicateIds = [];

    for (const log of allInitiated) {
        const key = log.phone_called;
        const time = new Date(log.call_time).getTime();

        if (seen.has(key)) {
            const { time: prevTime, id: prevId } = seen.get(key);
            if (Math.abs(time - prevTime) < 5 * 60 * 1000) {
                // Duplicate - keep the first one, delete this one
                duplicateIds.push(log.id);
                continue;
            }
        }
        seen.set(key, { time, id: log.id });
    }

    console.log(`   Duplicados detectados: ${duplicateIds.length}`);

    let dupDeleted = 0;
    for (let i = 0; i < duplicateIds.length; i += 10) {
        const batch = duplicateIds.slice(i, i + 10).map(id => ({ id }));
        const delRes = await fetch(`${API_BASE}/${LOGS_TABLE}/records`, {
            method: 'DELETE',
            headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
            body: JSON.stringify(batch)
        });
        if (delRes.ok) dupDeleted += batch.length;
        process.stdout.write(`\r   Duplicados eliminados: ${dupDeleted}/${duplicateIds.length}`);
    }
    console.log(`\n   ✅ ${dupDeleted} duplicados eliminados`);

    // ─── 3. Fix leads with past fecha_planificada ────────
    console.log('\n── 3. Arreglar leads vencidos ──');

    let allProgramado = [];
    offset = 0;
    while (true) {
        const res = await api(`/${LEADS_TABLE}/records?limit=200&offset=${offset}&where=(status,eq,Programado)&sort=fecha_planificada&fields=unique_id,name,fecha_planificada`);
        const data = await res.json();
        allProgramado = allProgramado.concat(data.list || []);
        if ((data.list || []).length < 200) break;
        offset += 200;
    }

    const now = new Date();
    const pastDue = allProgramado.filter(l => {
        if (!l.fecha_planificada) return true;
        return new Date(l.fecha_planificada) <= now;
    });

    console.log(`   Total Programados: ${allProgramado.length}`);
    console.log(`   Vencidos/sin fecha: ${pastDue.length}`);

    if (pastDue.length > 0) {
        // Find the latest future date
        const futureDates = allProgramado
            .filter(l => l.fecha_planificada && new Date(l.fecha_planificada) > now)
            .map(l => new Date(l.fecha_planificada).getTime());

        const latestFuture = futureDates.length > 0 ? Math.max(...futureDates) : now.getTime();
        const startFrom = new Date(latestFuture + 5 * 60 * 1000);

        console.log(`   Reprogramando desde: ${startFrom.toISOString()}`);

        let fixed = 0;
        for (let i = 0; i < pastDue.length; i += 10) {
            const batch = pastDue.slice(i, i + 10).map((l, idx) => ({
                unique_id: l.unique_id,
                fecha_planificada: new Date(startFrom.getTime() + (i + idx) * 3 * 60 * 1000).toISOString()
            }));

            const patchRes = await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                method: 'PATCH',
                headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
                body: JSON.stringify(batch)
            });
            if (patchRes.ok) fixed += batch.length;
        }
        console.log(`   ✅ ${fixed} leads reprogramados`);
    }

    // ─── 4. Final count ──────────────────────────────────
    console.log('\n── 4. Estado final ──');
    const finalLogs = await (await api(`/${LOGS_TABLE}/records?limit=1`)).json();
    const finalErrors = await (await api(`/${LOGS_TABLE}/records?limit=1&where=(ended_reason,like,%25Error%25)`)).json();
    const finalProgramados = await (await api(`/${LEADS_TABLE}/records?limit=1&where=(status,eq,Programado)`)).json();

    console.log(`   Call logs totales: ${finalLogs.pageInfo?.totalRows || 0}`);
    console.log(`   Logs con error: ${finalErrors.pageInfo?.totalRows || 0}`);
    console.log(`   Leads Programados: ${finalProgramados.pageInfo?.totalRows || 0}`);

    console.log('\n' + '='.repeat(50));
    console.log('✅ EMERGENCY CLEANUP COMPLETADO');
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
