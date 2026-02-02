#!/usr/bin/env python3
"""
Script to import Vapi call logs into NocoDB call_logs table.
"""
import requests
import json

# NocoDB Configuration
API_BASE = "https://nocodb.srv889387.hstgr.cloud/api/v2/tables"
CALL_LOGS_TABLE = "m013en5u2cyu30j"
XC_TOKEN = "jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww"

# Vapi call data (extracted from user's input)
vapi_calls = [
    {
        "id": "019c1f1a-5961-799f-8b40-a51384694101",
        "customer": {"number": "+34986205431"},
        "createdAt": "2026-02-02T16:05:46.465Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Informaticos Tepeyac Sl.",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-5953-7113-96bb-319dd52990d1",
        "customer": {"number": "+34984293645"},
        "createdAt": "2026-02-02T16:05:46.451Z",
        "endedReason": "call.in-progress.error-sip-outbound-call-failed-to-connect",
        "empresa": "Servicios Tecnicos Informaticos Asturias Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-593b-7ccb-8537-45fd4a64eee5",
        "customer": {"number": "+34986543743"},
        "createdAt": "2026-02-02T16:05:46.427Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Informaticos Avanzados De Galicia Sl.",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-592f-7225-a951-e9bc3bb75913",
        "customer": {"number": "+34969127685"},
        "createdAt": "2026-02-02T16:05:46.415Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Grupo Empresarial Acecom Sociedad Limitada.",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-592a-7aa7-95ab-930039dde841",
        "customer": {"number": "+34943894014"},
        "createdAt": "2026-02-02T16:05:46.410Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Informaticos Zarauz Siz Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-5913-7ccb-8537-3fbc5c0a27e3",
        "customer": {"number": "+34943383265"},
        "createdAt": "2026-02-02T16:05:46.387Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Informaticos Bidasoa Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-590a-7aa7-95ab-8dd98d56e11c",
        "customer": {"number": "+34918448287"},
        "createdAt": "2026-02-02T16:05:46.378Z",
        "endedReason": "customer-did-not-answer",
        "empresa": "Servicios Informaticos De Auditoria Fiscal Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-5904-7113-96bb-2c779afaea9a",
        "customer": {"number": "+34937124236"},
        "createdAt": "2026-02-02T16:05:46.372Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Informaticos Idemas Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-58f0-7ee4-9f3e-d6a25868dbcb",
        "customer": {"number": "+34954670911"},
        "createdAt": "2026-02-02T16:05:46.352Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Informaticos Y Economicos Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-58ee-7ee4-9f3e-ca842829881c",
        "customer": {"number": "+34974415571"},
        "createdAt": "2026-02-02T16:05:46.350Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Y Productos Informaticos Monzon S.l.",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-58df-766b-b9dc-aa1ee42f768a",
        "customer": {"number": "+34965566353"},
        "createdAt": "2026-02-02T16:05:46.335Z",
        "endedReason": "customer-did-not-answer",
        "empresa": "Servicios Informaticos System Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-58d8-7665-96b7-8fde457afb20",
        "customer": {"number": "+34963753847"},
        "createdAt": "2026-02-02T16:05:46.328Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Informaticos Oltra Sebastian Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-58d8-7ee4-9f3e-c6646ffff6c5",
        "customer": {"number": "+34954789833"},
        "createdAt": "2026-02-02T16:05:46.328Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Informaticos A Tope Sociedad Limitada.",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-58ce-733f-a27d-16e42b73357b",
        "customer": {"number": "+34955514167"},
        "createdAt": "2026-02-02T16:05:46.318Z",
        "endedReason": "assistant-ended-call",
        "empresa": "Tkt Servicios Informaticos Sociedad Limitada.",
        "transcript": "AI: Hola, ¿qué tal? Soy Violeta, del equipo de GeneralProTech. Me gustaría hablar con el responsable de la empresa, ¿eres tú?\nUser: Si quiere hablar con compras, marque dos...",
        "recordingUrl": "https://storage.vapi.ai/019c1f1a-58ce-733f-a27d-16e42b73357b-1770048383006-73e85b3c-01bb-4693-a7d8-85931610a9d6-mono.wav"
    },
    {
        "id": "019c1f1a-58bf-7ee0-b814-a144a9258a4b",
        "customer": {"number": "+34986772343"},
        "createdAt": "2026-02-02T16:05:46.303Z",
        "endedReason": "call.in-progress.error-sip-outbound-call-failed-to-connect",
        "empresa": "Servicios Informaticos Combarro Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-58a9-7778-a60f-628376bf37de",
        "customer": {"number": "+34976868197"},
        "createdAt": "2026-02-02T16:05:46.281Z",
        "endedReason": "voicemail",
        "empresa": "Servicios Informaticos Moncayo Sl",
        "transcript": "AI: Hola, ¿qué tal? Soy Violeta, del equipo de General Protect. Me gustaría hablar con el responsa--",
        "recordingUrl": "https://storage.vapi.ai/019c1f1a-58a9-7778-a60f-628376bf37de-1770048387194-abd10540-2ebe-433e-a8fa-46d7d4028ae4-mono.wav"
    },
    {
        "id": "019c1f1a-589f-7ccb-8537-3325c79a322d",
        "customer": {"number": "+34916326950"},
        "createdAt": "2026-02-02T16:05:46.271Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Informaticos Palomares Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-589b-7007-9559-48ea1708e556",
        "customer": {"number": "+34983315073"},
        "createdAt": "2026-02-02T16:05:46.267Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Servicios Informaticos Ancada Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1f1a-588d-7445-ab20-e6eb4761a9d0",
        "customer": {"number": "+34976233905"},
        "createdAt": "2026-02-02T16:05:46.253Z",
        "endedReason": "call.in-progress.error-providerfault-outbound-sip-503-service-unavailable",
        "empresa": "Grupo 9lands Sl",
        "transcript": "",
        "recordingUrl": ""
    },
    {
        "id": "019c1e77-cbc8-7778-a529-1886207388a6",
        "customer": {"number": "+34976233905"},
        "createdAt": "2026-02-02T13:08:13.384Z",
        "endedReason": "customer-ended-call",
        "empresa": "Grupo 9lands Sl",
        "transcript": "AI: Hola, ¿qué tal? Soy Violeta del equipo de Generalprotec. Me gustaría hablar con el responsable de la empresa, ¿eres tú?",
        "recordingUrl": "https://storage.vapi.ai/019c1e77-cbc8-7778-a529-1886207388a6-1770037719180-3a920ebd-0356-4d83-9622-c38d4edfb157-mono.wav"
    }
]

