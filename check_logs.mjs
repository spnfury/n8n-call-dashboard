const API = 'https://nocodb.srv889387.hstgr.cloud/api/v2/tables/m013en5u2cyu30j';
const XC = 'jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww';

async function run() {
    const r = await fetch(API + '/records?limit=200&sort=-call_time', { headers: { 'xc-token': XC } });
    const d = await r.json();
    const list = d.list || [];

    const names = {};
    list.forEach(l => {
        const n = l.lead_name || '?';
        names[n] = (names[n] || 0) + 1;
    });
    console.log('Registros por lead_name:');
    Object.entries(names).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
        console.log('  ' + v + 'x ' + k);
    });
    console.log('\nTotal registros:', list.length);

    const isTest = c => c.is_test === true || c.is_test === 1 ||
        (c.ended_reason || '').includes('Manual Trigger') ||
        (c.lead_name || '').toLowerCase() === 'test manual';
    const tests = list.filter(isTest);
    const camp = list.filter(c => !isTest(c));
    console.log('Tests:', tests.length);
    console.log('Campaign:', camp.length);
}
run();
