#!/usr/bin/env node
// Script para actualizar el workflow General Protect via n8n API
// Arregla: 1) Filtro WHERE en Get Leads2, 2) Conexión Under Limit?1 -> Wait For Slot1

const N8N_API = 'https://n8n.srv889387.hstgr.cloud/api/v1';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlMDIyMDljMS1mMWEzLTRhN2ItYjQ3MC0wYWM3MmJiMzljZWYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzcxMjM3ODEwLCJleHAiOjE3NzM3ODg0MDB9.ZNAmgm1OPjq8WRA0gPgdmU3CjsNYoyE2Z-arrWfA0LU';
const WORKFLOW_ID = '3twkEaNVmoeXwwUe';

async function main() {
    // 1. Get current workflow
    console.log('📥 Obteniendo workflow actual...');
    const getRes = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}`, {
        headers: { 'X-N8N-API-KEY': API_KEY }
    });
    const workflow = await getRes.json();

    console.log(`   Nombre: ${workflow.name}`);
    console.log(`   Nodos: ${workflow.nodes.length}`);
    console.log(`   Active: ${workflow.active}`);

    // 2. Fix Get Leads2 - add WHERE filter
    const getLeads2 = workflow.nodes.find(n => n.name === 'Get Leads2');
    if (getLeads2) {
        // Add the filter to options
        getLeads2.parameters.options = {
            ...(getLeads2.parameters.options || {}),
            filterByFormula: '(status,eq,Programado)'
        };
        console.log('\n✅ Fix 1: Añadido filtro (status,eq,Programado) a Get Leads2');
        console.log('   Parámetros actualizados:', JSON.stringify(getLeads2.parameters, null, 2));
    } else {
        console.log('❌ No se encontró el nodo Get Leads2');
        return;
    }

    // 3. Fix Under Limit?1 -> Wait For Slot1 connection
    const connections = workflow.connections;
    const underLimitConns = connections['Under Limit?1'];

    if (underLimitConns && underLimitConns.main) {
        // Check if output 1 (FALSE) already has a connection
        if (!underLimitConns.main[1] || underLimitConns.main[1].length === 0) {
            // Add the FALSE output connection to Wait For Slot1
            underLimitConns.main[1] = [
                {
                    node: 'Wait For Slot1',
                    type: 'main',
                    index: 0
                }
            ];
            console.log('\n✅ Fix 2: Conectado Under Limit?1 [FALSE] → Wait For Slot1');
        } else {
            console.log('\n✅ Fix 2: Conexión Under Limit?1 [FALSE] ya existe:',
                JSON.stringify(underLimitConns.main[1]));
        }
    } else {
        console.log('❌ No se encontró conexión para Under Limit?1');
        return;
    }

    // 4. Verify all connections
    console.log('\n📋 Conexiones del flujo de scheduled calls:');
    const scheduledNodes = ['Every 1 Minutes1', 'Get Leads2', 'Is Due Now?1', 'Limit Max ',
        'Split In Batches2', 'Check Active Calls1', 'Count Active1', 'Under Limit?1',
        'Wait For Slot1', 'Normalize Phone2', 'Prepare Call Data2', 'Call Vapi AI2',
        'Prepare Log2', 'Insert Log2', 'Update Lead Status2', 'Wait 30s2'];

    for (const nodeName of scheduledNodes) {
        const conn = connections[nodeName];
        if (conn && conn.main) {
            for (let i = 0; i < conn.main.length; i++) {
                const targets = conn.main[i];
                if (targets && targets.length > 0) {
                    const label = i > 0 ? ` [output ${i}]` : '';
                    const targetNames = targets.map(t => t.node).join(', ');
                    console.log(`   ${nodeName}${label} → ${targetNames}`);
                }
            }
        }
    }

    // 5. Update workflow (keeping it inactive!)
    console.log('\n📤 Actualizando workflow (manteniéndolo DESACTIVADO)...');

    const updatePayload = {
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings
    };

    const updateRes = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}`, {
        method: 'PUT',
        headers: {
            'X-N8N-API-KEY': API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
    });

    if (updateRes.ok) {
        const result = await updateRes.json();
        console.log(`\n✅ Workflow actualizado correctamente!`);
        console.log(`   Active: ${result.active} (debe ser false)`);
    } else {
        const errText = await updateRes.text();
        console.error(`\n❌ Error actualizando: ${updateRes.status} - ${errText}`);
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
