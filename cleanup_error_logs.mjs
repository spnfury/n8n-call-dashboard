const API_BASE = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables';
const XC_TOKEN = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';
const TABLE = 'm013en5u2cyu30j';

async function cleanAll() {
    console.log('🔍 Limpiando TODOS los registros con error...\n');

    let allErrors = [];
    let offset = 0;
    while (true) {
        const res = await fetch(`${API_BASE}/${TABLE}/records?limit=200&offset=${offset}`, { headers: { 'xc-token': XC_TOKEN } });
        const data = await res.json();
        const records = data.list || [];
        const errors = records.filter(r => (r.ended_reason || '').startsWith('Error'));
        allErrors = allErrors.concat(errors.map(e => e.id));
        if (records.length < 200) break;
        offset += 200;
    }

    console.log(`Errores encontrados: ${allErrors.length}`);

    if (allErrors.length === 0) {
        console.log('✅ Limpio!');
        return;
    }

    let deleted = 0;
    for (let i = 0; i < allErrors.length; i += 10) {
        const batch = allErrors.slice(i, i + 10).map(id => ({ id }));
        const res = await fetch(`${API_BASE}/${TABLE}/records`, {
            method: 'DELETE',
            headers: { 'xc-token': XC_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify(batch)
        });
        if (res.ok) {
            deleted += batch.length;
            process.stdout.write(`\r  Eliminados ${deleted}/${allErrors.length}`);
        }
    }
    console.log(`\n✅ ${deleted} errores eliminados.`);
}

cleanAll();
