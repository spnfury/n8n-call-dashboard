#!/usr/bin/env node
/**
 * Deploys retry logic to the n8n workflow:
 * 
 * CHANGES:
 * 1. Update Lead Status1: marks as "Llamando" instead of "Completado"
 * 2. Get Leads1 WHERE: also picks up "Reintentar" leads  
 * 3. NEW: "Check Call Results" branch (every 5 min):
 *    - Gets leads with status="Llamando"
 *    - For each, finds call log vapi_call_id
 *    - Queries Vapi for final status
 *    - Routes to: Completado / Reintentar / Fallido
 */

const N8N_API = 'https://n8n.srv889387.hstgr.cloud/api/v1';
const N8N_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlMDIyMDljMS1mMWEzLTRhN2ItYjQ3MC0wYWM3MmJiMzljZWYiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzcxMjM3ODEwLCJleHAiOjE3NzM3ODg0MDB9.ZNAmgm1OPjq8WRA0gPgdmU3CjsNYoyE2Z-arrWfA0LU';
const WORKFLOW_ID = '3twkEaNVmoeXwwUe';

const DRY_RUN = !process.argv.includes('--execute');
const ACTIVATE = process.argv.includes('--activate');

// ─── New nodes for Result Checker ───

const RESULT_CHECKER_TRIGGER = {
    parameters: {
        rule: { interval: [{ field: "minutes", minutesInterval: 5 }] }
    },
    id: "result-checker-trigger",
    name: "Check Results Every 5min",
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.1,
    position: [1220, 4900]
};

const GET_LLAMANDO_LEADS = {
    parameters: {
        authentication: "nocoDbApiToken",
        operation: "getAll",
        projectId: "p5xxqp29w9h8sb6",
        table: "mgot1kl4sglenym",
        returnAll: true,
        where: "(status,eq,Llamando)",
        options: {}
    },
    id: "get-llamando-leads",
    name: "Get Llamando Leads",
    type: "n8n-nodes-base.nocoDb",
    typeVersion: 3,
    position: [1440, 4900],
    credentials: { nocoDbApiToken: { id: "tV5VwP4BVmME7Vgo", name: "NocoDB Token account" } }
};

const FIND_CALL_LOG = {
    parameters: {
        jsCode: `// For each lead in "Llamando" status, find the most recent call log
const items = $input.all();
const results = [];

for (const item of items) {
  const leadName = item.json.name || '';
  const phone = (item.json.phone || '').replace(/\\D/g, '');
  const formattedPhone = phone ? (phone.startsWith('34') ? '+' + phone : '+34' + phone) : '';
  
  results.push({
    json: {
      leadId: item.json.unique_id,
      leadName,
      phone: formattedPhone,
      intentos: parseInt(item.json.intentos) || 0,
      address: item.json.address || ''
    }
  });
}

return results;`
    },
    id: "find-call-log",
    name: "Prepare Lead Data",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1660, 4900]
};

const LOOKUP_VAPI_CALL = {
    parameters: {
        authentication: "nocoDbApiToken",
        operation: "getAll",
        projectId: "p5xxqp29w9h8sb6",
        table: "m013en5u2cyu30j",
        returnAll: false,
        limit: 1,
        where: "=(phone_called,eq,{{ $json.phone }})",
        options: { sort: { sortRules: [{ field: "call_time", direction: "desc" }] } }
    },
    id: "lookup-call-log",
    name: "Get Latest Call Log",
    type: "n8n-nodes-base.nocoDb",
    typeVersion: 3,
    position: [1880, 4900],
    credentials: { nocoDbApiToken: { id: "tV5VwP4BVmME7Vgo", name: "NocoDB Token account" } }
};

const CHECK_VAPI_STATUS = {
    parameters: {
        url: "=https://api.vapi.ai/call/{{ $json.vapi_call_id }}",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: {
            parameters: [{ name: "Authorization", value: "Bearer 852080ba-ce7c-4778-b218-bf718613a2b6" }]
        },
        options: {}
    },
    id: "check-vapi-status",
    name: "Get Vapi Call Status",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [2100, 4900],
    credentials: { httpHeaderAuth: { id: "VyoKa0HV9ZpyrdVx", name: "Header Auth account" } },
    onError: "continueErrorOutput"
};

