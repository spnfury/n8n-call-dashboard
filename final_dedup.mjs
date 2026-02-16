#!/usr/bin/env node
// FINAL DEDUP: Deduplica call_logs dejando solo 1 entrada por llamada real
// Criterio: mismo teléfono dentro de 5 minutos = duplicado
// Mantiene la entrada con mayor duración o el ended_reason más informativo

const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const LOGS_TABLE = 'm013en5u2cyu30j';

const DRY_RUN = !process.argv.includes('--execute');

// Priority of ended_reason (higher = more informative, keep this one)
const REASON_PRIORITY = {
    'customer-ended-call': 10,
    'assistant-ended-call': 9,
    'silence-timed-out': 8,
    'customer-busy': 5,
    'Call Initiated': 3,
    'customer-did-not-answer': 4,
    'Manual Trigger': 2,
};

function getReasonPriority(reason) {
    if (!reason) return 0;
    for (const [key, val] of Object.entries(REASON_PRIORITY)) {
        if (reason.includes(key)) return val;
    }
    if (reason.includes('Error') || reason.includes('error')) return 1;
    return 3;
}

async function main() {
    console.log('🧹 DEDUPLICACIÓN FINAL DE CALL_LOGS');
    console.log('='.repeat(55));
    if (DRY_RUN) console.log('⚠️  MODO DRY-RUN: usa --execute para aplicar\n');

    // 1. Fetch ALL call logs
    let allLogs = [];
    let offset = 0;
    while (true) {
        const res = await fetch(`${API_BASE}/${LOGS_TABLE}/records?limit=200&offset=${offset}&sort=call_time`, {
            headers: { 'xc-token': XC }
        });
        const data = await res.json();
        allLogs = allLogs.concat(data.list || []);
        if ((data.list || []).length < 200) break;
        offset += 200;
    }
    console.log(`Total registros actuales: ${allLogs.length}`);

    // 2. Also remove any entries with error patterns
    const errorIds = [];
    const cleanLogs = [];
    for (const log of allLogs) {
        const reason = log.ended_reason || '';
        if (reason.includes('sip-503') || reason.includes('providerfault') ||
            reason.includes('service-unavailable') || reason.includes('failed-to-connect')) {
            errorIds.push(log.id);
        } else {
            cleanLogs.push(log);
        }
    }
    console.log(`Errores de infraestructura a eliminar: ${errorIds.length}`);

    // 3. Group by phone number, find duplicates within 5 min windows
    const groups = new Map(); // phone -> [{log, time}]
    for (const log of cleanLogs) {
        const phone = (log.phone_called || '').replace(/\D/g, '');
        if (!phone) continue;
        if (!groups.has(phone)) groups.set(phone, []);
        groups.get(phone).push({
            log,
            time: new Date(log.call_time || 0).getTime(),
            priority: getReasonPriority(log.ended_reason),
            duration: parseInt(log.duration_seconds) || 0
        });
    }

    const duplicateIds = [];
    const kept = [];

    for (const [phone, entries] of groups) {
        // Sort by time
        entries.sort((a, b) => a.time - b.time);

        // Group into clusters (within 5 minutes of each other)
        const clusters = [];
        let currentCluster = [entries[0]];

        for (let i = 1; i < entries.length; i++) {
            const timeDiff = entries[i].time - currentCluster[0].time;
            if (timeDiff < 5 * 60 * 1000) {
                currentCluster.push(entries[i]);
            } else {
                clusters.push(currentCluster);
                currentCluster = [entries[i]];
            }
        }
        clusters.push(currentCluster);

        // For each cluster, keep the best entry
        for (const cluster of clusters) {
            if (cluster.length === 1) {
                kept.push(cluster[0]);
                continue;
            }

            // Sort by: duration DESC, priority DESC
            cluster.sort((a, b) => {
                if (b.duration !== a.duration) return b.duration - a.duration;
                return b.priority - a.priority;
            });

            const best = cluster[0];
            kept.push(best);

            // Mark rest as duplicates
            for (let i = 1; i < cluster.length; i++) {
                duplicateIds.push(cluster[i].log.id);
            }

            if (cluster.length > 1) {
                console.log(`  📞 ${phone}: ${cluster.length} entradas → mantengo ID=${best.log.id} (${best.log.ended_reason}, ${best.duration}s), elimino ${cluster.length - 1}`);
            }
        }
    }

    const allToDelete = [...new Set([...errorIds, ...duplicateIds])];
    console.log(`\n📊 Resumen:`);
    console.log(`  Errores infra: ${errorIds.length}`);
    console.log(`  Duplicados: ${duplicateIds.length}`);
    console.log(`  Total a eliminar: ${allToDelete.length}`);
    console.log(`  Registros que quedarán: ${allLogs.length - allToDelete.length}`);

    if (allToDelete.length > 0 && !DRY_RUN) {
        console.log('\n🗑️ Eliminando...');
        let deleted = 0;
        for (let i = 0; i < allToDelete.length; i += 10) {
            const batch = allToDelete.slice(i, i + 10).map(id => ({ id }));
            const res = await fetch(`${API_BASE}/${LOGS_TABLE}/records`, {
                method: 'DELETE',
                headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
                body: JSON.stringify(batch)
            });
            if (res.ok) deleted += batch.length;
            process.stdout.write(`\r   Eliminados ${deleted}/${allToDelete.length}`);
        }
        console.log('\n');
    }

    // Final count
    if (!DRY_RUN) {
        const finalRes = await fetch(`${API_BASE}/${LOGS_TABLE}/records?limit=1`, {
            headers: { 'xc-token': XC }
        });
        const finalData = await finalRes.json();
        console.log(`✅ Total call_logs final: ${finalData.pageInfo?.totalRows}`);
    }

    console.log('\n' + '='.repeat(55));
    if (DRY_RUN) {
        console.log('Ejecuta: node final_dedup.mjs --execute');
    } else {
        console.log('✅ DEDUPLICACIÓN COMPLETADA');
    }
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
