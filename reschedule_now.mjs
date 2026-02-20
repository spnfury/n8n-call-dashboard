#!/usr/bin/env node
// Re-programa los leads para empezar AHORA con 2min de spacing

const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const LEADS_TABLE = 'mgot1kl4sglenym';

async function main() {
    // 1. Get all Programado leads
    let all = [];
    let offset = 0;
    while (true) {
        const res = await fetch(`${API_BASE}/${LEADS_TABLE}/records?limit=200&offset=${offset}&where=(status,eq,Programado)&sort=fecha_planificada`, {
            headers: { 'xc-token': XC_TOKEN }
        });
        const data = await res.json();
        all = all.concat(data.list || []);
        if (!data.list || data.list.length < 200) break;
        offset += 200;
    }

    console.log(`📊 Leads programados: ${all.length}`);

    // Filter only those with fecha_planificada
    const withDate = all.filter(l => l.fecha_planificada);
    console.log(`   Con fecha_planificada: ${withDate.length}`);

    // 2. Re-schedule starting from NOW, 2min spacing
    const now = new Date();
    console.log(`\n⏰ Hora actual: ${now.toISOString()}`);
    console.log(`   Reprogramando desde ahora con 2min de separación...\n`);

    // Sort by current fecha_planificada to maintain order
    withDate.sort((a, b) => new Date(a.fecha_planificada) - new Date(b.fecha_planificada));

    // Update in batches of 10
    let updated = 0;
    for (let i = 0; i < withDate.length; i += 10) {
        const batch = withDate.slice(i, i + 10);
        const updates = batch.map((lead, idx) => {
            const newTime = new Date(now.getTime() + (i + idx) * 2 * 60 * 1000); // 2min spacing
            return {
                unique_id: lead.unique_id,
                fecha_planificada: newTime.toISOString()
            };
        });

        const updateRes = await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
            method: 'PATCH',
            headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });

        if (updateRes.ok) {
            updated += batch.length;
            // Show first few
            if (i < 20) {
                batch.forEach((lead, idx) => {
                    const newTime = new Date(now.getTime() + (i + idx) * 2 * 60 * 1000);
                    console.log(`  ✅ ${lead.name} → ${newTime.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' })}`);
                });
            }
        } else {
            console.error(`  ❌ Error: ${await updateRes.text()}`);
        }
    }

    console.log(`\n✅ ${updated} leads reprogramados`);
    console.log(`   Primeras 5 llamadas: inmediatas (ya son "due")`);
    console.log(`   Última llamada: ~${Math.round(withDate.length * 2 / 60)}h ${(withDate.length * 2) % 60}min desde ahora`);
}

main().catch(err => { console.error(err); process.exit(1); });
