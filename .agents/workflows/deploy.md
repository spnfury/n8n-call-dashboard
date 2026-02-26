---
description: Deploy a producción — bump de versión y changelog
---
// turbo-all

## Pasos para deploy a producción

1. **Bump de versión** en `call-dashboard-app/index.html`:
   - Buscar la línea con `v0.0.X` (en el `<small>` del header)
   - Incrementar el número minor (ej: v0.0.4 → v0.0.5)

2. **Añadir entrada al changelog** en `call-dashboard-app/main.js`:
   - Localizar el array `CHANGELOG_DATA` (~línea 4398)
   - Añadir un nuevo objeto al **inicio** del array con la fecha de hoy
   - Cada entrada lleva: `type` (feature/fix/improvement/prompt), `title`, `hours`, `desc`
   - Incluir una entrada de tipo `improvement` con el bump de versión
   - Incluir todas las demás entradas de cambios realizados desde el último deploy

3. **Commit**:
```bash
git add -A && git commit -m "chore: bump version to v0.0.X + changelog update"
```

4. **Push a GitHub** (puede requerir desbloquear secretos):
```bash
git push origin main
```
   > ⚠️ Si GitHub Push Protection bloquea el push por la API key de OpenAI,
   > visitar el link que da el error para desbloquear, o deployar directo con Vercel CLI.

5. **Deploy a Vercel**:
```bash
npx -y vercel --prod --yes
```
   - Esto despliega directo a `https://skypulsebot.vercel.app`
   - No requiere que el push a GitHub haya funcionado

6. **Verificar** que la nueva versión aparece en la esquina superior del dashboard.
