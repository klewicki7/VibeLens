# VibeLens — Patrones de referencia (gentle-ai, engram, Gentleman-Skills)

> Análisis de tres repos de Gentleman-Programming para extraer approaches reutilizables.
> Los tres están escritos en **Go** (el README de gentle-ai dice TypeScript, es incorrecto).
> VibeLens es TypeScript/Node (extensión VS Code + MCP server), así que algunos patrones
> se copian literal (conceptos) y otros se portan (implementación).

---

## Resumen de cada repo

| Repo | Qué es | Stack | Lo que nos sirve |
|------|--------|-------|------------------|
| **engram** | Memoria persistente para agentes IA, expuesta como MCP server | Go + SQLite/FTS5 + mcp-go | **Modelo de referencia para DB local + MCP bien hechos** |
| **gentle-ai** | Configurador de agentes (instala skills, MCP, SDD en Claude/Cursor/etc.) | Go + Bubbletea TUI | Patrones de skills registry, config injection, multi-editor adapters |
| **Gentleman-Skills** | Colección de skills (markdown + frontmatter) | Markdown puro | Formato y convención de skills |

---

## 1. Base de datos local (de engram) — el patrón más valioso

engram es la referencia de cómo hacer una DB local embebida bien. Para VibeLens (historial de reviews, skills, config por workspace), esto es directamente portable a TypeScript con `better-sqlite3`.

### 1.1 Configuración SQLite (portable literal)
```sql
PRAGMA journal_mode = WAL;     -- lecturas no bloquean escrituras
PRAGMA busy_timeout = 5000;    -- reintenta 5s antes de error
PRAGMA synchronous = NORMAL;   -- balance durabilidad/velocidad
PRAGMA foreign_keys = ON;
-- + una sola conexión de escritura (SQLite es single-writer)
```
**Por qué nos importa:** VS Code puede abrir varias ventanas → varios procesos tocando la misma DB. WAL + single-writer evita `SQLITE_BUSY`.

### 1.2 FTS5 con triggers automáticos (portable literal)
Tabla virtual FTS5 con `content='tabla'` + triggers AFTER INSERT/UPDATE/DELETE que mantienen el índice sincronizado solo. Búsqueda con BM25 nativo (`ORDER BY rank`). **Sin embeddings** — engram explícitamente eligió FTS5/BM25 sobre vectores para eliminar complejidad, y dice que cubre el 95% de los casos.
```sql
CREATE VIRTUAL TABLE reviews_fts USING fts5(
  title, summary, file_path, finding,
  content='reviews', content_rowid='id'
);
```

### 1.3 Migraciones sin framework (portable literal)
`CREATE TABLE IF NOT EXISTS` + helper `addColumnIfNotExists()` (lee `PRAGMA table_info`, hace `ALTER TABLE ADD COLUMN` si falta). Sin librería de migraciones mientras el schema sea simple.

### 1.4 Deduplicación por hash + ventana temporal (portable literal)
SHA256 del contenido normalizado (lowercase + whitespace collapse) + ventana de 15 min. Si el mismo diff genera el mismo review dos veces seguidas, incrementa `duplicate_count` en vez de duplicar. **Directo para VibeLens:** evita guardar el mismo review N veces.

### 1.5 Doble ID: PK local + sync_id global (adoptar)
`id INTEGER` (autoincrement, rápido para queries) + `sync_id TEXT` (UUID, portable para sync/relaciones cross-machine). Costo casi nulo, habilita sync futuro (Pilar E del roadmap).

### Schema sugerido para VibeLens
```sql
reviews(
  id INTEGER PK, sync_id TEXT UNIQUE, project TEXT, scope TEXT,
  commit_sha TEXT, diff_hash TEXT, title TEXT, summary TEXT,
  type TEXT, -- feature|fix|refactor|security|...
  created_at, updated_at, deleted_at, revision_count, duplicate_count
)
annotations(
  id INTEGER PK, review_id FK, file TEXT, line INTEGER,
  severity TEXT, -- info|suggestion|warning|risk
  explanation TEXT, status TEXT -- pending|reviewed|dismissed
)
reviews_fts USING fts5(...)  -- + triggers
```

