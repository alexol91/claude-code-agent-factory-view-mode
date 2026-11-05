# 🏢 Oficina

**Una oficina pixel art para Claude Code: Claude y sus subagentes trabajan en su mesa, y ves en qué proyecto está cada uno y qué hace.**

Fork de [Factory View](https://github.com/metetik/claude-code-agent-factory-view-mode) (metetik, MIT) con:

- **Avatares por proyecto.** Cada repo puede traer sus propios sprites PNG en `.claude/avatars/`; cuando lanzas una
  tarea multirepo desde la carpeta padre, cada subagente lleva el avatar del repo que está tocando.
- **Bocadillos de acción** en español: «Leyendo TaskService.php», «Ejecutando tests», «Pensando…».
- **Detalle de actividad**: elige un agente y ve sus últimas llamadas a herramientas, agrupadas, con su duración y en
  rojo las que fallaron.
- **Más decoración** (pizarra, estantería, reloj, plantas, cafetera) e **interfaz en español**.

## 📦 Instalar

En Claude Code:

```
/plugin marketplace add alexol91/claude-code-agent-factory-view-mode
/plugin install oficina@oficina
```

## 🧑‍🎨 Avatares de un proyecto

```
<repo>/.claude/avatars/
  avatar.png                      un solo dibujo
  avatar-1.png … avatar-12.png    o fotogramas de una animación, en orden
  avatar.json                     opcional: { "nombre": "Freezer", "fps": 4 }
```

- PNG con fondo transparente, como mucho 128×128 px (mejor de 32×32 a 64×64) y 20 KB cada uno; 60 KB por repo.
- Todos los fotogramas miden lo mismo.
- El mod dibuja encima la mesa, el bocadillo y los iconos de estado (✓, !, z).
- Tras cambiar los sprites, `/oficina recargar`.
- Los avatares se ven en la app de escritorio (y en el móvil); en la terminal se usan los de siempre, con el nombre
  del repo en la mesa.

## ⌨️ Comandos

| Comando | Hace |
|---|---|
| `/oficina` | Abre o cierra el panel |
| `/oficina vestir <quién> color=… sombrero=… extra=…` | Viste al jefe (`jefe`), a un tipo o a un agente por su etiqueta |
| `/oficina restablecer [quién]` | Vuelve al aspecto por defecto |
| `/oficina aspecto azar\|tipo` | Cómo visten los que nadie vistió |
| `/oficina tamaño pequeño\|mediano\|grande` | En escritorio, cuántas mesas caben por fila (pequeño: muchas; grande: tres y agentes más grandes); en la terminal, el tamaño del dibujo |
| `/oficina despejar` | Manda a casa a los que terminaron |
| `/oficina demo` | Añade o quita seis agentes de prueba |
| `/oficina opciones` | Lista colores, sombreros y extras |
| `/oficina recargar` | Vuelve a leer las carpetas `.claude/avatars` |

## 🔒 Privacidad

Todo es local: el mod no llama al modelo, no se conecta a internet y solo lee las carpetas `.claude/avatars` y
comprueba si existen `.claude/avatars` o `.git` en las carpetas que tocan tus agentes.

## 🛠️ Desarrollo

```
claude plugin test .
claude plugin validate .
bun scripts/preview.ts <carpeta> [agentes] [columnas]
```

## 📄 Licencia y créditos

MIT. Basado en [Factory View](https://github.com/metetik/claude-code-agent-factory-view-mode) de metetik. La
agrupación de la actividad está adaptada de mission-control
([hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods), MIT).
