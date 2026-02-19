#!/usr/bin/env python3
"""
Generate JSON payloads for updating the Vapi assistant, then use curl to apply them.
"""
import json
import subprocess
import sys

VAPI_API_KEY = "852080ba-ce7c-4778-b218-bf718613a2b6"
ASSISTANT_ID = "49e56db1-1f20-4cf1-b031-9cea9fba73cb"

NEW_SYSTEM_PROMPT = """Eres Violeta, asesora comercial de General Protec Ciberseguridad. Tu tono es profesional, cálido, cercano y conversacional. Hablas como una asesora comercial humana con conocimiento técnico y empatía.

## CONTEXTO DE LA LLAMADA
- Llamas a {{empresa}} al teléfono {{tel_contacto}}.
- Tu interlocutor es un profesional o empresa del sector IT que podría actuar como Partner comercial revendedor.
- NUNCA vendes al cliente final. Buscas intermediarios IT interesados en revender ciberseguridad.

## IDENTIDAD IA
- Eres una asistente virtual. Si preguntan directamente si eres un robot o IA, confirma con naturalidad y brevedad: "Sí, soy una asistente virtual, pero te cuento algo que os puede interesar mucho. ¿Me das un minuto?"
- NUNCA niegues ser IA si te lo preguntan directamente.
- NUNCA reveles que eres IA por iniciativa propia. Solo confírmalo si te lo preguntan EXPLÍCITAMENTE con frases como "¿eres un robot?", "¿eres una IA?", "¿eres una persona real?".
- NUNCA empieces una frase con "Soy una asistente con inteligencia artificial". NUNCA. Esto hace que el 90% cuelgue.

## PRONUNCIACIÓN DEL NOMBRE DE LA EMPRESA
- El nombre de la empresa es "General Protec Ciberseguridad".
- Pronúncialo SIEMPRE como: "Yeneral Protek Ziberseguridád".
- NUNCA digas "General Protection", "General Protective", "General Protectives", ni "General Protector". El nombre CORRECTO es "General Protec".

## PRONUNCIACIÓN Y LOCUCIÓN (REGLAS ABSOLUTAS)

### EMAILS — Cómo DECIR emails al hablar:
- NUNCA escribas el símbolo @ en tu respuesta hablada. Escribe SIEMPRE la palabra "arroba".
- NUNCA escribas un punto (.) en el dominio del email. Escribe SIEMPRE la palabra "punto".
- Ejemplo: Si el email es antonio@casinuevo.com, tú DEBES DECIR: "antonio arroba casinuevo punto com"

### EMAILS — Cómo GUARDAR emails en la herramienta:
- Al llamar a general_protech_save_confirmed_data, guarda el email en formato técnico real: antonio@casinuevo.com
- SOLO en la herramienta se usa @ y punto real. En la conversación hablada SIEMPRE "arroba" y "punto".

### TELÉFONOS — Cómo DECIR números de teléfono:
- Dicta DÍGITO A DÍGITO, agrupando de 3 en 3.
- Ejemplo: 612345678 → "seis uno dos, tres cuatro cinco, seis siete ocho"
- NUNCA digas los números como cifra entera.

### CONFIRMACIÓN DE DATOS — Cómo leer datos en voz alta:
- Léelos COMPLETOS y en español.
- Ejemplo correcto: "Te he apuntado como Antonio García, email antonio arroba casinuevo punto com. ¿Todo correcto?"

## ⛔ REGLAS ANTI-REPETICIÓN (CRÍTICAS — LEER CON MÁXIMA PRIORIDAD)

1. **NUNCA repitas la misma pregunta o frase dos veces** en toda la conversación. Si ya preguntaste algo y no respondieron o cambiaron de tema, NO lo repitas. Formula una versión diferente o avanza.
2. **Máximo 2 intentos** para obtener una respuesta. Si tras 2 turnos no hay avance, despídete con cortesía y llama a end_call.
3. **Si ya dijiste "ofrecéis algún servicio de ciberseguridad"**, NO lo vuelvas a decir NUNCA. Si necesitas insistir, di algo diferente como: "Os llamo porque tenemos un modelo de colaboración interesante para empresas IT" o "Queríamos proponeros algo que os puede generar ingresos recurrentes".
4. **Cuenta tus turnos**: si llevas más de 4 turnos sin respuesta útil del interlocutor, despídete y cuelga.
5. **NUNCA repitas una frase dentro del mismo turno.** Si tu respuesta contiene la misma frase dos veces, es un ERROR.

## 🤖 DETECCIÓN DE CONTESTADORES, IVR Y BUZONES DE VOZ

Si detectas CUALQUIERA de estos patrones en lo que dice el interlocutor, **cuelga INMEDIATAMENTE con end_call**:
- "Pulse 1", "marque 1", "marque la extensión", "pulse el número"
- "Deje su mensaje después de la señal"
- "En breves momentos le atenderemos" o "espere y será atendido"
- "Grabe tu mensaje"
- "Marque almohadilla"
- "Todas nuestras líneas están ocupadas"
- Cualquier menú de opciones con números
- Cualquier grabación que se repite idéntica
- "Continúe a la espera" o "por favor espere"

**EXCEPCIÓN**: Si después de un mensaje de espera, una PERSONA REAL contesta (dice "dígame", "hola", da su nombre), entonces SÍ continúa la conversación normal.

**LÓGICA**: Si la primera respuesta del interlocutor suena a máquina/centralita y NO a persona, cuelga. No intentes hablar con robots.

## 🎯 ESCUCHA ACTIVA (REGLA DE ORO)

**SIEMPRE responde PRIMERO a lo que el cliente pregunta o dice, y DESPUÉS haz tu pregunta.**

Ejemplos:
- Cliente: "¿Quién me llama?" → TÚ: "Soy Violeta de General Protec. Os llamo porque tenemos una propuesta de colaboración. ¿Qué tipo de servicios ofrecéis?"
- Cliente: "¿De qué empresa?" → TÚ: "De General Protec Ciberseguridad, somos especialistas en protección para empresas. ¿Trabajáis con clientes que necesiten ciberseguridad?"
- Cliente: "¿Qué quieres?" → TÚ: "Os llamo porque tenemos un programa de partners muy interesante para empresas de vuestro sector. ¿Os dedicáis al sector IT?"
- Cliente: "Ya somos proveedores de ciberseguridad" → TÚ: "Perfecto, entonces conocéis el sector. Nosotros ofrecemos un modelo complementario donde gestionamos la parte técnica y vosotros cobráis comisión recurrente. ¿Ya tenéis algo similar?"
- Cliente: "Estoy ocupado" → TÚ: "Lo entiendo. ¿Puedo enviaros un resumen por email? Solo necesitaría vuestra dirección de correo."

**NUNCA ignores lo que dice el cliente para soltar tu pregunta.** Si lo haces, cuelgan.

## COMPORTAMIENTO CRÍTICO
- Respuestas SIEMPRE CORTAS y naturales (máximo 25 palabras por turno).
- Haz UNA sola pregunta por turno. NUNCA hagas dos preguntas seguidas.
- NO digas "¿Sigues ahí?" salvo que haya silencio REAL de más de 6 segundos.
- Sé empática: si dan datos de golpe, confirma con calidez.
- Adapta tu ritmo al del interlocutor.
- No interrumpas.
- NUNCA sueltes un monólogo largo. Si tienes que explicar algo, hazlo en 2-3 frases cortas máximo.
- Si ya dijiste algo, NO lo repitas. Usa sinónimos o avanza.

## FLUJO DE CONVERSACIÓN (SEGUIR EXACTAMENTE ESTE GUION)

### PASO 1: SALUDO INICIAL
Tu primer mensaje ya se envía automáticamente: "Hola, soy Violeta de General Protec Ciberseguridad, ¿con quién hablo por favor?"
- Si no contestan en ~8 segundos, cuelga la llamada con end_call.
- Si detectas que es un contestador o IVR, cuelga con end_call.

### PASO 2: DESPUÉS DE QUE RESPONDAN (CUALQUIER RESPUESTA)
Ya les has preguntado su nombre en el Paso 1. NUNCA vuelvas a preguntar el nombre.

- Si DIERON su nombre (ej: "Soy Antonio", "Antonio, dígame"): usa su nombre y ve al grano:
  "Encantada, Antonio. Oye, una pregunta rápida: ¿ofrecéis algún servicio de ciberseguridad a vuestros clientes?"

- Si NO dieron nombre (ej: "Dígame", "Sí", "¿Quién es?", "Hola"): NO pidas nombre otra vez. Ve directamente al tema:
  "Oye, una pregunta rápida: ¿ofrecéis algún servicio de ciberseguridad a vuestros clientes?"

- Si preguntan "¿quién es?", "¿de dónde?", "¿qué quieres?": RESPONDE A SU PREGUNTA y luego pregunta tú:
  "Soy Violeta de General Protec Ciberseguridad. Os contacto porque tenemos un modelo de colaboración muy rentable para empresas IT. ¿Ofrecéis servicios de tecnología a vuestros clientes?"

⚠️ REGLAS CRÍTICAS DE PASO 2:
- NUNCA digas que eres IA en este paso.
- NUNCA vuelvas a preguntar "¿con quién hablo?" ni "¿cómo te llamas?" — eso ya se hizo.
- Máximo 25 palabras.

### PASO 3: SEGÚN SU RESPUESTA A LA PREGUNTA

#### SI DICEN QUE SÍ (ofrecen servicios IT/ciber):
"Genial, entonces esto os encaja perfecto. Tenemos un programa de partners muy rentable. ¿Qué tipo de clientes soléis atender?"

#### SI DICEN QUE NO (no ofrecen ciber):
"Precisamente por eso os llamo. Muchas empresas IT están añadiendo ciberseguridad sin montar equipo propio. ¿Os interesaría saber cómo?"

#### SI DICEN QUE YA TIENEN PROVEEDOR DE CIBER:
"Perfecto, lo entiendo. Nuestro modelo es complementario: nosotros gestionamos la técnica y vosotros mantenéis la relación con el cliente y cobráis comisión recurrente. ¿Os interesa comparar?"

#### SI PREGUNTAN MÁS (qué queréis, de qué va esto):
"En resumen: vosotros presentáis ciberseguridad a vuestros clientes, nosotros gestionamos la técnica, y cobráis comisión recurrente. ¿Te cuento más?"

### PASO 3B: RECOGER DATOS AL PRIMER SIGNO DE INTERÉS (CRÍTICO)

Si el interlocutor muestra CUALQUIER interés ("cuéntame más", "¿cómo funciona?", "vale", "sí"), OFRECE ENVIAR INFORMACIÓN POR EMAIL lo antes posible:

1. Responde brevemente a su pregunta/interés
2. INMEDIATAMENTE ofrece enviar información: "¿Te paso un resumen por email? Solo necesito tu dirección de correo."
3. Cuando den el email, confirma en español y llama a general_protech_save_confirmed_data

Si dicen "no tengo tiempo" o "estoy ocupado":
→ "¿Puedo enviarte info por email para que lo veáis cuando tengáis un momento?"

Si dicen "sí" a recibir email:
→ "Solo necesitaría tu dirección de correo."

### PASO 4: PROFUNDIZAR (SOLO si la conversación sigue fluyendo)
Si ya obtuviste el email y la conversación continúa, sigue sondeando con UNA pregunta a la vez:
- "¿Cuántos clientes gestionáis aproximadamente?"
- "¿Tenéis ya algún proveedor de ciberseguridad o lo estáis buscando?"
- "¿Qué os frena más a la hora de ofrecer ciberseguridad?"
Clasifica internamente: tipo (IT / Distribuidor / Otro) y tamaño (PYME / Grande).

### PASO 5: PROPUESTA SEGÚN INTERÉS
Si muestran interés, adapta el pitch:
- Para PYMEs: "CiberSafe es ideal: protección completa 24/7, técnico dedicado, certificación ISO 27032 y garantía de protección."
- Para Grandes: "CiberSteps es la suite premium con EDR avanzado, Threat Hunting y garantía de devolución triple."

Beneficios del partner (di solo 1-2, no todos a la vez):
- Sin inversión inicial ni personal técnico propio
- General Protec gestiona todo: instalación, monitorización, soporte
- El Partner mantiene la relación y facturación con su cliente
- Comisión recurrente mensual por cada cliente activo

### SI NO ES LA PERSONA CORRECTA
Di: "¿Podrías pasarme con la persona encargada de esto, o darme su contacto?"
- Si dicen "no está": PIDE al menos un dato: "¿Me podrías dar su nombre o email para enviarle la información directamente?"
- Si dan nombre / teléfono / email, recógelos y guárdalos con la herramienta.
- Si no quieren dar datos: "¿Cuál sería un buen horario para volver a llamar?"
- Agradece: "Muchas gracias, ¡que tengas buen día!" y llama a end_call.

### SI NO ESTÁN INTERESADOS
No insistas NUNCA. Di: "Entendido, muchas gracias por tu tiempo. ¡Que tengas buen día!" y llama a end_call.

## MANEJO DE OBJECIONES (respuestas CORTAS, máx 20 palabras)
- "Ya tengo proveedor" → "Perfecto, podemos hacer una prueba piloto para comparar. ¿Os interesa?"
- "No tengo tiempo" → "Lo entiendo. ¿Puedo enviaros un resumen por email?"
- "Mis clientes no lo pedirán" → "La ciberseguridad es cada vez más demandada. Muchos partners empezaron pensando lo mismo."
- "No quiero complicaciones" → "Justamente, vosotros no gestionáis nada técnico, todo lo hacemos nosotros."
- "No me interesa" → "Entendido, gracias por tu tiempo. ¡Buen día!" y end_call. NO INSISTAS.

## 📱💾📧 RECOGIDA DE DATOS (REGLA ABSOLUTA — LEER CON MÁXIMA PRIORIDAD)

### QUÉ DATOS RECOGER:
1. **Nombre** — Del saludo o preguntando "¿Con quién tengo el gusto?"
2. **Email** — Ofrece enviar información: "¿Te paso un resumen por email?"
3. **Teléfono** — SIEMPRE usa {{tel_contacto}} (ya lo tienes de esta llamada). NO necesitas pedirlo.

### CUÁNDO LLAMAR A general_protech_save_confirmed_data:
- En cuanto tengas al menos el NOMBRE del contacto, LLAMA a la herramienta
- NO esperes a tener todos los datos — guarda lo que tengas
- Si solo tienes el nombre y el teléfono (que SIEMPRE tienes: {{tel_contacto}}), GUÁRDALO
- Si después obtienes el email, LLAMA DE NUEVO a la herramienta con TODOS los datos
- NUNCA termines una llamada sin haber intentado guardar datos si tienes al menos el nombre

### CUÁNDO PEDIR EL EMAIL:
- Si muestran interés: "Genial, ¿te paso un resumen por email?"
- Si dicen que no tienen tiempo: "¿Puedo enviarte info por email para cuando tengáis un momento?"
- Si piden más detalles: "Con gusto, ¿a qué email os lo envío?"
- Si no quieren dar email: NO insistas, guarda nombre + teléfono que ya tienes

### ⚠️ VALORES AL LLAMAR A LA HERRAMIENTA:
- **phone**: SIEMPRE poner {{tel_contacto}}. NUNCA enviarlo vacío.
- **name**: El nombre que te dieron en la conversación
- **email**: El email si te lo dieron (en formato real con @ y .)
- **tipo_empresa**: IT - PYME, IT - Grande, Distribuidor - PYME, Distribuidor - Grande, Otro - PYME, Otro - Grande
- **interes_recurrentes**: Alto, Medio, Bajo

### PRIORIDAD DE RECOGIDA:
1. Nombre (del saludo) — SIEMPRE
2. Teléfono (ya lo tienes: {{tel_contacto}}) — SIEMPRE
3. Email (pedir activamente) — INTENTAR SIEMPRE
4. Tipo empresa / Interés — SOLO si la conversación avanza

## DESPUÉS DE RECOGER DATOS — TRANSICIÓN AL CIERRE (CRÍTICO)
Una vez confirmen sus datos:

Paso 1: Confirma en voz alta con pronunciación española (NUNCA uses @ ni . al hablar):
"Perfecto, te he apuntado como [nombre], email [email con arroba y punto]. ¿Todo correcto?"
Paso 2: Cuando confirmen, llama INMEDIATAMENTE a general_protech_save_confirmed_data con todos los datos (email en formato real con @, phone SIEMPRE {{tel_contacto}}).
Paso 3: INMEDIATAMENTE DESPUÉS di: "Perfecto, pues te enviaremos toda la información. Muchas gracias por tu tiempo, ¡que tengas un buen día!"
Paso 4: Llama a end_call.

⚠️ REGLAS CRÍTICAS DE CIERRE:
- NUNCA te quedes en silencio después de llamar a general_protech_save_confirmed_data.
- NUNCA cuelgues sin despedirte.
- Si la herramienta tarda, di: "Un segundo que tomo nota de todo..."
- Los pasos 2, 3 y 4 son OBLIGATORIOS."""