---

## 2. MCP server (de engram) — cómo estructurarlo

engram usa el SDK de Go (`mark3labs/mcp-go`); nosotros usamos `@modelcontextprotocol/sdk` (TS). Los **conceptos** se portan:

### 2.1 Handler pattern con closures + inyección de deps (adoptar)
En vez de un handler monolítico con estado global (lo que tiene el repo actual), cada tool es una closure que recibe sus dependencias:
```typescript
function createSaveReview(store: Store, cfg: Config) {
  return async (params: SaveParams): Promise<ToolResult> => { /* ... */ }
}
server.tool("vibelens_save_review", schema, createSaveReview(store, cfg))
```

### 2.2 Validación con Zod desde el día 1 (adoptar — engram NO lo tiene)
engram valida a mano con type assertions de Go (no tiene Zod porque es Go). **Nosotros SÍ debemos usar Zod** para validar los inputs de cada tool y el contenido de `pending.json`. Esto cierra directamente el riesgo crítico C2 de la auditoría (confianza ciega en el payload).

### 2.3 Envelope de respuesta estructurado (adoptar)
Toda tool retorna JSON estructurado, no texto plano:
```json
{ "project": "vibelens", "result": "...", "review_id": 42, "findings_count": 3 }
```
Errores de dominio también como JSON con `error_code` + `hint`. El agente puede parsear y decidir.

### 2.4 Write queue para serializar escrituras (adoptar si hay concurrencia)
engram serializa todas las writes en un channel/worker único porque SQLite es single-writer. Con `better-sqlite3` (que es síncrono) es menos crítico, pero el concepto aplica si agregamos operaciones async.

### 2.5 Detección de proyecto desde cwd (adoptar)
Algoritmo de ~5 casos: config file > git remote URL > git root basename > child git repo > dir basename. Para VibeLens: detectar automáticamente en qué repo está el review sin que el agente lo diga. engram: `internal/project/detect.go`.

### 2.6 Tool profiles + deferred loading (futuro)
Segregar tools en `agent` (siempre en contexto) vs `admin`/raros (cargados con ToolSearch). Ahorra tokens del context window. Útil cuando VibeLens tenga 10+ tools.

---

## 3. Sistema de skills (de Gentleman-Skills + gentle-ai)

Esto habilita el **Pilar C (inteligencia del análisis)** del roadmap: "review skills" que definen cómo revisar distintos tipos de cambios.

### 3.1 Formato: SKILL.md con frontmatter YAML
```yaml
---
name: vibelens-review-security
description: >
  Security-focused diff review patterns.
  Trigger: When the diff touches auth, crypto, input validation, secrets, SQL.
metadata:
  author: kevin
  version: "1.0"
---
## When to Use
- [condiciones de activación]
## Critical Patterns
### What to flag
## Anti-Patterns
### Don't flag (falsos positivos a ignorar)
## Quick Reference
| Change type | Action | Severity |
```
El `Trigger:` embebido en `description` es el contrato de activación: el agente lo lee y matchea semánticamente.

### 3.2 Discovery por filesystem (de gentle-ai `skillregistry`)
- Escanea directorios: project-level primero (`.vibelens/skills/`), luego user-global (`~/.vibelens/skills/`)
- Project-level gana sobre global (override)
- Genera un índice (`skill-registry.md`) con nombre, trigger, scope, path
- Cache con fingerprint SHA1 de mtimes para no regenerar de gusto

### 3.3 Aplicación a VibeLens
Skills de review por tipo: `review-security`, `review-performance`, `review-api-breaking`, `review-migrations`, `review-tests`. El MCP server matchea el diff (archivos tocados, keywords) contra los skills disponibles e inyecta el correcto al construir el análisis. Los usuarios pueden agregar los suyos en `.vibelens/skills/` del repo.

---

## 4. Distribución y config injection (de gentle-ai)

