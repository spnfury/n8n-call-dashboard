#!/usr/bin/env python3
"""
Fetch latest call data from Vapi API and save to JSON for analysis.
"""
import urllib.request
import json
import ssl
from datetime import datetime, timedelta

VAPI_API_KEY = "852080ba-ce7c-4778-b218-bf718613a2b6"
ASSISTANT_ID = "49e56db1-1f20-4cf1-b031-9cea9fba73cb"

def fetch_vapi_calls(limit=200):
    """Fetch recent calls from Vapi API using urllib."""
    url = f"https://api.vapi.ai/call?assistantId={ASSISTANT_ID}&limit={limit}"
    
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {VAPI_API_KEY}")
    req.add_header("Accept", "application/json")
    req.add_header("Accept-Encoding", "identity")
    
    ctx = ssl.create_default_context()
    
    print(f"Fetching up to {limit} calls from Vapi API...")
    with urllib.request.urlopen(req, context=ctx) as response:
        data = response.read().decode("utf-8")
        calls = json.loads(data)
        print(f"Got {len(calls)} calls")
        return calls

def extract_call_data(calls):
    """Extract relevant data from Vapi call objects."""
    results = []
    for call in calls:
        transcript = call.get("transcript", "") or ""
        analysis = call.get("analysis", {}) or {}
        summary = analysis.get("summary", "")
        created = call.get("createdAt", "")
        ended_reason = call.get("endedReason", "")
        duration = call.get("duration", 0) or 0
        
        customer = call.get("customer", {}) or {}
        phone = customer.get("number", "")
        
        overrides = call.get("assistantOverrides", {}) or {}
        variable_values = overrides.get("variableValues", {}) or {}
        empresa = variable_values.get("empresa", "")
        
        metadata = call.get("metadata", {}) or {}
        if not empresa:
            empresa = metadata.get("empresa", "") or metadata.get("lead_name", "")
        
        # Extract tool calls from messages
        messages = call.get("messages", []) or []
        tool_calls = []
        for msg in messages:
            if msg.get("role") == "tool_calls" or msg.get("toolCalls"):
                tc = msg.get("toolCalls", [])
                if tc:
                    tool_calls.extend(tc)
            if msg.get("role") == "assistant" and msg.get("toolCalls"):
                tool_calls.extend(msg.get("toolCalls", []))
        
        results.append({
            "id": call.get("id", ""),
            "created_at": created,
            "phone": phone,
            "empresa": empresa,
            "duration": duration,
            "ended_reason": ended_reason,
            "transcript": transcript,
            "summary": summary,
            "tool_calls_count": len(tool_calls),
            "tool_calls": [
                {
                    "name": tc.get("function", {}).get("name", ""),
                    "args": tc.get("function", {}).get("arguments", {})
                }
                for tc in tool_calls
            ]
        })
    
    return results