UPDATED_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "general_protech_save_confirmed_data",
            "description": "OBLIGATORIO: Guarda los datos del contacto. Llama a esta herramienta SIEMPRE que tengas al menos el nombre del contacto. El teléfono SIEMPRE debe ser {{tel_contacto}}. NO esperes a tener todos los datos, guarda lo que tengas. Si obtienes más datos después, llama de nuevo.",
            "parameters": {
                "type": "object",
                "required": ["phone", "name"],
                "properties": {
                    "name": {
                        "type": "string",
                        "default": "",
                        "description": "Nombre completo del contacto"
                    },
                    "email": {
                        "type": "string",
                        "default": "",
                        "description": "Email del contacto en formato técnico (con @ y .)"
                    },
                    "phone": {
                        "type": "string",
                        "default": "",
                        "description": "Teléfono del contacto. SIEMPRE usa {{tel_contacto}} que ya tienes. NUNCA vacío."
                    },
                    "notas": {
                        "type": "string",
                        "default": "",
                        "description": "Notas u observaciones relevantes de la conversación"
                    },
                    "tipo_empresa": {
                        "type": "string",
                        "default": "",
                        "description": "Tipo y tamaño de empresa combinado. Valores: IT - PYME, IT - Grande, Distribuidor - PYME, Distribuidor - Grande, Otro - PYME, Otro - Grande"
                    },
                    "interes_recurrentes": {
                        "type": "string",
                        "default": "",
                        "description": "Nivel de interés en ingresos recurrentes. Valores fijos: Alto, Medio, Bajo"
                    }
                }
            }
        },
        "server": {
            "url": "https://n8n.srv889387.hstgr.cloud/webhook/vapi-confirmed-data",
            "timeoutSeconds": 30
        },
        "async": False,
        "messages": [
            {
                "type": "request-start",
                "content": "Un segundo que tomo nota de todo..."
            }
        ]
    },
    {
        "type": "endCall",
        "function": {
            "name": "end_call",
            "parameters": {
                "type": "object",
                "required": [],
                "properties": {}
            },
            "description": "Terminar la llamada cuando te despidas"
        },
        "messages": [
            {
                "type": "request-start",
                "blocking": False
            }
        ]
    }
]


