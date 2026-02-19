#!/usr/bin/env python3
"""Extract detailed info from Vapi calls - focused on data capture and today's calls."""
import json
from datetime import datetime, timedelta

with open("latest_calls_raw.json", "r", encoding="utf-8") as f:
    calls = json.load(f)

print(f"Total: {len(calls)} calls\n")

# === 1. CALLS WITH save_confirmed_data ===
print("=" * 70)
print("  CALLS WITH save_confirmed_data TOOL")
print("=" * 70)

for call in calls:
    messages = call.get("messages", []) or []
    tool_calls = []
    for msg in messages:
        tcs = msg.get("toolCalls", []) or []
        for tc in tcs:
            fname = tc.get("function", {}).get("name", "")
            args = tc.get("function", {}).get("arguments", {})
            if fname:
                tool_calls.append({"name": fname, "args": args})
    
    has_save = any("protech" in tc["name"].lower() or "save" in tc["name"].lower() or "confirmed" in tc["name"].lower() for tc in tool_calls)
    
    if has_save:
        overrides = call.get("assistantOverrides", {}) or {}
        vv = overrides.get("variableValues", {}) or {}
        empresa = vv.get("empresa", "")
        customer = call.get("customer", {}) or {}
        phone = customer.get("number", "")
        
        print(f"\n{'_'*70}")
        print(f"Empresa: {empresa}")
        print(f"Phone: {phone}")
        print(f"Created: {call.get('createdAt', '')[:19]}")
        print(f"Duration: {call.get('duration', 0)}s")
        print(f"Ended: {call.get('endedReason', '')}")
        
        print(f"\nTool Calls:")
        for tc in tool_calls:
            args = tc["args"]
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except:
                    pass
            print(f"  -> {tc['name']}:")
            if isinstance(args, dict):
                for k, v in args.items():
                    print(f"     {k}: {v}")
            else:
                print(f"     {args}")
        
        print(f"\nTranscript:")
        t = call.get("transcript", "") or ""
        print(f"  {t[:1500]}")
        if len(t) > 1500:
            print(f"  ... ({len(t)-1500} chars more)")

# === 2. TODAY'S CALLS ===
today = "2026-02-19"
yesterday = "2026-02-18"

print(f"\n\n{'=' * 70}")
print(f"  TODAY'S CALLS ({today})")
print(f"{'=' * 70}")

today_calls = [c for c in calls if c.get("createdAt", "").startswith(today)]
today_with_transcript = [c for c in today_calls if c.get("transcript")]

print(f"Total today: {len(today_calls)}")
print(f"With transcript: {len(today_with_transcript)}")

for i, call in enumerate(sorted(today_with_transcript, key=lambda x: x.get("createdAt", ""), reverse=True)):
    overrides = call.get("assistantOverrides", {}) or {}
    vv = overrides.get("variableValues", {}) or {}
    empresa = vv.get("empresa", "")
    customer = call.get("customer", {}) or {}
    phone = customer.get("number", "")
    duration = call.get("duration", 0) or 0
    ended = call.get("endedReason", "")
    transcript = call.get("transcript", "") or ""
    
    # Tool calls
    messages = call.get("messages", []) or []
    tc_names = []
    for msg in messages:
        tcs = msg.get("toolCalls", []) or []
        for tc in tcs:
            fname = tc.get("function", {}).get("name", "")
            if fname:
                tc_names.append(fname)
    
    print(f"\n{'_'*70}")
    print(f"#{i+1} | {empresa or 'Sin nombre'} | {phone} | {duration}s | {ended[:40]}")
    print(f"    Created: {call.get('createdAt', '')[:19]}")
    if tc_names:
        print(f"    Tools: {', '.join(tc_names)}")
    print(f"    Transcript ({len(transcript)} chars):")
    print(f"    {transcript[:1000]}")
    if len(transcript) > 1000:
        print(f"    ... ({len(transcript) - 1000} chars more)")

# === 3. CALLS WHERE SOMEONE SHOWED INTEREST ===
print(f"\n\n{'=' * 70}")
print(f"  CALLS WITH INTEREST (>30s, person responded)")
print(f"{'=' * 70}")

interest_words = ["interesa", "cuéntame", "envía", "resumen", "email", "vale", "genial", "perfecto", "sí, ofrecemos", "clientes"]
for call in calls:
    transcript = call.get("transcript", "") or ""
    duration = call.get("duration", 0) or 0
    if duration < 30 or not transcript:
        continue
    
    t_lower = transcript.lower()
    # Check if user (not AI) shows interest
    user_lines = [l for l in transcript.split("\n") if l.strip().startswith("User:")]
    user_text = " ".join(user_lines).lower()
    
    has_interest = any(w in user_text for w in ["interesa", "cuéntame", "envía", "resumen", "vale", "sí,", "correo", "email"])
    
    if has_interest and duration > 40:
        overrides = call.get("assistantOverrides", {}) or {}
        vv = overrides.get("variableValues", {}) or {}
        empresa = vv.get("empresa", "")
        customer = call.get("customer", {}) or {}
        phone = customer.get("number", "")
        
        # Check if save was called
        messages = call.get("messages", []) or []
        tc_names = []
        for msg in messages:
            tcs = msg.get("toolCalls", []) or []
            for tc in tcs:
                fname = tc.get("function", {}).get("name", "")
                if fname:
                    tc_names.append(fname)
        
        has_save = any("protech" in n.lower() or "save" in n.lower() for n in tc_names)
        
        print(f"\n{'_'*70}")
        print(f"{empresa or phone} | {duration}s | {call.get('createdAt', '')[:10]} | Save: {'YES' if has_save else 'NO'}")
        if tc_names:
            print(f"  Tools: {', '.join(tc_names)}")
        # Show just user lines with interest
        for line in user_lines:
            l = line.strip()
            if any(w in l.lower() for w in ["interesa", "cuéntame", "envía", "resumen", "vale", "sí", "correo", "email", "datos"]):
                print(f"  {l[:150]}")
        print(f"  Full transcript preview: {transcript[:500]}")
