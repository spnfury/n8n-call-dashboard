---
description: Deploy a producción — bump de versión y changelog
---

# Deploy a Producción

// turbo-all

Cada vez que se ejecute este workflow, seguir **todos** los pasos de forma automática sin pedir confirmación al usuario.

## 1. Leer la versión actual

Leer la versión actual del campo `"version"` en `call-dashboard-app/package.json`.

## 2. Bump de versión automático

Incrementar automáticamente la versión **patch** (0.0.X → 0.0.X+1) a menos que los cambios incluyan funcionalidades nuevas visibles para el usuario (en cuyo caso, bump **minor**: 0.X.0).

Actualizar la versión en estos 2 ficheros:
- **`call-dashboard-app/package.json`**: campo `"version"`
- **`call-dashboard-app/index.html`**: el texto `vX.X.X` dentro del `<small>` del header (buscar el patrón `v` seguido de la versión antigua)

## 3. Añadir entrada al changelog automáticamente

En **`call-dashboard-app/main.js`**, añadir una nueva entrada al **principio** del array `CHANGELOG_DATA` con la fecha de hoy (`YYYY-MM-DD`) y los cambios realizados en esta sesión.

Recopilar automáticamente qué cambios se hicieron revisando los archivos modificados en la conversación actual. Generar título y descripción apropiados para cada cambio.

Formato:
```javascript
{
    date: 'YYYY-MM-DD',   // fecha de hoy
    entries: [
        { type: 'feature|fix|improvement|prompt', title: 'Título corto del cambio', hours: X, desc: 'Descripción detallada.' },
    ]
}
```

Tipos válidos: `feature` (🚀 nueva funcionalidad), `fix` (🔧 corrección), `improvement` (⚡ mejora), `prompt` (🧠 cambio de prompt).

Si ya existe una entrada para la fecha de hoy en `CHANGELOG_DATA`, añadir los nuevos entries al array existente del mismo día en lugar de crear un nuevo bloque.

Estimar las horas de forma razonable según la complejidad de cada cambio (0.5 - 4h).

## 4. Build

```bash
cd /Users/sergirodriguezzambrana/n8n/call-dashboard-app && npm run build
```

## 5. Deploy a Vercel

```bash
cd /Users/sergirodriguezzambrana/n8n/call-dashboard-app && npx vercel --prod
```

## 6. Confirmar al usuario

Informar al usuario de:
- Versión anterior → versión nueva
- Entradas añadidas al changelog
- URL de producción
