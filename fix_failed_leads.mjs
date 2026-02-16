#!/usr/bin/env node
// Fix leads that were marked as Completado but actually had SIP errors
const API = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const LEADS = 'mgot1kl4sglenym';

async function run() {
    // Get Vapi calls that failed today (post-v3)
    const vapiRes = await fetch('https://api.vapi.ai/call?limit=30', {
        headers: { 'Authorization': 'Bearer 852080ba-ce7c-4778-b218-bf718613a2b6' }
    });
    const vapiCalls = await vapiRes.json();
    const todayFailed = vapiCalls.filter(c =>
        c.createdAt?.startsWith('2026-02-16') &&
        c.createdAt > '2026-02-16T11:30' &&
        (c.endedReason?.includes('failed-to-connect') || c.endedReason === 'customer-busy')
    );

    console.log(`Llamadas fallidas hoy (post-v3): ${todayFailed.length}`);

    const failedPhones = [...new Set(todayFailed.map(c => c.customer?.number))];
    console.log(`Teléfonos únicos: ${failedPhones.join(', ')}`);

    const retryDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    for (const phone of failedPhones) {
        const cleanPhone = phone.replace(/\D/g, '').replace(/^34/, '');
        const res = await fetch(`${API}/${LEADS}/records?where=(phone,like,%25${cleanPhone}%25)&fields=unique_id,name,phone,status,intentos&limit=1`, {
            headers: { 'xc-token': XC }
        });
        const data = await res.json();
        const lead = data.list?.[0];
        if (!lead) { console.log(`  ⚠️ No lead for ${phone}`); continue; }

        const intentos = parseInt(lead.intentos) || 0;

        if (lead.status === 'Completado') {
            const newStatus = intentos >= 1 ? 'Fallido' : 'Reintentar';
            const updates = {
                unique_id: lead.unique_id,
                status: newStatus,
                intentos: intentos + 1
            };
            if (newStatus === 'Reintentar') {
                updates.fecha_planificada = retryDate;
            } else {
                updates.fecha_planificada = null;
            }

            await fetch(`${API}/${LEADS}/records`, {
                method: 'PATCH',
                headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
                body: JSON.stringify([updates])
            });

            const icon = newStatus === 'Reintentar' ? '🔄' : '❌';
            console.log(`  ${icon} ${lead.name}: ${lead.status} → ${newStatus} (intentos: ${intentos + 1})`);
        } else {
            console.log(`  ℹ️ ${lead.name}: status=${lead.status} (no change)`);
        }
    }

    console.log('\n✅ Done');
}

run().catch(e => console.error(e));
