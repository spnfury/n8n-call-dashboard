#!/usr/bin/env node
// Limpia nodos huérfanos del workflow y activa

const N8N_API = 'https://n8n.srv889387.hstgr.cloud/api/v1';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlMDIyMDljMS1mMWEzLTRhN2ItYjQ3MC0wYWM3MmJiMzljZWYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzcxMjM3ODEwLCJleHAiOjE3NzM3ODg0MDB9.ZNAmgm1OPjq8WRA0gPgdmU3CjsNYoyE2Z-arrWfA0LU';
const WORKFLOW_ID = '3twkEaNVmoeXwwUe';

async function main() {
    // 1. Get workflow
    console.log('📥 Descargando workflow...');
    const res = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}`, {
        headers: { 'X-N8N-API-KEY': API_KEY }
    });
    const wf = await res.json();
    console.log(`   Nodos: ${wf.nodes.length}`);

    // 2. Identify orphans to remove
    const orphanNames = new Set([
        'Webhook2', 'Respond Immediately2', 'Extract Data2',
        'Has Valid Data?2', 'Get Latest Vapi Call2', 'Prepare Confirmed Record2',
        'Insert Confirmed Table2', 'Mark Call as Confirmed2',
        'Mark Llamando',
        'Validate Phone', 'Phone Valid?'
    ]);

    // Check for duplicate "Mark Llamando" 
    const markLlamandoNodes = wf.nodes.filter(n => n.name === 'Mark Llamando');
    console.log(`   "Mark Llamando" duplicados: ${markLlamandoNodes.length}`);

    const cleanNodes = wf.nodes.filter(n => !orphanNames.has(n.name));
    const removed = wf.nodes.length - cleanNodes.length;
    console.log(`\n🗑️  Eliminando ${removed} nodos huérfanos`);
    orphanNames.forEach(n => {
        const existed = wf.nodes.some(node => node.name === n);
        if (existed) console.log(`   - ${n}`);
    });

    // 3. Clean connections too
    const cleanConnections = {};
    for (const [name, conn] of Object.entries(wf.connections)) {
        if (!orphanNames.has(name)) {
            cleanConnections[name] = conn;
        }
    }

    console.log(`\n   Nodos resultado: ${cleanNodes.length}`);
    console.log(`   Conexiones resultado: ${Object.keys(cleanConnections).length}`);

    // 4. Update
    console.log('\n📤 Actualizando workflow...');
    const updateRes = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}`, {
        method: 'PUT',
        headers: {
            'X-N8N-API-KEY': API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: wf.name,
            nodes: cleanNodes,
            connections: cleanConnections,
            settings: wf.settings
        })
    });

    if (!updateRes.ok) {
        console.error(`❌ Error: ${updateRes.status} - ${await updateRes.text()}`);
        return;
    }

    const result = await updateRes.json();
    console.log(`✅ Actualizado: ${result.nodes.length} nodos`);

    // 5. Activate
    console.log('\n🔄 Activando workflow...');
    const activateRes = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}/activate`, {
        method: 'POST',
        headers: { 'X-N8N-API-KEY': API_KEY }
    });

    if (activateRes.ok) {
        const activated = await activateRes.json();
        console.log(`\n✅ Workflow "${activated.name}" ACTIVADO!`);
        console.log(`   Nodos: ${activated.nodes.length}`);
        console.log(`   Active: ${activated.active}`);
    } else {
        console.error(`❌ Error activando: ${activateRes.status} - ${await activateRes.text()}`);
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
