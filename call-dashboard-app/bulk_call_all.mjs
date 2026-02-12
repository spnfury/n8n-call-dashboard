#!/usr/bin/env node
/**
 * Bulk Call Script — Llama a todos los leads con teléfono válido
 * que NO tienen fecha_planificada y NO están completados.
 * 
 * Concurrencia máxima: 8 llamadas simultáneas (máximo Vapi = 10)
 * 
 * Usage: node bulk_call_all.mjs [--dry-run] [--assistant marcos|violeta]
 */

const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const LEADS_TABLE = 'mgot1kl4sglenym';
const CALL_LOGS_TABLE = 'm013en5u2cyu30j';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';

const VAPI_API_KEY = '852080ba-ce7c-4778-b218-bf718613a2b6';
const VAPI_PHONE_NUMBER_ID = '611c8c8e-ab43-4af0-8df0-f2f8fac8115b';

const ASSISTANTS = {
    violeta: '49e56db1-1f20-4cf1-b031-9cea9fba73cb',
    marcos: 'f34469b5-334e-4fbf-b5ad-b2b05e8d76ee'
};

const BATCH_SIZE = 8;
const DELAY_BETWEEN_BATCHES_MS = 5000; // 5 second pause between batches
const DELAY_BETWEEN_CALLS_MS = 1000; // 1 second between individual calls in batch

// Parse args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const assistantArg = args.find(a => a.startsWith('--assistant'));
const assistantName = assistantArg ? args[args.indexOf(assistantArg) + 1] : 'violeta';
const ASSISTANT_ID = ASSISTANTS[assistantName] || ASSISTANTS.violeta;

function normalizePhone(phone) {
    let p = phone.toString().replace(/\D/g, '');
    if (!p) return '';
    return p.startsWith('34') ? '+' + p : '+34' + p;
}

async function fetchAllLeads() {
    const res = await fetch(`${API_BASE}/${LEADS_TABLE}/records?limit=200`, {
        headers: { 'xc-token': XC_TOKEN }
    });
    const data = await res.json();
    return data.list || [];
}

async function callLead(lead) {
    const phone = normalizePhone(lead.phone);
    const name = lead.name || 'Empresa';

    console.log(`  📞 Llamando a ${name} (${phone})...`);

    if (DRY_RUN) {
        console.log(`  ✅ [DRY RUN] Se llamaría a ${name} (${phone})`);
        return { success: true, dry: true, lead };
    }

    try {
        // 1. Initiate call via Vapi
        const vapiRes = await fetch('https://api.vapi.ai/call', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                customer: { number: phone },
                assistantId: ASSISTANT_ID,
                phoneNumberId: VAPI_PHONE_NUMBER_ID,
                assistantOverrides: {
                    variableValues: {
                        nombre: name,
                        empresa: lead.name || '',
                        tel_contacto: phone
                    }
                }
            })
        });

        const vapiData = await vapiRes.json();

        if (!vapiRes.ok) {
            console.log(`  ❌ Error Vapi para ${name}: ${vapiData.message || JSON.stringify(vapiData)}`);
            return { success: false, error: vapiData.message, lead };
        }

        console.log(`  ✅ Llamada iniciada para ${name} — Vapi ID: ${vapiData.id}`);

        // 2. Log to NocoDB call_logs
        try {
            await fetch(`${API_BASE}/${CALL_LOGS_TABLE}/records`, {
                method: 'POST',
                headers: {
                    'xc-token': XC_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    vapi_call_id: vapiData.id,
                    lead_name: name,
                    phone_called: phone,
                    call_time: new Date().toISOString(),
                    ended_reason: 'Bulk Call Trigger'
                })
            });
        } catch (logErr) {
            console.log(`  ⚠️ Log a NocoDB falló para ${name}: ${logErr.message}`);
        }

        // 3. Update lead status + clear fecha_planificada
        try {
            await fetch(`${API_BASE}/${LEADS_TABLE}/records`, {
                method: 'PATCH',
                headers: {
                    'xc-token': XC_TOKEN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify([{
                    unique_id: lead.unique_id,
                    status: 'Llamando...',
                    fecha_planificada: null
                }])
            });
        } catch (updateErr) {
            console.log(`  ⚠️ Update lead falló para ${name}: ${updateErr.message}`);
        }

        return { success: true, vapiId: vapiData.id, lead };
    } catch (err) {
        console.log(`  ❌ Error general para ${name}: ${err.message}`);
        return { success: false, error: err.message, lead };
    }
}