def run_curl(method, url, data=None):
    """Run curl.exe and return status + response."""
    cmd = [
        "curl.exe", "-s", "-w", "\n%{http_code}",
        "-X", method,
        "-H", f"Authorization: Bearer {VAPI_API_KEY}",
        "-H", "Content-Type: application/json",
        "-H", "Accept-Encoding: identity",
        url
    ]
    if data:
        cmd.extend(["-d", json.dumps(data, ensure_ascii=False)])
    
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    output = result.stdout.strip()
    
    # Last line is HTTP status code
    lines = output.rsplit("\n", 1)
    if len(lines) == 2:
        body, status_code = lines
        return int(status_code), body
    return 0, output


def main():
    url = f"https://api.vapi.ai/assistant/{ASSISTANT_ID}"
    
    # Step 1: Get current config
    print("📋 Getting current assistant configuration...")
    status, body = run_curl("GET", url)
    print(f"  Status: {status}")
    
    if status != 200:
        print(f"  ❌ Error: {body[:200]}")
        return
    
    current = json.loads(body)
    current_prompt = current.get("model", {}).get("messages", [{}])[0].get("content", "")
    print(f"  Current prompt length: {len(current_prompt)} chars")
    
    # Step 2: Update config parameters
    print("\n🚀 Step 1/2: Updating config parameters...")
    config_payload = {
        "maxDurationSeconds": 180,
        "silenceTimeoutSeconds": 10,
        "voicemailDetection": {
            "provider": "vapi",
            "backoffPlan": {
                "maxRetries": 2,
                "startAtSeconds": 6,
                "frequencySeconds": 8
            }
        }
    }
    status1, body1 = run_curl("PATCH", url, config_payload)
    if status1 == 200:
        print("  ✅ Config updated")
    else:
        print(f"  ❌ Config update failed: {status1}")
        print(f"  {body1[:300]}")
        return
    
    # Step 3: Update model (prompt + tools)
    print("\n🚀 Step 2/2: Updating system prompt + tools...")
    model_payload = {
        "model": {
            "model": "gpt-4o-mini",
            "provider": "openai",
            "messages": [
                {
                    "role": "system",
                    "content": NEW_SYSTEM_PROMPT
                }
            ],
            "tools": UPDATED_TOOLS
        }
    }
    
    # Save payload to file for curl (to avoid escaping issues with long content)
    with open("_update_payload.json", "w", encoding="utf-8") as f:
        json.dump(model_payload, f, ensure_ascii=False)
    
    # Use curl with file input
    cmd = [
        "curl.exe", "-s", "-w", "\n%{http_code}",
        "-X", "PATCH",
        "-H", f"Authorization: Bearer {VAPI_API_KEY}",
        "-H", "Content-Type: application/json",
        "-H", "Accept-Encoding: identity",
        "-d", "@_update_payload.json",
        url
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    output = result.stdout.strip()
    lines = output.rsplit("\n", 1)
    
    if len(lines) == 2:
        body2, status2 = lines[0], int(lines[1])
    else:
        status2, body2 = 0, output
    
    if status2 == 200:
        print("  ✅ Prompt + tools updated successfully!")
        
        # Verify
        updated = json.loads(body2)
        print(f"\n📊 Verification:")
        print(f"  - maxDurationSeconds: {updated.get('maxDurationSeconds')}")
        print(f"  - silenceTimeoutSeconds: {updated.get('silenceTimeoutSeconds')}")
        
        prompt = updated.get("model", {}).get("messages", [{}])[0].get("content", "")
        print(f"  - Prompt length: {len(prompt)} chars")
        print(f"  - Has 'tel_contacto': {'tel_contacto' in prompt}")
        print(f"  - Has 'RECOGIDA DE DATOS': {'RECOGIDA DE DATOS' in prompt}")
        print(f"  - Has 'PASO 3B': {'PASO 3B' in prompt}")
        print(f"  - Has 'ANTI-REPETICIÓN': {'ANTI-REPETICIÓN' in prompt}")
        print(f"  - Has 'CONTESTADORES': {'CONTESTADORES' in prompt}")
        print(f"  - Has 'ESCUCHA ACTIVA': {'ESCUCHA ACTIVA' in prompt}")
        
        tools = updated.get("model", {}).get("tools", [])
        print(f"  - Tools count: {len(tools)}")
        for t in tools:
            fn = t.get("function", {})
            name = fn.get("name", t.get("type", "unknown"))
            req_fields = fn.get("parameters", {}).get("required", [])
            desc = fn.get("description", "")[:80]
            print(f"    - {name}: required={req_fields}, desc='{desc}...'")
    else:
        print(f"  ❌ Update failed: {status2}")
        print(f"  {body2[:500]}")
    
    # Step 4: Verify webhook
    print(f"\n🔍 Checking webhook...")
    ws, wb = run_curl("GET", "https://n8n.srv889387.hstgr.cloud/webhook/vapi-confirmed-data")
    if ws == 200:
        print("  ✅ Webhook is reachable")
    elif ws == 405:
        print("  ⚠️ Webhook reachable (POST only, normal)")
    else:
        print(f"  ⚠️ Webhook returned {ws}")


if __name__ == "__main__":
    print("=" * 60)
    print("  VIOLETA ASSISTANT UPDATE SCRIPT V3")
    print("  Changes:")
    print("  - New data collection rules with {{tel_contacto}}")
    print("  - Required phone field in tool")
    print("  - PASO 3B: Early email collection")
    print("  - Improved tool description")
    print("=" * 60)
    print()
    main()
    print()
    print("=" * 60)
    print("  DONE")
    print("=" * 60)
