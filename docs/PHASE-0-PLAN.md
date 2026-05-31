# VibeLens — Plan de Fase 0 (Hardening + Rebrand + MVP "wow")

> Consolida las 4 decisiones de producto en un plan ejecutable.
> Objetivo de la fase: convertir el fork heredado en VibeLens — seguro, propio, y con el
> "truco mágico" (cada cambio de la IA se auto-explica) andando en **Claude Code y Cursor**.

---

## Decisiones que rigen esta fase

| Decisión | Elección | Consecuencia técnica |
|----------|----------|----------------------|
| **Canal** | SQLite como fuente de verdad | DB local reemplaza `pending.json`; MCP escribe filas validadas con Zod; extensión lee de la DB |
| **Inteligencia** | Agente existente vía MCP | No hay modelo propio; el agente que hizo el cambio genera el análisis con contexto fresco |
| **Enforcement** | Hook + Skill, multi-editor | `afterFileEdit` (Cursor) + `PostToolUse` (Claude Code) obligan; skill enseña el cómo |
| **Monetización** | Open source puro | MIT, local-first, cero backend/auth/billing |
| **MVP** | Wow + multi-editor | Auto-explicación funcionando en Claude Code Y Cursor |

**Verificado:** Cursor tiene hooks determinísticos (`~/.cursor/hooks.json`, hook `afterFileEdit`),
equivalentes a los de Claude Code. El enforcement multi-editor es viable en ambos.

---

## Arquitectura objetivo de Fase 0

```
   Agente (Claude Code / Cursor)
   │  1. edita archivos
   │  2. hook afterFileEdit / PostToolUse dispara enforcement
   │  3. skill instruye: llamá show_diff_explanation con el análisis
   ▼
   MCP Server (vibelens-mcp)
   │  4. valida input con Zod
   │  5. escribe review + annotations en SQLite  ◄── fuente de verdad
   ▼
   ~/.vibelens/vibelens.db   (SQLite + FTS5, WAL, 0700)
   ▲
   │  6. extensión observa cambios (o consulta la DB)
   │  7. valida/confirma action prompts antes de deeplink
   ▼
   Extensión VS Code/Cursor → Webview (diff + anotaciones, historial)
```

---

## Work breakdown (slices verticales)

### Slice 0 — Limpieza y ownership (rápido, desbloquea todo)
- [ ] Rebrand `explain-changes` → `vibelens` (nombres de paquete, `~/.explain-changes/` → `~/.vibelens/`)
- [ ] `.gitignore`: sacar `dist/` y `.vsix` del repo (L5); borrar `package-lock.json` (usamos pnpm)
- [ ] Sincronizar versiones (root/mcp/extension) + `Server()` (L4)
- [ ] Linter (eslint/biome) + formato + setup de tests (L6, L7)
- [ ] Sacar `console.log` de producción (L1) y variable muerta `_currentEditor` (L2)

### Slice 1 — DB local como fuente de verdad (el core)
- [ ] `better-sqlite3` + schema `reviews` / `annotations` / FTS5 (patrón engram)
- [ ] PRAGMAs: WAL, busy_timeout, foreign_keys; dir `~/.vibelens/` con permisos 0700
- [ ] Capa de acceso (store) con migraciones `addColumnIfNotExists`
- [ ] Dedup por hash + ventana temporal; doble id (PK + sync_id)
- [ ] Detección de proyecto desde cwd (git remote/root)

### Slice 2 — MCP server endurecido (cierra C2)
- [ ] Validación Zod de todos los inputs de la tool `show_diff_explanation`
- [ ] El MCP escribe en SQLite (no en JSON) — filas validadas
- [ ] Envelope de respuesta estructurado
- [ ] Manejo de errores con try/catch + límite de tamaño de diff (M4, M5)
- [ ] Handler pattern con closures + inyección de deps

### Slice 3 — Extensión segura (cierra C1, A1, A2, A3)
- [ ] Leer de la DB (no de JSON sin validar)
- [ ] **Confirmación del usuario** del prompt completo antes del deeplink (cierra C1)
- [ ] Config injection idempotente + section-markers `<!-- vibelens:mcp -->` (cierra A1)
- [ ] Bundlear diff2html localmente con esbuild — sin CDN (cierra A2)
- [ ] CSP con nonce, sin orígenes externos (cierra A3); fuentes locales (A4)
- [ ] EditorAdapter (Cursor/VS Code) con MCPStrategy enum (Pilar A)

### Slice 4 — Enforcement multi-editor (el "wow")
- [ ] Hook `afterFileEdit` para Cursor (`~/.cursor/hooks.json`)
- [ ] Hook `PostToolUse` para Claude Code (`settings.json`)
- [ ] Skill `vibelens-explain-changes` (SKILL.md con frontmatter + Trigger)
- [ ] Regla en AGENTS.md/CLAUDE.md como fallback universal
- [ ] Instalación automática (idempotente) de hooks + skill al activar la extensión

### Slice 5 — Historial navegable (yapa del MVP)
- [ ] Vista de historial de reviews en el webview (leyendo la DB)
- [ ] Navegación entre reviews pasados por proyecto/commit

---

## Orden de ejecución sugerido

1. **Slice 0** (limpieza) — desbloquea, bajo riesgo
2. **Slice 1** (DB) — fundación de todo
3. **Slice 2** (MCP) — depende de 1
4. **Slice 3** (extensión segura) — depende de 1 y 2
5. **Slice 4** (enforcement) — el diferenciador; depende de 2
6. **Slice 5** (historial) — yapa; depende de 1 y 3

> Slices 0–4 = MVP demostrable. Slice 5 es el bonus que muestra el valor de la DB.

---

## Definición de "listo" para la demo (MVP)

1. En **Claude Code**: la IA hace un cambio → automáticamente aparece el panel de VibeLens con el diff explicado.
2. En **Cursor**: lo mismo, vía `afterFileEdit`.
3. Cero CDN, CSP estricta, sin prompt injection, sin sobrescribir configs del usuario.
4. El review queda guardado en la DB local (historial).

---

## Lo que queda FUERA de Fase 0 (fases siguientes)

- Inteligencia avanzada (detección automática de riesgos/regresiones) — Pilar C
- Comentarios inline del usuario + threads — Pilar B4
- Integración con GitHub PRs, exportar review — Pilar E
- Más editores además de Claude Code y Cursor (Windsurf, etc.)
- Telemetría opt-in
