# VibeLens — Visión de producto

> 🔍 **VibeLens** — la lente sobre lo que vibe-codeaste.
> Cuando la IA escribe código en segundos, vos te quedás scrolleando el chat esperando haber
> entendido qué hizo. VibeLens le da a la IA el mismo workflow que usan los humanos: **revisar
> el diff, anotarlo y explicar el razonamiento** — en un panel dentro de tu editor.

Este documento es el norte. No es un compromiso cerrado: es la dirección para discutir y recortar.
Lo que entra a cada release sale del SDD; esto es el mapa completo.

---

## 1. El problema

La asimetría está rota: la IA genera cambios multi-archivo en segundos, pero entenderlos sigue
siendo manual. Hoy el "review" del vibe coder es:
1. Leer la explicación del chat.
2. Abrir el diff.
3. Mapear mentalmente una cosa con la otra.

VibeLens cierra esa brecha: **peer review de la IA sobre su propio código**, visual e inline.

---

## 2. Para quién

- **Vibe coders**: aceptan cambios grandes de la IA y necesitan entenderlos rápido sin leer todo.
- **Devs con asistente**: quieren un check de sanidad antes de aceptar/commitear lo que generó la IA.
- **Equipos**: quieren trazabilidad de qué tocó la IA y por qué.

---

## 3. Principios de diseño

1. **Confianza primero.** Nada que venga de la IA se ejecuta sin que el humano vea exactamente qué.
2. **Agnóstico de editor y agente.** Cursor, VS Code, Windsurf, Claude Code… el core no depende de uno.
3. **Cero fricción.** Aparece solo cuando aporta; no molesta.
4. **Local-first.** Los diffs no salen de la máquina salvo opt-in explícito.

---

## 4. Pilares de producto (las "todas las funcionalidades")

### Pilar A — Canal y compatibilidad (fundacional)
> Reemplaza el frágil `pending.json` y abre el producto a más editores/agentes.

- **A1** Canal seguro MCP ↔ extensión (reemplazo de `pending.json`, ver `AUDIT-FIXES.md` R1).
- **A2** Abstracción de "editor target": detectar y soportar Cursor, VS Code, Windsurf.
- **A3** Soporte multi-agente: que cualquier agente con MCP pueda disparar un review (no solo Cursor).
- **A4** Multi-root workspace y multi-ventana sin colisiones.

### Pilar B — Experiencia de review (el corazón)
> Convertir el panel pasivo en una herramienta de review real.

- **B1** Navegación entre archivos del diff (árbol/lista, saltos, "siguiente cambio").
- **B2** Estados por archivo/hunk: **revisado / pendiente / con observación**.
- **B3** Anotaciones con **severidad** (info / sugerencia / warning / riesgo) y filtros.
- **B4** Comentarios inline del usuario + threads (responderle a la IA y pedir cambios).
- **B5** Acciones seguras: "pedir cambio", "explicame esto", "rechazar" — con confirmación (cierra C1).
- **B6** Resumen ejecutivo del cambio (qué, por qué, riesgos) arriba del diff.
- **B7** Diff side-by-side / unified toggle, word-level highlight, colapso de hunks sin cambios.

### Pilar C — Inteligencia del análisis
> Que la IA no solo describa el diff, sino que haga review real.

- **C1** Detección automática de riesgos: regresiones, edge cases, secrets, deps inseguras.
- **C2** Clasificación de cambios: feature / fix / refactor / config / test.
- **C3** "Qué podría romper esto": impacto sobre el resto del código (callers, tests).
- **C4** Checklist de review configurable (estilo del equipo) que la IA completa.
- **C5** Comparar contra el objetivo original de la tarea ("¿hizo lo que se pidió?").

### Pilar D — Robustez y producto serio
> De prototipo a algo publicable y mantenible.

- **D1** Seguridad: todos los fixes 🔴/🟠 de `AUDIT-FIXES.md`.
- **D2** Tests (unit + integración del puente) y CI.
- **D3** Linter + formato + convención de commits.
- **D4** Settings configurables (auto-open, severidad mínima, fuentes, tema).
- **D5** Telemetría **opt-in** y anónima (qué features se usan).
- **D6** Publicación: VS Code Marketplace + Open VSX (Cursor/Windsurf) + npm para el MCP.
- **D7** Onboarding: primer-uso guiado, docs, screenshots.

### Pilar E — Colaboración / equipo (futuro)
> Más allá del uso individual.

- **E1** Exportar el review (markdown/HTML) para adjuntar al PR.
- **E2** Historial de reviews por sesión/branch.
- **E3** Integración con GitHub PRs (postear las anotaciones como comentarios).
- **E4** Reglas de equipo compartidas (checklist C4 versionado en el repo).

---

## 5. Roadmap por fases (propuesta)

| Fase | Foco | Pilares | Resultado |
|------|------|---------|-----------|
| **0 — Hardening** | Arreglar lo heredado + rebrand a VibeLens | D1, A1 | Base segura y propia |
| **1 — Review real** | Panel usable de verdad | B1–B6 | El producto que prometemos |
| **2 — Inteligencia** | La IA hace review, no narración | C1–C3 | Diferencial competitivo |
| **3 — Producto** | Publicable y configurable | D2–D7, A2–A3 | Release público multi-editor |
| **4 — Equipo** | Colaboración | E1–E4, C4–C5 | Adopción en equipos |

---

## 6. Qué NO es VibeLens (anti-scope, por ahora)

- No es un linter ni un reemplazo de tu CI.
- No es un cliente de PRs completo (integra, no reemplaza a GitHub).
- No ejecuta código por su cuenta jamás.

---

## 7. Decisiones abiertas (para discutir)

1. **Canal A1**: ¿socket local, IPC, o archivo endurecido? (trade-off simplicidad vs. seguridad).
2. **Inteligencia C**: ¿el análisis lo hace el agente que ya está (vía MCP) o VibeLens llama a un modelo propio?
3. **Monetización**: ¿open source puro, freemium, o de pago para equipos? Define E y D5/D6.
4. **Alcance de la v1 pública**: ¿hasta dónde de B/C entra antes de publicar?