const CLASSIFY_RESULT = {
    parameters: {
        jsCode: `// Classify the call result and decide lead status
const vapiData = $json;
const leadId = $('Prepare Lead Data').item.json.leadId;
const leadName = $('Prepare Lead Data').item.json.leadName;
const intentos = $('Prepare Lead Data').item.json.intentos || 0;
const status = vapiData.status || 'unknown';
const endedReason = vapiData.endedReason || '';

// Still in progress? Skip
if (['queued', 'ringing', 'in-progress'].includes(status)) {
  console.log(\`⏳ \${leadName}: still \${status}, will check next cycle\`);
  return [{ json: { action: 'skip', leadId, leadName } }];
}

// SIP errors → retry or fail
const isSipError = endedReason.includes('failed-to-connect') ||
                   endedReason.includes('providerfault') ||
                   endedReason.includes('sip-503') ||
                   endedReason.includes('service-unavailable');

// Customer busy → retry
const isBusy = endedReason === 'customer-busy' || endedReason === 'customer-did-not-answer';

if (isSipError || isBusy) {
  const newIntentos = intentos + 1;
  if (newIntentos >= 2) {
    console.log(\`❌ \${leadName}: \${endedReason} (intento \${newIntentos}/2) → FALLIDO\`);
    return [{ json: { action: 'fallido', leadId, leadName, intentos: newIntentos, reason: endedReason } }];
  } else {
    // Schedule retry in 30 minutes
    const retryDate = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    console.log(\`🔄 \${leadName}: \${endedReason} (intento \${newIntentos}/2) → REINTENTAR en 30min\`);
    return [{ json: { action: 'reintentar', leadId, leadName, intentos: newIntentos, retryDate, reason: endedReason } }];
  }
}

// Success cases → Completado
console.log(\`✅ \${leadName}: \${endedReason} → COMPLETADO\`);
return [{ json: { action: 'completado', leadId, leadName, reason: endedReason } }];`
    },
    id: "classify-result",
    name: "Classify Result",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [2320, 4900]
};

const ROUTE_ACTION = {
    parameters: {
        rules: {
            values: [
                { outputKey: "completado", conditions: { conditions: [{ leftValue: "={{ $json.action }}", operator: { type: "string", operation: "equals" }, rightValue: "completado" }] } },
                { outputKey: "reintentar", conditions: { conditions: [{ leftValue: "={{ $json.action }}", operator: { type: "string", operation: "equals" }, rightValue: "reintentar" }] } },
                { outputKey: "fallido", conditions: { conditions: [{ leftValue: "={{ $json.action }}", operator: { type: "string", operation: "equals" }, rightValue: "fallido" }] } }
            ]
        },
        options: { fallbackOutput: "extra" }
    },
    id: "route-action",
    name: "Route Action",
    type: "n8n-nodes-base.switch",
    typeVersion: 3.2,
    position: [2540, 4900]
};

const UPDATE_COMPLETADO = {
    parameters: {
        method: "PATCH",
        url: "https://nocodb.srv889387.hstgr.cloud/api/v2/tables/mgot1kl4sglenym/records",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "xc-token", value: "jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: '=[{"unique_id": "{{ $json.leadId }}", "status": "Completado", "fecha_planificada": null}]',
        options: {}
    },
    id: "update-completado",
    name: "Mark Completado",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [2760, 4780]
};

const UPDATE_REINTENTAR = {
    parameters: {
        method: "PATCH",
        url: "https://nocodb.srv889387.hstgr.cloud/api/v2/tables/mgot1kl4sglenym/records",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "xc-token", value: "jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: '=[{"unique_id": "{{ $json.leadId }}", "status": "Reintentar", "intentos": {{ $json.intentos }}, "fecha_planificada": "{{ $json.retryDate }}"}]',
        options: {}
    },
    id: "update-reintentar",
    name: "Mark Reintentar",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [2760, 4900]
};

const UPDATE_FALLIDO = {
    parameters: {
        method: "PATCH",
        url: "https://nocodb.srv889387.hstgr.cloud/api/v2/tables/mgot1kl4sglenym/records",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "xc-token", value: "jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: '=[{"unique_id": "{{ $json.leadId }}", "status": "Fallido", "intentos": {{ $json.intentos }}, "fecha_planificada": null}]',
        options: {}
    },
    id: "update-fallido",
    name: "Mark Fallido",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [2760, 5020]
};

const NEW_NODES = [
    RESULT_CHECKER_TRIGGER,
    GET_LLAMANDO_LEADS,
    FIND_CALL_LOG,
    LOOKUP_VAPI_CALL,
    CHECK_VAPI_STATUS,
    CLASSIFY_RESULT,
    ROUTE_ACTION,
    UPDATE_COMPLETADO,
    UPDATE_REINTENTAR,
    UPDATE_FALLIDO
];

