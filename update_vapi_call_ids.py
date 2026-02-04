#!/usr/bin/env python3
"""
Script final para actualizar los registros de NocoDB.
"""

import csv
import json
import requests
import os
import sys
from datetime import datetime
from typing import Dict, List

# Configuración de NocoDB
NOCODB_BASE_URL = "https://nocodb.srv889387.hstgr.cloud/api/v2/tables"
NOCODB_TABLE_ID = "m013en5u2cyu30j"
NOCODB_TOKEN = "jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww"

HEADERS = {
    "xc-token": NOCODB_TOKEN,
    "Content-Type": "application/json"
}


def normalize_phone(phone: str) -> str:
    """Normaliza un número de teléfono eliminando espacios y caracteres especiales."""
    if not phone:
        return ""
    normalized = str(phone).replace(" ", "").replace("-", "").replace("(", "").replace(")", "").replace(".0", "")
    if not normalized.startswith("+"):
        normalized = "+" + normalized
    return normalized


def load_vapi_data(file_path: str) -> List[Dict]:
    """Carga los datos de Vapi desde JSON."""
    if not os.path.exists(file_path):
        return []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            vapi_calls = []
            for call in data:
                vapi_calls.append({
                    'call_id': call.get('id'),
                    'phone': normalize_phone(call.get('customer', {}).get('number', '')),
                    'created_at': call.get('createdAt')
                })
            return vapi_calls
    except:
        return []


def get_nocodb_records() -> List[Dict]:
    """Obtiene todos los registros de NocoDB."""
    url = f"{NOCODB_BASE_URL}/{NOCODB_TABLE_ID}/records"
    params = {"limit": 100}
    response = requests.get(url, headers=HEADERS, params=params)
    response.raise_for_status()
    return response.json().get('list', [])


def bulk_update_nocodb(updates: List[Dict]):
    """Actualiza registros en bloque."""
    if not updates:
        return
    url = f"{NOCODB_BASE_URL}/{NOCODB_TABLE_ID}/records"
    try:
        # En NocoDB v2, PATCH a la URL de records con una LISTA de objetos es BULK UPDATE
        # Pero cada objeto DEBE tener el campo ID exacto (según mi log es 'id' minúscula)
        response = requests.patch(url, headers=HEADERS, json=updates)
        response.raise_for_status()
        print(f"🚀 Actualización masiva de {len(updates)} registros completada con éxito.")
    except Exception as e:
        print(f"❌ Error en actualización masiva: {e}")
        if hasattr(e, 'response') and e.response is not None:
             print(f"Detalle: {e.response.text}")


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 update_vapi_call_ids.py vapi_calls.json")
        sys.exit(1)
        
    vapi_calls = load_vapi_data(sys.argv[1])
    nocodb_records = get_nocodb_records()
    
    vapi_by_phone = {}
    for call in vapi_calls:
        phone = call['phone']
        if phone:
            if phone not in vapi_by_phone: vapi_by_phone[phone] = []
            vapi_by_phone[phone].append(call)
            
    updates = []
    
    for record in nocodb_records:
        r_id = record.get('id') or record.get('Id')
        phone = normalize_phone(record.get('phone_called', ''))
        call_time = record.get('call_time', '')
        
        if record.get('vapi_call_id') or not phone or phone in ["+340", "+0"]:
            continue
            
        if phone in vapi_by_phone:
            for vapi_call in vapi_by_phone[phone]:
                if call_time and vapi_call['created_at']:
                    try:
                        n_dt = datetime.fromisoformat(call_time.replace('Z', '+00:00'))
                        v_dt = datetime.fromisoformat(vapi_call['created_at'].replace('Z', '+00:00'))
                        if abs((n_dt - v_dt).total_seconds()) < 1200: # 20 min
                            updates.append({
                                "id": r_id,
                                "vapi_call_id": vapi_call['call_id']
                            })
                            print(f"✅ Match: {r_id} -> {vapi_call['call_id']}")
                            break
                    except: pass
    
    if updates:
        bulk_update_nocodb(updates)
    else:
        print("No se encontraron nuevos matches.")

if __name__ == "__main__":
    main()
