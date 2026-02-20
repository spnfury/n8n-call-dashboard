#!/usr/bin/env node
// Script para aplicar las correcciones v3 al workflow General Protect via n8n API
// Reemplaza los nodos del flujo de scheduled calls con la versión corregida

const N8N_API = 'https://n8n.srv889387.hstgr.cloud/api/v1';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlMDIyMDljMS1mMWEzLTRhN2ItYjQ3MC0wYWM3MmJiMzljZWYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzcxMjM3ODEwLCJleHAiOjE3NzM3ODg0MDB9.ZNAmgm1OPjq8WRA0gPgdmU3CjsNYoyE2Z-arrWfA0LU';
const WORKFLOW_ID = '3twkEaNVmoeXwwUe';

import { readFileSync } from 'fs';

async function main() {
    // ─── 1. Get current workflow ──────────────────────────
    console.log('📥 Descargando workflow actual desde n8n...');
    const getRes = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}`, {
        headers: { 'X-N8N-API-KEY': API_KEY }
    });

    if (!getRes.ok) {
        console.error(`❌ Error obteniendo workflow: ${getRes.status}`);
        const txt = await getRes.text();
        console.error(txt);
        return;
    }

    const workflow = await getRes.json();
    console.log(`   Nombre: ${workflow.name}`);
    console.log(`   Nodos actuales: ${workflow.nodes.length}`);
    console.log(`   Active: ${workflow.active}`);

    // ─── 2. Load v3 corrections ──────────────────────────
    console.log('\n📂 Cargando correcciones v3...');
    const v3 = JSON.parse(readFileSync('./n8n_scheduled_calls_v3.json', 'utf-8'));
    console.log(`   Nodos en v3: ${v3.nodes.length}`);

    // ─── 3. Identify scheduled call nodes to replace ─────
    // The workflow has TWO flows: webhook flow + scheduled calls flow
    // We need to replace only the scheduled calls nodes

    // Names of the old scheduled call nodes (might have different suffixes)
    const scheduledNodeNames = new Set([
        'Every 1 Minutes', 'Every 1 Minutes1', 'Every 2 Minutes',
        'Get Leads', 'Get Leads1', 'Get Leads2',
        'Is Due Now?', 'Is Due Now?1',
        'Limit Max 5', 'Limit Max ',
        'Split In Batches', 'Split In Batches1', 'Split In Batches2',
        'Check Active Calls', 'Check Active Calls1',
        'Count Active', 'Count Active1',
        'Under Limit?', 'Under Limit?1',
        'Wait For Slot', 'Wait For Slot1',
        'Normalize Phone', 'Normalize Phone1', 'Normalize Phone2',
        'Prepare Call Data', 'Prepare Call Data1', 'Prepare Call Data2',
        'Call Vapi AI', 'Call Vapi AI1', 'Call Vapi AI2',
        'Prepare Log', 'Prepare Log1', 'Prepare Log2',
        'Insert Log', 'Insert Log1', 'Insert Log2',
        'Update Lead Status', 'Update Lead Status1', 'Update Lead Status2',
        'Wait 30s', 'Wait 30s1', 'Wait 30s2',
        'Filter Due (Safe)',           // new in v3
        'Limit Max 3',                 // new in v3
        'Validate Phone',             // new in v3
        'Phone Valid?',                // new in v3
        'Call Succeeded?',             // new in v3
        'Should Update?',             // new in v3
    ]);

    // Webhook/confirmed data flow node names (KEEP these!)
    const webhookNodeNames = new Set([
        'Webhook', 'Webhook1',
        'Respond Immediately', 'Respond Immediately1',
        'Extract Data', 'Extract Data1',
        'Has Valid Data?', 'Has Valid Data?1',
        'Get Latest Vapi Call', 'Get Latest Vapi Call1',
        'Prepare Confirmed Record', 'Prepare Confirmed Record1',
        'Insert Confirmed Table', 'Insert Confirmed Table1',
        'Mark Call as Confirmed', 'Mark Call as Confirmed1',
    ]);

    // Remove old scheduled call nodes
    const keptNodes = workflow.nodes.filter(n => {
        // Keep if it's a webhook flow node
        if (webhookNodeNames.has(n.name)) return true;
        // Remove if it's definitely a scheduled call node
        if (scheduledNodeNames.has(n.name)) return false;
        // Keep anything else (we don't know what it is)
        return true;
    });

    const removedCount = workflow.nodes.length - keptNodes.length;
    console.log(`\n🔄 Nodos existentes que se mantienen: ${keptNodes.length}`);
    console.log(`   Nodos eliminados (scheduled calls viejos): ${removedCount}`);

    // ─── 4. Add v3 scheduled call nodes ──────────────────
    // Only add the scheduled call nodes from v3 (not the webhook ones, since those already exist)
    const v3ScheduledNodes = v3.nodes.filter(n => !webhookNodeNames.has(n.name));
    console.log(`   Nodos nuevos de v3 a añadir: ${v3ScheduledNodes.length}`);

    const newNodes = [...keptNodes, ...v3ScheduledNodes];
    console.log(`   Total nodos resultado: ${newNodes.length}`);

    // ─── 5. Update connections ───────────────────────────
    // Remove old scheduled connections, keep webhook connections
    const newConnections = {};

    // Keep existing webhook flow connections
    for (const [nodeName, conn] of Object.entries(workflow.connections)) {
        if (webhookNodeNames.has(nodeName)) {
            newConnections[nodeName] = conn;
        }
    }

    // Add all v3 connections (both scheduled and webhook overrides)
    for (const [nodeName, conn] of Object.entries(v3.connections)) {
        // For webhook nodes, prefer existing connections (they're already correct)
        if (!webhookNodeNames.has(nodeName)) {
            newConnections[nodeName] = conn;
        }
    }

    console.log(`   Conexiones resultado: ${Object.keys(newConnections).length}`);

    // ─── 6. Show summary of changes ─────────────────────
    console.log('\n📋 Nodos en el workflow actualizado:');
    for (const n of newNodes) {
        const isNew = v3ScheduledNodes.some(v => v.name === n.name);
        const marker = isNew ? '🆕' : '  ';
        console.log(`   ${marker} ${n.name} (${n.type})`);
    }

    // ─── 7. Deactivate first, then update ────────────────
    if (workflow.active) {
        console.log('\n⏸️  Desactivando workflow primero...');
        const deactivateRes = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}/deactivate`, {
            method: 'POST',
            headers: { 'X-N8N-API-KEY': API_KEY }
        });
        if (deactivateRes.ok) {
            console.log('   ✅ Desactivado');
        } else {
            console.error(`   ❌ Error desactivando: ${deactivateRes.status}`);
        }
    }

    // ─── 8. Push the update ──────────────────────────────
    console.log('\n📤 Subiendo workflow actualizado a n8n...');

    const updatePayload = {
        name: workflow.name,
        nodes: newNodes,
        connections: newConnections,
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
        console.log(`   Nombre: ${result.name}`);
        console.log(`   Nodos: ${result.nodes.length}`);
        console.log(`   Active: ${result.active} (desactivado para revisión)`);
    } else {
        const errText = await updateRes.text();
        console.error(`\n❌ Error actualizando: ${updateRes.status}`);
        console.error(errText);
        return;
    }

    // ─── 9. Ask before activating ────────────────────────
    if (process.argv.includes('--activate')) {
        console.log('\n🔄 Activando workflow...');
        const activateRes = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}/activate`, {
            method: 'POST',
            headers: { 'X-N8N-API-KEY': API_KEY }
        });
        if (activateRes.ok) {
            console.log('✅ Workflow ACTIVADO y funcionando!');
        } else {
            console.error(`❌ Error activando: ${activateRes.status}`);
        }
    } else {
        console.log('\n⚠️  Workflow guardado pero DESACTIVADO.');
        console.log('   Para activarlo ejecuta: node deploy_workflow_v3.mjs --activate');
        console.log('   O actívalo manualmente desde la interfaz de n8n.');
    }
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
