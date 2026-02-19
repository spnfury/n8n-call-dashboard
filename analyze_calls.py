#!/usr/bin/env python3
"""
Analyze latest Vapi calls from the raw JSON file.
"""
import json
from datetime import datetime, timedelta

def main():
    with open("latest_calls_raw.json", "r", encoding="utf-8") as f:
        calls = json.load(f)
    
    print(f"Total llamadas cargadas: {len(calls)}")
    
    # Extract data
    data = []
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
        
        data.append({
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
    
    # === STATISTICS ===
    total = len(data)
    with_transcript = [c for c in data if c["transcript"]]
    with_tool_calls = [c for c in data if c["tool_calls_count"] > 0]
    save_data_calls = [c for c in data if any(
        "save" in tc["name"].lower() or "confirmed" in tc["name"].lower() or "protech" in tc["name"].lower()
        for tc in c["tool_calls"]
    )]
    end_call_used = [c for c in data if any(
        "end_call" in tc["name"].lower()
        for tc in c["tool_calls"]
    )]
    
    dates = {}
    for c in data:
        date = c["created_at"][:10] if c["created_at"] else "unknown"
        dates.setdefault(date, 0)
        dates[date] += 1
    
    durations = [c["duration"] for c in with_transcript if c["duration"] > 0]
    
    print(f"\n{'='*70}")
    print(f"  ANALISIS DE LLAMADAS VAPI - DATOS ACTUALIZADOS")
    print(f"{'='*70}")
    print(f"\nTotal llamadas: {total}")
    print(f"Con transcripcion: {len(with_transcript)}")
    print(f"Con tool calls: {len(with_tool_calls)}")
    print(f"  - Con save_confirmed_data: {len(save_data_calls)}")
    print(f"  - Con end_call: {len(end_call_used)}")
    
    print(f"\nLlamadas por fecha:")
    for date in sorted(dates.keys(), reverse=True)[:15]:
        print(f"  {date}: {dates[date]} llamadas")
    
    if durations:
        print(f"\nDuracion (llamadas con transcripcion):")
        print(f"  Media: {sum(durations)/len(durations):.0f}s")
        print(f"  Max: {max(durations)}s")
        print(f"  Min: {min(durations)}s")
        long = [c for c in with_transcript if c["duration"] > 60]
        print(f"  >60s: {len(long)} llamadas")
    
    # Ended reasons
    reasons = {}
    for c in data:
        r = c["ended_reason"] or "unknown"
        if "customer-ended" in r: r = "Cliente colgo"
        elif "assistant-ended" in r: r = "Asistente finalizo"
        elif "silence-timed-out" in r: r = "Silencio"
        elif "voicemail" in r: r = "Buzon de voz"
        elif "max-duration" in r: r = "Duracion maxima"
        elif "customer-did-not-answer" in r: r = "No contesta"
        elif "503" in r or "unavailable" in r: r = "Error SIP"
        elif "failed-to-connect" in r: r = "No conecto"
        reasons.setdefault(r, 0)
        reasons[r] += 1
    
    print(f"\nMotivos de fin:")
    for reason, count in sorted(reasons.items(), key=lambda x: -x[1]):
        pct = count/total*100
        print(f"  {reason:<35} {count:>4} ({pct:.1f}%)")
    
    # === TOOL CALLS ANALYSIS ===
    print(f"\n{'='*70}")
    print(f"  ANALISIS DE TOOL CALLS")
    print(f"{'='*70}")
    
    if save_data_calls:
        print(f"\nLlamadas con save_confirmed_data ({len(save_data_calls)}):")
        for c in save_data_calls:
            print(f"\n  {c['empresa'] or c['phone']} ({c['created_at'][:16]}, {c['duration']}s)")
            for tc in c["tool_calls"]:
                if "save" in tc["name"].lower() or "confirmed" in tc["name"].lower() or "protech" in tc["name"].lower():
                    args = tc.get("args", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except:
                            print(f"    -> {tc['name']}: {args[:200]}")
                            continue
                    print(f"    -> {tc['name']}:")
                    if isinstance(args, dict):
                        for k, v in args.items():
                            if v:
                                print(f"       {k}: {v}")
    else:
        print(f"\n  *** NINGUNA llamada uso save_confirmed_data ***")
    
    # === RECENT TRANSCRIPTS ===
    today = datetime.utcnow().strftime("%Y-%m-%d")
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    day_before = (datetime.utcnow() - timedelta(days=2)).strftime("%Y-%m-%d")
    
    recent = [c for c in data if c["created_at"][:10] in [today, yesterday, day_before] and c["transcript"]]
    recent.sort(key=lambda x: x["created_at"], reverse=True)
    
    print(f"\n{'='*70}")
    print(f"  TRANSCRIPCIONES RECIENTES ({today} / {yesterday} / {day_before})")
    print(f"  Total con transcripcion: {len(recent)}")
    print(f"{'='*70}")
    
    for i, c in enumerate(recent[:50]):
        print(f"\n{'_'*70}")
        print(f"#{i+1} | {c['empresa'] or 'Sin nombre'} | {c['phone']} | {c['duration']}s | {c['ended_reason'][:30]}")
        print(f"    Fecha: {c['created_at'][:19]}")
        if c["tool_calls"]:
            for tc in c["tool_calls"]:
                args_str = json.dumps(tc.get("args", {}), ensure_ascii=False)
                print(f"    TOOL: {tc['name']}: {args_str[:200]}")
        if c["transcript"]:
            t = c["transcript"][:800]
            print(f"    ---")
            print(f"    {t}")
            if len(c["transcript"]) > 800:
                print(f"    ... ({len(c['transcript'])-800} chars mas)")
    
    # === KEYWORD ANALYSIS ===
    print(f"\n{'='*70}")
    print(f"  LLAMADAS DONDE DIERON DATOS PERO NO SE GUARDARON")
    print(f"{'='*70}")
    
    keywords = ["email", "correo", "arroba", "telefono", "movil", "numero", "llamame", "envia"]
    count_missed = 0
    for c in with_transcript:
        t = c["transcript"].lower()
        matches = [kw for kw in keywords if kw in t]
        has_save = any(
            "save" in tc["name"].lower() or "confirmed" in tc["name"].lower() or "protech" in tc["name"].lower()
            for tc in c["tool_calls"]
        )
        if matches and not has_save and c["duration"] > 20:
            count_missed += 1
            print(f"\n  #{count_missed} {c['empresa'] or c['phone']} ({c['created_at'][:16]}, {c['duration']}s)")
            print(f"     Keywords encontradas: {', '.join(matches)}")
            # Show only relevant lines
            for line in c["transcript"].split("\n"):
                if any(kw in line.lower() for kw in keywords):
                    print(f"     -> {line.strip()[:150]}")
    
    if count_missed == 0:
        print(f"\n  No se encontraron llamadas con keywords de datos")
    
    # === REPETITION ANALYSIS ===
    print(f"\n{'='*70}")
    print(f"  ANALISIS DE REPETICIONES")
    print(f"{'='*70}")
    
    repetitive_calls = []
    for c in with_transcript:
        if not c["transcript"]:
            continue
        lines = c["transcript"].split("\n")
        ai_lines = [l.strip() for l in lines if l.strip().startswith("AI:")]
        # Check for exact repetitions
        repeats = 0
        for i in range(1, len(ai_lines)):
            if ai_lines[i] == ai_lines[i-1]:
                repeats += 1
            elif len(ai_lines[i]) > 30 and len(ai_lines[i-1]) > 30:
                # Check if substantially similar
                words_i = set(ai_lines[i].lower().split()[:10])
                words_prev = set(ai_lines[i-1].lower().split()[:10])
                overlap = len(words_i & words_prev) / max(len(words_i), 1)
                if overlap > 0.7:
                    repeats += 1
        if repeats >= 2:
            repetitive_calls.append({**c, "repeats": repeats})
    
    print(f"\n  Llamadas con 2+ repeticiones del AI: {len(repetitive_calls)}")
    for c in repetitive_calls[:10]:
        print(f"    {c['empresa'] or c['phone']} ({c['created_at'][:10]}, {c['duration']}s, {c['repeats']} repeticiones)")
    
    # === PRONUNCIATION ISSUES ===
    print(f"\n{'='*70}")
    print(f"  PROBLEMAS DE PRONUNCIACION")
    print(f"{'='*70}")
    
    pron_issues = {
        "General Protection": 0,
        "General Protector": 0,
        "General Protective": 0,
        "General Protec ": 0,
        "General Protect ": 0,
    }
    
    for c in with_transcript:
        t = c["transcript"]
        for variant, _ in pron_issues.items():
            if variant in t:
                pron_issues[variant] += 1
    
    for variant, count in pron_issues.items():
        print(f"  '{variant.strip()}': {count} ocurrencias")
    
    # === AI SELF-DISCLOSURE ===
    print(f"\n{'='*70}")
    print(f"  REVELACION PROACTIVA DE IA")
    print(f"{'='*70}")
    
    ai_disclosures = 0
    disclosure_phrases = [
        "soy una asistente con inteligencia artificial",
        "soy una asistente virtual",
        "soy un asistente con inteligencia",
        "soy una ia",
        "soy inteligencia artificial",
    ]
    
    for c in with_transcript:
        t = c["transcript"].lower()
        for phrase in disclosure_phrases:
            if phrase in t:
                # Check if AI said it proactively (not in response to "eres un robot?")
                ai_disclosures += 1
                break
    
    print(f"  Llamadas con auto-revelacion IA: {ai_disclosures}")
    
    # === SUMMARY ===
    print(f"\n{'='*70}")
    print(f"  RESUMEN FINAL")
    print(f"{'='*70}")
    print(f"  Total llamadas: {total}")
    print(f"  Con transcripcion: {len(with_transcript)}")
    print(f"  Datos guardados: {len(save_data_calls)}")
    print(f"  end_call usado: {len(end_call_used)}")
    print(f"  Repetitivas (2+): {len(repetitive_calls)}")
    print(f"  Auto-revelacion IA: {ai_disclosures}")
    print(f"  Datos perdidos (keyword pero no guardado): {count_missed}")

if __name__ == "__main__":
    main()
