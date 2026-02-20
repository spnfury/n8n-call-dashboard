// Limpia duplicados: deja solo 1 registro por lead duplicado
const API = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables/m013en5u2cyu30j';
const XC = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';

async function run() {
    let all = [], offset = 0;
    while (true) {
        const r = await fetch(API + '/records?limit=200&offset=' + offset, { headers: { 'xc-token': XC } });
        const d = await r.json();
        all = all.concat(d.list || []);
        if (!d.list || d.list.length < 200) break;
        offset += 200;
    }
    console.log('Total registros:', all.length);

    // Group by lead_name + call_time (same second = duplicate)
    const groups = {};
    all.forEach(r => {
        const key = (r.lead_name || '') + '|' + (r.call_time || '').substring(0, 19);
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
    });

    // Find duplicates (groups with > 1 record)
    const toDelete = [];
    for (const [key, records] of Object.entries(groups)) {
        if (records.length > 1) {
            // Keep the first, delete the rest
            const keep = records[0];
            const dups = records.slice(1);
            console.log(`  ${records.length}x "${key.split('|')[0]}" → keeping id:${keep.id}, deleting ${dups.length}`);
            toDelete.push(...dups);
        }
    }

    console.log('\nTotal duplicados a borrar:', toDelete.length);

    if (toDelete.length === 0) {
        console.log('✅ No hay duplicados!');
        return;
    }

    if (!process.argv.includes('--execute')) {
        console.log('⚠️  Ejecuta con --execute para borrar');
        return;
    }

    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += 10) {
        const batch = toDelete.slice(i, i + 10).map(r => ({ id: r.id }));
        const res = await fetch(API + '/records', {
            method: 'DELETE',
            headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
            body: JSON.stringify(batch)
        });
        if (res.ok) deleted += batch.length;
    }
    console.log('✅ Eliminados:', deleted);
}
run();
