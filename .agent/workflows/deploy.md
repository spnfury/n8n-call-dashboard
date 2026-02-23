---
description: Deploy a producción — bump de versión y changelog
---

# Deploy a Producción

Cada vez que se despliegue un cambio a producción, seguir estos pasos **obligatoriamente**:

## 1. Bump de versión

Incrementar la versión en estos 2 ficheros:

- **`call-dashboard-app/package.json`**: campo `"version"`
- **`call-dashboard-app/index.html`**: el texto `v0.X.X` en el `<small>` del header (línea ~40)

Usar versionado semántico simplificado:
- **Patch** (0.0.X → 0.0.X+1): fixes, mejoras menores, cambios de prompt
- **Minor** (0.X.0): nuevas funcionalidades visibles para el usuario
- **Major** (X.0.0): cambios de arquitectura o rediseño completo

## 2. Añadir entrada al changelog

En **`call-dashboard-app/main.js`**, añadir una nueva entrada al principio del array `CHANGELOG_DATA` con la fecha de hoy y los cambios realizados.

Formato de cada entrada:
```javascript
{
    date: 'YYYY-MM-DD',
    entries: [
        { type: 'feature|fix|improvement|prompt', title: 'Título corto', hours: X, desc: 'Descripción detallada del cambio.' },
    ]
}
```

Tipos válidos: `feature` (🚀), `fix` (🔧), `improvement` (⚡), `prompt` (🧠)

Si ya existe una entrada para la fecha de hoy, añadir los nuevos entries al array existente en lugar de crear un nuevo bloque de fecha.

## 3. Build y deploy

// turbo
```bash
cd /Users/sergirodriguezzambrana/n8n/call-dashboard-app && npm run build
```

// turbo
```bash
cd /Users/sergirodriguezzambrana/n8n/call-dashboard-app && npx vercel --prod
```

## 4. Verificar

Abrir la URL de producción y confirmar que la versión actualizada se muestra en el header.
