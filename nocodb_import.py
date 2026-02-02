import requests
import json
import sys

# Configuration
API_URL = "https://nocodb.srv889387.hstgr.cloud/api/v2/tables/mgot1kl4sglenym/records"
# Replace with your actual token
XC_TOKEN = "jx3uoKeVaidZLF7M0skVb9pV6yvNsam0Hu-Vfeww"

def import_records(records):
    headers = {
        "xc-token": XC_TOKEN,
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(API_URL, headers=headers, data=json.dumps(records))
        response.raise_for_status()
        print(f"Successfully imported {len(records)} records.")
        return response.json()
    except requests.exceptions.HTTPError as err:
        print(f"HTTP Error: {err}")
        if response.text:
            print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # Example data provided by user
    data_to_import = [
        {
            "unique_id": "0715eb624289b26bb9d8eb146e11220873d866a2d1737553384cda65d5278b4f1efe7702cd838227de6aaa2d87a0f0f796c6e55f933a555f1ea77ee0e9657b68",
            "name": "Servicios Informaticos Palomares Sl",
            "sector": "Comercio",
            "summary": "El alquiler de equipos informaticos, construccion de maquinas de oficina, ordenadores, incluida su instalacion, mantenimiento, ensamblaje, montaje, reparacion y venta de ordenadores.",
            "address": "Avenida de isabel de farnesio, 20 - lc 4, boadilla del monte, 28660, madrid",
            "email": "david@mainsip.com",
            "phone": "916326950",
            "website": "N/A",
            "state": "Alive",
            "em_http_code": None, # Assuming these are nullable or numeric
            "http_code": None,
            "scraped": None,
            "inserted": None,
            "email_sent": None,
            "email_responded": None,
            "url": "https://empresite.eleconomista.es/SERVICIOS-INFORMATICOS-PALOMARES.html"
        }
    ]
    
    print("Starting import...")
    import_records(data_to_import)