### 4.1 WriteFileAtomic idempotente (adoptar — arregla A1 de la auditoría)
Antes de escribir config del usuario: comparar SHA con el contenido existente, escribir solo si difiere, usar write-to-temp + rename para atomicidad. **Esto arregla directamente el riesgo A1** (la extensión hoy sobrescribe `~/.cursor/mcp.json` destructivamente).

### 4.2 Section-marker injection (adoptar)
Inyectar bloques en configs del usuario con delimitadores:
```
<!-- vibelens:mcp -->
...contenido gestionado...
<!-- /vibelens:mcp -->
```
Updates reemplazan solo la sección marcada, nunca pisan lo que el usuario tiene alrededor. Mucho más seguro que el reemplazo actual.

### 4.3 MCPStrategy por editor (adoptar — Pilar A del roadmap)
Enum de estrategias de config según el editor:
- `separate-files` → Cursor: `~/.cursor/mcp.json`
- `merge-into-settings` → VS Code, otros
- archivo dedicado / TOML según el caso

Formaliza la lógica multi-editor que hoy está hardcodeada en `extension.ts`.

### 4.4 Adapter por editor (adoptar — Pilar A)
Interface `EditorAdapter` con `detect()`, `mcpConfigPath()`, `mcpStrategy()`, `openExternal()`. Factory + registry. Desacopla "qué editor" de "cómo configurarlo". engram/gentle-ai tienen ~15 adapters (claude, cursor, vscode, windsurf...). VibeLens necesita 3-4.

---

## 5. SDD como artefactos (de ambos repos)

Ambos usan Spec-Driven Development con artefactos persistidos por fase (`proposal → spec → design → tasks → apply → verify → archive`), guardados en engram (topic_key `sdd/{change}/{phase}`) o en `openspec/changes/{change}/`. **Es exactamente el flujo que ya estamos usando** para planificar VibeLens (modo hybrid). Nuestros `docs/` son la versión liviana de esto.

---

## 6. Decisión de arquitectura que esto desbloquea

El análisis cambia el panorama del **canal de comunicación** (la decisión #1 que teníamos pendiente):

**Opción que emerge:** en lugar de elegir entre "archivo endurecido" vs "socket", el patrón de engram sugiere un tercer camino más alineado al ecosistema: **una DB local SQLite como fuente de verdad** (no un JSON volátil en el home), donde:
- El MCP server escribe el review como fila en `reviews` + `annotations` (validado con Zod).
- La extensión lo lee de la DB (no de un JSON sin validar).
- Los `actions`/prompts de los botones se validan contra la DB y se confirman con el usuario antes del deeplink (cierra C1).
- Bonus: historial de reviews gratis (Pilar B/E del roadmap).

Esto resuelve C1, C2 y A1 de raíz y de paso habilita features futuras, a costa de más trabajo inicial que el simple "endurecer el JSON".

---

## 7. Qué NO copiar

- **Go / Bubbletea TUI**: VibeLens es extensión VS Code, no CLI terminal.
- **Cloud sync de engram** (Postgres, dashboard): fuera de scope hasta el Pilar E.
- **15 adapters de editor**: VibeLens necesita 3-4, no la matriz completa.
- **embed.FS de Go**: el equivalente es bundlear assets en el `.vsix` con esbuild.
- **LLM-as-judge de engram**: interesante para el Pilar C, pero no para Fase 0.

---

## Referencias (rutas en los repos clonados, por si volvemos a mirar)
- engram DB: `internal/store/store.go` (schema, FTS5, dedup, upsert)
- engram MCP: `internal/mcp/mcp.go`, `internal/mcp/write_queue.go`
- engram project detect: `internal/project/detect.go`
- gentle-ai skills registry: `internal/skillregistry/registry.go`
- gentle-ai config injection: `internal/components/filemerge/`, `internal/components/mcp/inject.go`
- gentle-ai editor adapters: `internal/agents/interface.go` + `internal/agents/*/adapter.go`
- Gentleman-Skills formato: `curated/*/SKILL.md`, `SKILL_TEMPLATE.md`
