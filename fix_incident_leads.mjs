#!/usr/bin/env node
// Script para resetear leads que se marcaron como "Completado" erróneamente
// durante la ejecución masiva del 16/02/2026 ~10:26

const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const LEADS_TABLE = 'mgot1kl4sglenym';
const CALL_LOGS_TABLE = 'm013en5u2cyu30j';

async function main() {
    console.log('🔍 Buscando call logs con errores de concurrencia del incidente...\n');

    // 1. Fetch recent call logs that have concurrency errors
    let errorLogs = [];
    let offset = 0;
    const batchSize = 200;

    while (true) {
        const res = await fetch(`${API_BASE}/${CALL_LOGS_TABLE}/records?limit=${batchSize}&offset=${offset}&sort=-call_time`, {
            headers: { 'xc-token': XC_TOKEN }
        });
        const data = await res.json();
        const records = data.list || [];

        // Filter for error records from today around 10:26
        const errors = records.filter(r => {
            const reason = (r.ended_reason || '').toLowerCase();
            const callTime = r.call_time || '';
            return reason.includes('error') &&
                (reason.includes('concurrency') || reason.includes('over') || reason.includes('bad request') || reason.includes('subscription'));
        });

        errorLogs = errorLogs.concat(errors);
        if (records.length < batchSize) break;
        offset += batchSize;
        if (offset > 1000) break; // safety limit
    }

    console.log(`📊 Encontrados ${errorLogs.length} logs con errores de concurrencia\n`);

    if (errorLogs.length === 0) {
        console.log('✅ No se encontraron errores de concurrencia. Nada que resetear.');
        return;
    }

    // Show summary
    const phones = [...new Set(errorLogs.map(l => l.phone_called))];
    const names = [...new Set(errorLogs.map(l => l.lead_name))];
    console.log(`📞 Teléfonos afectados: ${phones.join(', ')}`);
    console.log(`👤 Empresas afectadas: ${names.join(', ')}`);
    console.log('');

    // 2. Now find leads that were incorrectly set to "Completado" 
    // Fetch leads with status "Completado" that have no fecha_planificada (was cleared)
    const leadsRes = await fetch(`${API_BASE}/${LEADS_TABLE}/records?limit=200&where=(status,eq,Completado)`, {
        headers: { 'xc-token': XC_TOKEN }
    });
    const leadsData = await leadsRes.json();
    const completedLeads = leadsData.list || [];

    console.log(`📋 Leads actualmente con status "Completado": ${completedLeads.length}`);

    // Find which ones match the error phones (these were incorrectly marked)
    const errorPhones = new Set(phones.map(p => p.replace(/\D/g, '')));

    // For leads that were incorrectly marked, we need to reset them
    // We'll identify them by checking if their phone matches error logs
    const leadsToReset = completedLeads.filter(lead => {
        const leadPhone = (lead.phone || '').toString().replace(/\D/g, '');
        // Check if this lead's phone was in the error calls
        for (const ep of errorPhones) {
            if (ep.includes(leadPhone) || leadPhone.includes(ep)) return true;
        }
        return false;
    });

    console.log(`🔄 Leads a resetear (matching error phones): ${leadsToReset.length}\n`);

    if (leadsToReset.length > 0) {
        console.log('Leads que se van a resetear a "Programado":');
        leadsToReset.forEach(l => {
            console.log(`  - ${l.name} | ${l.phone} | unique_id: ${l.unique_id}`);
        });

        console.log('\n⚠️  Para ejecutar el reset, ejecuta con --execute');

        if (process.argv.includes('--execute')) {
            console.log('\n🔄 Reseteando leads...');

            // Reset in batches of 10
            for (let i = 0; i < leadsToReset.length; i += 10) {
                const batch = leadsToReset.slice(i, i + 10);
                const updates = batch.map(l => ({
                    unique_id: l.unique_id,
                    status: 'Programado'
                }));

                const updateRes = await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                    method: 'PATCH',
                    headers: {
                        'xc-token': XC_TOKEN,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(updates)
                });

                if (updateRes.ok) {
                    console.log(`  ✅ Reseteados ${batch.length} leads (lote ${Math.floor(i / 10) + 1})`);
                } else {
                    console.error(`  ❌ Error reseteando lote: ${updateRes.status}`);
                }
            }

            console.log('\n✅ Reset completado!');
        }
    }

    // 3. Optionally clean up the error log entries
    console.log(`\n📝 Los ${errorLogs.length} logs de error se mantienen para referencia.`);
    console.log('   Puedes eliminarlos manualmente desde NocoDB si lo deseas.');
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
