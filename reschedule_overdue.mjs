#!/usr/bin/env node
// Script para redistribuir leads vencidos de forma escalonada
// Evita la avalancha de 42 leads intentando llamar todos a la vez

const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const LEADS_TABLE = 'mgot1kl4sglenym';

const DRY_RUN = !process.argv.includes('--execute');

async function main() {
    console.log('='.repeat(60));
    console.log('📅 REDISTRIBUCIÓN DE LEADS VENCIDOS');
    console.log('='.repeat(60));
    if (DRY_RUN) console.log('⚠️  MODO DRY-RUN: usa --execute para aplicar\n');

    // Fetch ALL programado leads
    let allLeads = [];
    let offset = 0;
    while (true) {
        const res = await fetch(`${API_BASE}/${LEADS_TABLE}/records?limit=200&offset=${offset}&where=(status,eq,Programado)&sort=fecha_planificada&fields=unique_id,name,phone,fecha_planificada,status`, {
            headers: { 'xc-token': XC_TOKEN }
        });
        const data = await res.json();
        const records = data.list || [];
        allLeads = allLeads.concat(records);
        if (records.length < 200) break;
        offset += 200;
    }

    console.log(`Total leads Programados: ${allLeads.length}\n`);

    const now = new Date();
    const pastDue = allLeads.filter(l => {
        if (!l.fecha_planificada) return true;
        try {
            return new Date(l.fecha_planificada) <= now;
        } catch { return true; }
    });

    const future = allLeads.filter(l => {
        if (!l.fecha_planificada) return false;
        try {
            return new Date(l.fecha_planificada) > now;
        } catch { return false; }
    });

    console.log(`  Ya vencidos (necesitan reprogramar): ${pastDue.length}`);
    console.log(`  Futuros (OK): ${future.length}\n`);

    if (pastDue.length === 0) {
        console.log('✅ No hay leads vencidos. Todo OK.');
        return;
    }

    // Find the latest future date to avoid conflicts
    let latestFuture = now;
    if (future.length > 0) {
        const futureDates = future
            .map(l => new Date(l.fecha_planificada))
            .filter(d => !isNaN(d.getTime()));
        if (futureDates.length > 0) {
            latestFuture = new Date(Math.max(...futureDates));
        }
    }

    // Schedule past-due leads AFTER all future leads, staggered by 3 minutes
    // This ensures they don't compete with already-scheduled future leads
    const startFrom = new Date(Math.max(latestFuture.getTime(), now.getTime()) + 5 * 60 * 1000);
    const INTERVAL_MS = 3 * 60 * 1000; // 3 minutes between each lead

    console.log(`📅 Reprogramando ${pastDue.length} leads vencidos:`);
    console.log(`   Inicio: ${startFrom.toISOString()}`);
    console.log(`   Final estimado: ${new Date(startFrom.getTime() + pastDue.length * INTERVAL_MS).toISOString()}`);
    console.log(`   Intervalo: 3 minutos entre cada uno\n`);

    const updates = [];
    for (let i = 0; i < pastDue.length; i++) {
        const lead = pastDue[i];
        const newDate = new Date(startFrom.getTime() + i * INTERVAL_MS);
        updates.push({
            unique_id: lead.unique_id,
            name: lead.name,
            oldDate: lead.fecha_planificada,
            newDate: newDate.toISOString()
        });

        if (i < 10 || i === pastDue.length - 1) {
            const oldStr = lead.fecha_planificada ? new Date(lead.fecha_planificada).toLocaleTimeString('es-ES') : 'NULL';
            console.log(`  ${String(i + 1).padStart(3)}. ${lead.name?.substring(0, 40).padEnd(40)} | ${oldStr} → ${newDate.toLocaleTimeString('es-ES')}`);
        } else if (i === 10) {
            console.log(`  ... (${pastDue.length - 11} más) ...`);
        }
    }

    if (!DRY_RUN) {
        console.log('\n🔄 Aplicando cambios...');
        let updated = 0;
        for (let i = 0; i < updates.length; i += 10) {
            const batch = updates.slice(i, i + 10).map(u => ({
                unique_id: u.unique_id,
                fecha_planificada: u.newDate
            }));

            const res = await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                method: 'PATCH',
                headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify(batch)
            });

            if (res.ok) {
                updated += batch.length;
                process.stdout.write(`\r   Actualizados ${updated}/${updates.length}`);
            } else {
                console.error(`\n   ❌ Error en lote ${Math.floor(i / 10) + 1}: ${res.status}`);
            }
        }
        console.log(`\n✅ ${updated} leads reprogramados exitosamente.`);
    }

    console.log('\n' + '='.repeat(60));
    if (DRY_RUN) {
        console.log('Ejecuta: node reschedule_overdue.mjs --execute');
    } else {
        console.log('✅ Redistribución completada. Los leads se llamarán de forma ordenada.');
    }
    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
