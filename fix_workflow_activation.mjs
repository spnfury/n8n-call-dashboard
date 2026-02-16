#!/usr/bin/env node
/**
 * Remove the result checker nodes that caused activation error,
 * keep the core changes (Llamando status, Reintentar in Get Leads),
 * and reactivate the workflow.
 */
const N8N_API = 'https://n8n.srv889387.hstgr.cloud/api/v1';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlMDIyMDljMS1mMWEzLTRhN2ItYjQ3MC0wYWM3MmJiMzljZWYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzcxMjM3ODEwLCJleHAiOjE3NzM3ODg0MDB9.ZNAmgm1OPjq8WRA0gPgdmU3CjsNYoyE2Z-arrWfA0LU';
const WF_ID = '3twkEaNVmoeXwwUe';

// IDs of the result checker nodes to remove
const REMOVE_IDS = [
    'result-checker-trigger',
    'get-llamando-leads',
    'find-call-log',
    'lookup-call-log',
    'check-vapi-status',
    'classify-result',
    'route-action',
    'update-completado',
    'update-reintentar',
    'update-fallido'
];

// Connection source names to remove
const REMOVE_CONN_NAMES = [
    'Check Results Every 5min',
    'Get Llamando Leads',
    'Prepare Lead Data',
    'Get Latest Call Log',
    'Get Vapi Call Status',
    'Classify Result',
    'Route Action'
];

async function main() {
    // 1. Get workflow
    const res = await fetch(`${N8N_API}/workflows/${WF_ID}`, {
        headers: { 'X-N8N-API-KEY': N8N_KEY }
    });
    const w = await res.json();
    console.log(`Before: ${w.nodes.length} nodes, active: ${w.active}`);

    // 2. Also revert Update Lead Status1 back to Completado
    // (we'll handle the retry logic externally instead)
    const updateNode = w.nodes.find(n => n.name === 'Update Lead Status1');
    if (updateNode) {
        const body = updateNode.parameters.jsonBody || '';
        if (body.includes('"Llamando"')) {
            updateNode.parameters.jsonBody = body.replace('"Llamando"', '"Completado"');
            console.log('  Reverted Update Lead Status1: Llamando → Completado');
        }
    }

    // 3. Remove result checker nodes
    w.nodes = w.nodes.filter(n => !REMOVE_IDS.includes(n.id));

    // Also remove the Mark Llamando node if it exists
    w.nodes = w.nodes.filter(n => n.id !== 'mark-llamando-00');

    // 4. Remove connections for removed nodes
    for (const name of REMOVE_CONN_NAMES) {
        delete w.connections[name];
    }
    // Also remove Mark Llamando connections
    delete w.connections['Mark Llamando'];

    console.log(`After: ${w.nodes.length} nodes`);

    // 5. Update workflow
    const updateRes = await fetch(`${N8N_API}/workflows/${WF_ID}`, {
        method: 'PUT',
        headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: w.name,
            nodes: w.nodes,
            connections: w.connections,
            settings: w.settings
        })
    });

    if (!updateRes.ok) {
        console.error('Update failed:', await updateRes.text());
        return;
    }
    console.log('✅ Workflow updated');

    // 6. Activate
    const actRes = await fetch(`${N8N_API}/workflows/${WF_ID}/activate`, {
        method: 'POST',
        headers: { 'X-N8N-API-KEY': N8N_KEY }
    });

    if (actRes.ok) {
        const actData = await actRes.json();
        console.log(`🟢 Workflow ACTIVATED: ${actData.active}`);
    } else {
        const err = await actRes.text();
        console.error('Activation failed:', err.substring(0, 300));
    }
}

main().catch(e => console.error(e));