const NEW_CONNECTIONS = {
    "Check Results Every 5min": { main: [[{ node: "Get Llamando Leads", type: "main", index: 0 }]] },
    "Get Llamando Leads": { main: [[{ node: "Prepare Lead Data", type: "main", index: 0 }]] },
    "Prepare Lead Data": { main: [[{ node: "Get Latest Call Log", type: "main", index: 0 }]] },
    "Get Latest Call Log": { main: [[{ node: "Get Vapi Call Status", type: "main", index: 0 }]] },
    "Get Vapi Call Status": {
        main: [
            [{ node: "Classify Result", type: "main", index: 0 }],
            [{ node: "Classify Result", type: "main", index: 0 }]
        ]
    },
    "Classify Result": { main: [[{ node: "Route Action", type: "main", index: 0 }]] },
    "Route Action": {
        main: [
            [{ node: "Mark Completado", type: "main", index: 0 }],
            [{ node: "Mark Reintentar", type: "main", index: 0 }],
            [{ node: "Mark Fallido", type: "main", index: 0 }],
            [] // skip
        ]
    }
};

async function main() {
    console.log('🔧 DEPLOY: Retry Logic for Failed Calls');
    console.log('='.repeat(50));
    if (DRY_RUN) console.log('⚠️  DRY-RUN: use --execute --activate to deploy\n');

    // 1. Fetch current workflow
    const res = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}`, {
        headers: { 'X-N8N-API-KEY': N8N_KEY }
    });
    const workflow = await res.json();
    console.log(`📋 Workflow: ${workflow.name} | Active: ${workflow.active} | Nodes: ${workflow.nodes.length}`);

    // 2. Modifications to existing nodes
    let modified = 0;

    // 2a. Change Update Lead Status1 to mark as "Llamando"
    const updateNode = workflow.nodes.find(n => n.name === 'Update Lead Status1');
    if (updateNode) {
        const oldBody = updateNode.parameters.jsonBody;
        if (oldBody && oldBody.includes('"Completado"')) {
            updateNode.parameters.jsonBody = oldBody.replace('"Completado"', '"Llamando"');
            console.log('  ✏️  Update Lead Status1: Completado → Llamando');
            modified++;
        } else {
            console.log('  ℹ️  Update Lead Status1 already modified or different format');
        }
    }

    // 2b. Change Get Leads1 WHERE to include Reintentar
    const getLeadsNode = workflow.nodes.find(n => n.name === 'Get Leads1');
    if (getLeadsNode) {
        const where = getLeadsNode.parameters.where;
        if (where === '(status,eq,Programado)') {
            getLeadsNode.parameters.where = '(status,eq,Programado)~or(status,eq,Reintentar)';
            console.log('  ✏️  Get Leads1 WHERE: added Reintentar');
            modified++;
        } else if (where.includes('Reintentar')) {
            console.log('  ℹ️  Get Leads1 already includes Reintentar');
        }
    }

    // 3. Add new Result Checker nodes (skip if already exist)
    let added = 0;
    for (const node of NEW_NODES) {
        const exists = workflow.nodes.find(n => n.id === node.id || n.name === node.name);
        if (!exists) {
            workflow.nodes.push(node);
            added++;
        }
    }
    console.log(`  ➕ Added ${added} new nodes for Result Checker`);

    // 4. Add new connections
    for (const [source, conns] of Object.entries(NEW_CONNECTIONS)) {
        if (!workflow.connections[source]) {
            workflow.connections[source] = conns;
        }
    }
    console.log('  🔗 Connections updated');

    console.log(`\n📊 Final: ${workflow.nodes.length} nodes, ${modified} modified, ${added} added`);

    if (DRY_RUN) {
        console.log('\n⚠️  Run with --execute --activate to deploy');
        return;
    }

    // 5. Deactivate first
    if (workflow.active) {
        await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}/deactivate`, {
            method: 'POST',
            headers: { 'X-N8N-API-KEY': N8N_KEY }
        });
        console.log('  ⏸️  Workflow deactivated');
    }

    // 6. Update workflow
    const updateRes = await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}`, {
        method: 'PUT',
        headers: {
            'X-N8N-API-KEY': N8N_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: workflow.name,
            nodes: workflow.nodes,
            connections: workflow.connections,
            settings: workflow.settings
        })
    });

    if (!updateRes.ok) {
        const err = await updateRes.text();
        console.error('❌ Update failed:', err.substring(0, 500));
        return;
    }
    console.log('  ✅ Workflow updated');

    // 7. Activate if requested
    if (ACTIVATE) {
        await fetch(`${N8N_API}/workflows/${WORKFLOW_ID}/activate`, {
            method: 'POST',
            headers: { 'X-N8N-API-KEY': N8N_KEY }
        });
        console.log('  🟢 Workflow activated');
    } else {
        console.log('  ⚠️  Workflow NOT activated (use --activate)');
    }

    console.log('\n✅ DEPLOY COMPLETE');
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
