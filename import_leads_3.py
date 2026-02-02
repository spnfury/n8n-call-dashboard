import requests
import json
import os

# Configuration
API_URL = "https://nocodb.srv889387.hstgr.cloud/api/v2/tables/mgot1kl4sglenym/records"
XC_TOKEN = "jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww"
DATA_FILE = "/Users/sergirodriguezzambrana/n8n/leads_3_data.tsv"

def delete_all_records():
    headers = {"xc-token": XC_TOKEN, "Content-Type": "application/json"}
    print("Clearing existing records via bulk delete...")
    res = requests.get(f"{API_URL}?limit=1000", headers=headers)
    records = res.json().get('list', [])
    if not records:
        print("Table is already empty.")
        return
    
    ids_to_delete = [{"unique_id": r['unique_id']} for r in records if r.get('unique_id')]
    if ids_to_delete:
        d_res = requests.delete(API_URL, headers=headers, json=ids_to_delete)
        if d_res.status_code == 200:
            print(f"Successfully deleted {len(ids_to_delete)} records.")
        else:
            print(f"Bulk delete failed: {d_res.text}")
            # Fallback to one-by-one if bulk fails
            for item in ids_to_delete:
                requests.delete(f"{API_URL}/{item['unique_id']}", headers=headers)
    
    # Check for records with no unique_id and try to clear them if possible
    print("Deletion process finished.")

def parse_data(file_path):
    records = {}
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split('\t')
            
            uid = parts[0].strip() if len(parts) > 0 else None
            if not uid:
                continue

            # DIRECT MAPPING for Leads 4 Table (Correct Schema)
            record = {
                "unique_id": uid,
                "name": parts[1].strip() if len(parts) > 1 else None,
                "sector": parts[2].strip() if len(parts) > 2 else None,
                "summary": parts[3].strip() if len(parts) > 3 else None,
                "address": parts[4].strip() if len(parts) > 4 else None,
                "email": parts[5].strip() if len(parts) > 5 else None,
                "phone": parts[6].strip() if len(parts) > 6 else None,
                "website": parts[7].strip() if len(parts) > 7 else None,
                "state": parts[8].strip() if len(parts) > 8 else None,
                "url": parts[-1].strip() if len(parts) > 9 else None
            }
            records[uid] = record
    return list(records.values())

def import_records(records):
    headers = {
        "xc-token": XC_TOKEN,
        "Content-Type": "application/json"
    }
    try:
        response = requests.post(API_URL, headers=headers, json=records)
        response.raise_for_status()
        print(f"Successfully imported {len(records)} records.")
    except Exception as e:
        print(f"Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Response: {e.response.text}")

if __name__ == "__main__":
    delete_all_records()
    if os.path.exists(DATA_FILE):
        leads = parse_data(DATA_FILE)
        if leads:
            print(f"Found {len(leads)} records. Attempting import...")
            import_records(leads)