def simplify_ended_reason(reason):
    """Convert long Vapi error codes to readable format"""
    if not reason:
        return "Unknown"
    if "503" in reason or "service-unavailable" in reason.lower():
        return "Service Unavailable"
    if "failed-to-connect" in reason.lower():
        return "Failed to Connect"
    if "customer-did-not-answer" in reason.lower():
        return "No Answer"
    if "customer-ended-call" in reason.lower():
        return "Customer Ended Call"
    if "assistant-ended-call" in reason.lower():
        return "Call Completed"
    if "voicemail" in reason.lower():
        return "Voicemail"
    return reason[:50] if len(reason) > 50 else reason

def insert_call_log(call_data):
    """Insert a single call log into NocoDB"""
    url = f"{API_BASE}/{CALL_LOGS_TABLE}/records"
    
    record = {
        "lead_id": call_data.get("id", ""),
        "lead_name": call_data.get("empresa", ""),
        "phone_called": call_data.get("customer", {}).get("number", ""),
        "call_time": call_data.get("createdAt", ""),
        "ended_reason": simplify_ended_reason(call_data.get("endedReason", "")),
        "transcript": call_data.get("transcript", "") or "",
        "recording_url": call_data.get("recordingUrl", "") or ""
    }
    
    response = requests.post(
        url,
        headers={"xc-token": XC_TOKEN, "Content-Type": "application/json"},
        json=record
    )
    
    return response.status_code == 200 or response.status_code == 201

def main():
    print(f"Importing {len(vapi_calls)} call logs to NocoDB...")
    
    success_count = 0
    error_count = 0
    
    for call in vapi_calls:
        if insert_call_log(call):
            success_count += 1
            print(f"✓ Imported: {call.get('empresa', 'Unknown')[:40]}")
        else:
            error_count += 1
            print(f"✗ Error: {call.get('empresa', 'Unknown')[:40]}")
    
    print(f"\n{'='*50}")
    print(f"Import Complete!")
    print(f"Success: {success_count}")
    print(f"Errors: {error_count}")

if __name__ == "__main__":
    main()