async function processBatch(batch, batchNum, totalBatches) {
    console.log(`\n🔄 Lote ${batchNum}/${totalBatches} — ${batch.length} llamadas`);
    console.log('─'.repeat(50));

    // Launch all calls in the batch concurrently
    const promises = batch.map((lead, i) => {
        return new Promise(async (resolve) => {
            // Small stagger within batch to avoid hammering the API
            await new Promise(r => setTimeout(r, i * DELAY_BETWEEN_CALLS_MS));
            const result = await callLead(lead);
            resolve(result);
        });
    });

    const results = await Promise.all(promises);

    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).length;

    console.log(`\n  📊 Lote ${batchNum}: ${successes} éxitos, ${failures} fallos`);

    return results;
}

async function main() {
    console.log('═'.repeat(60));
    console.log('🚀 BULK CALL SCRIPT — Llamando a todos los leads');
    console.log(`   Asistente: ${assistantName.toUpperCase()} (${ASSISTANT_ID.substring(0, 8)}...)`);
    if (DRY_RUN) console.log('   ⚠️  MODO DRY RUN — No se harán llamadas reales');
    console.log('═'.repeat(60));

    // 1. Fetch all leads
    const allLeads = await fetchAllLeads();
    console.log(`📋 Total leads en DB: ${allLeads.length}`);

    // 2. Filter eligible leads — include scheduled ones (we're overriding the scheduler)
    const eligible = allLeads.filter(lead => {
        const phone = lead.phone;
        if (!phone || phone === '0' || phone === 'N/A') return false;
        // Exclude test leads (Sergio entries)
        if ((lead.name || '').toLowerCase() === 'sergio') return false;
        const status = (lead.status || '').toLowerCase();
        if (status.includes('completado') || status.includes('llamando')) return false;
        return true;
    });

    console.log(`✅ Leads elegibles para llamar: ${eligible.length}`);

    if (eligible.length === 0) {
        console.log('ℹ️ No hay leads pendientes de llamar.');
        return;
    }

    // 3. Split into batches of BATCH_SIZE
    const batches = [];
    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
        batches.push(eligible.slice(i, i + BATCH_SIZE));
    }

    console.log(`📦 Dividido en ${batches.length} lotes de máximo ${BATCH_SIZE} llamadas`);

    // 4. Process each batch sequentially
    const allResults = [];
    for (let i = 0; i < batches.length; i++) {
        const results = await processBatch(batches[i], i + 1, batches.length);
        allResults.push(...results);

        // Wait between batches (except after the last one)
        if (i < batches.length - 1) {
            console.log(`\n⏳ Esperando ${DELAY_BETWEEN_BATCHES_MS / 1000}s antes del siguiente lote...`);
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
        }
    }

    // 5. Summary
    const totalSuccess = allResults.filter(r => r.success).length;
    const totalFail = allResults.filter(r => !r.success).length;

    console.log('\n' + '═'.repeat(60));
    console.log('📊 RESUMEN FINAL');
    console.log('═'.repeat(60));
    console.log(`   Total llamadas: ${allResults.length}`);
    console.log(`   ✅ Éxitos: ${totalSuccess}`);
    console.log(`   ❌ Fallos: ${totalFail}`);

    if (totalFail > 0) {
        console.log('\n   Leads con error:');
        allResults.filter(r => !r.success).forEach(r => {
            console.log(`     - ${r.lead.name}: ${r.error}`);
        });
    }

    console.log('\n✨ Script completado.');
}

main().catch(err => {
    console.error('💥 Error fatal:', err);
    process.exit(1);
});
