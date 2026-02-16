const API = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables/m013en5u2cyu30j';
const XC = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';

async function run() {
    const res = await fetch(`${API}/records?limit=200&where=(ended_reason,like,%25error-sip%25)&fields=id`, {
        headers: { 'xc-token': XC }
    });
    const d = await res.json();
    const ids = (d.list || []).map(r => ({ id: r.id }));
    console.log('Encontrados:', ids.length);
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        const r = await fetch(`${API}/records`, {
            method: 'DELETE',
            headers: { 'xc-token': XC, 'Content-Type': 'application/json' },
            body: JSON.stringify(batch)
        });
        console.log(`Eliminados ${batch.length} - ok: ${r.ok}`);
    }
    console.log('✅ Limpieza de errores SIP completa');
}
run();