def analyze_calls(calls_data):
    """Print analysis summary."""
    total = len(calls_data)
    with_transcript = [c for c in calls_data if c["transcript"]]
    with_tool_calls = [c for c in calls_data if c["tool_calls_count"] > 0]
    save_data_calls = [c for c in calls_data if any(
        "save" in tc["name"].lower() or "confirmed" in tc["name"].lower()
        for tc in c["tool_calls"]
    )]
    end_call_used = [c for c in calls_data if any(
        "end_call" in tc["name"].lower()
        for tc in c["tool_calls"]
    )]
    
    dates = {}
    for c in calls_data:
        date = c["created_at"][:10] if c["created_at"] else "unknown"
        dates.setdefault(date, 0)
        dates[date] += 1
    
    durations = [c["duration"] for c in with_transcript if c["duration"] > 0]
    
    print(f"\n{'='*60}")
    print(f"  ANÁLISIS DE LLAMADAS VAPI")
    print(f"{'='*60}")
    print(f"\nTotal llamadas: {total}")
    print(f"Con transcripción: {len(with_transcript)}")
    print(f"Con tool calls: {len(with_tool_calls)}")
    print(f"  - Con save_confirmed_data: {len(save_data_calls)}")
    print(f"  - Con end_call: {len(end_call_used)}")
    
    print(f"\nLlamadas por fecha (últimas 10):")
    for date in sorted(dates.keys(), reverse=True)[:10]:
        print(f"  {date}: {dates[date]} llamadas")
    
    if durations:
        print(f"\nDuración (llamadas con transcripción):")
        print(f"  Media: {sum(durations)/len(durations):.0f}s")
        print(f"  Máx: {max(durations)}s")
        print(f"  Mín: {min(durations)}s")
        long = [c for c in with_transcript if c["duration"] > 60]
        print(f"  >60s: {len(long)} llamadas")
    
    reasons = {}
    for c in calls_data:
        r = c["ended_reason"] or "unknown"
        # Simplify
        if "customer-ended" in r: r = "Cliente colgó"
        elif "assistant-ended" in r: r = "Asistente finalizó"
        elif "silence-timed-out" in r: r = "Silencio"
        elif "voicemail" in r: r = "Buzón de voz"
        elif "max-duration" in r: r = "Duración máxima"
        elif "customer-did-not-answer" in r: r = "No contesta"
        elif "503" in r or "unavailable" in r: r = "Error SIP"
        elif "failed-to-connect" in r: r = "No conectó"
        reasons.setdefault(r, 0)
        reasons[r] += 1
    
    print(f"\nMotivos de fin:")
    for reason, count in sorted(reasons.items(), key=lambda x: -x[1]):
        pct = count/total*100
        print(f"  {reason:<30} {count:>4} ({pct:.1f}%)")
    
    # Today's and yesterday's transcripts
    today = datetime.utcnow().strftime("%Y-%m-%d")
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    
    recent = [c for c in calls_data if c["created_at"][:10] in [today, yesterday] and c["transcript"]]
    recent.sort(key=lambda x: x["created_at"], reverse=True)
    
    print(f"\n{'='*60}")
    print(f"  TRANSCRIPCIONES RECIENTES (HOY: {today}, AYER: {yesterday})")
    print(f"  Total con transcripción: {len(recent)}")
    print(f"{'='*60}")
    
    for i, c in enumerate(recent[:40]):
        print(f"\n{'─'*60}")
        print(f"#{i+1} | {c['empresa'] or 'Sin nombre'} | {c['phone']} | {c['duration']}s")
        print(f"    Fecha: {c['created_at'][:19]} | Fin: {c['ended_reason']}")
        if c["tool_calls"]:
            for tc in c["tool_calls"]:
                args_str = json.dumps(tc.get("args", {}), ensure_ascii=False)
                print(f"    🔧 {tc['name']}: {args_str[:150]}")
        if c["transcript"]:
            lines = c["transcript"].replace("\\n", "\n").split("\n")
            for line in lines[:20]:
                print(f"    {line.strip()}")
            if len(lines) > 20:
                print(f"    ... ({len(lines)-20} líneas más)")
    
    # Specifically look for calls with potential data capture
    print(f"\n{'='*60}")
    print(f"  LLAMADAS CON DATOS CAPTURADOS (save_confirmed_data)")
    print(f"{'='*60}")
    if save_data_calls:
        for c in save_data_calls:
            print(f"\n  ✅ {c['empresa'] or c['phone']} ({c['created_at'][:16]})")
            for tc in c["tool_calls"]:
                if "save" in tc["name"].lower() or "confirmed" in tc["name"].lower():
                    print(f"     → {tc['name']}")
                    args = tc.get("args", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except:
                            pass
                    for k, v in (args.items() if isinstance(args, dict) else []):
                        print(f"       {k}: {v}")
    else:
        print(f"\n  ❌ NINGUNA llamada tiene datos guardados con la herramienta")
    
    # Calls where someone gave data but it wasn't saved
    print(f"\n{'='*60}")
    print(f"  LLAMADAS DONDE DIERON DATOS PERO NO SE GUARDARON")
    print(f"{'='*60}")
    
    keywords = ["email", "correo", "arroba", "@", "teléfono", "móvil", "número", "llámame", "envía", "envío"]
    for c in with_transcript:
        t = c["transcript"].lower()
        matches = [kw for kw in keywords if kw in t]
        if matches and c["tool_calls_count"] == 0:
            print(f"\n  ⚠️ {c['empresa'] or c['phone']} ({c['created_at'][:16]}, {c['duration']}s)")
            print(f"     Keywords: {', '.join(matches)}")
            # Show relevant lines
            for line in c["transcript"].split("\\n"):
                if any(kw in line.lower() for kw in keywords):
                    print(f"     → {line.strip()[:150]}")
    
    return {
        "total": total,
        "with_transcript": len(with_transcript),
        "with_tool_calls": len(with_tool_calls),
        "save_data_calls": len(save_data_calls),
        "end_call_used": len(end_call_used),
        "dates": dates,
    }

if __name__ == "__main__":
    calls = fetch_vapi_calls(200)
    if calls:
        data = extract_call_data(calls)
        
        # Save raw data
        with open("latest_calls.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\nSaved {len(data)} calls to latest_calls.json")
        
        # Analyze
        stats = analyze_calls(data)
