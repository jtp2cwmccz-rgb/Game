# ⚡ Daily Buddy Battles

App web competitiva para jugar con amigos: **cada día hay un minijuego distinto**, todos con el mismo reto (misma semilla diaria), y gana quien haga más puntos.

Diseño basado en el design system **"Daily Duel Neon"** del proyecto de Stitch *Daily Buddy Battles*: estética Neo-Arcade con fondo espacio profundo, neón morado eléctrico / cian / rosa, glassmorphism, botones 3D táctiles y tipografías Lexend + Inter + Space Grotesk.

## Cómo jugar

1. Abre `index.html` en el navegador (o sirve la carpeta con `python3 -m http.server` / `npx serve`).
2. Elige tu nombre y avatar.
3. Juega el **reto del día** — la rotación cambia a medianoche y es la misma para todo el mundo.
4. Compite:
   - **Duelo pasa-y-juega**: tú y un amigo jugáis el mismo reto en el mismo móvil, con tarjeta VS y ganador.
   - **Códigos de resultado**: copia tu código `DDB1.…`, envíaselo a tus amigos por chat, y pega los suyos para montar la clasificación del día, de la semana y total.

## Minijuegos en rotación (7)

| Juego | Descripción |
|---|---|
| ⚡ Duelo de Reflejos | Toca al instante cuando el panel se ilumina (5 rondas) |
| 🧠 Memoria Neón | Encuentra los 8 pares en el menor tiempo |
| ➗ Cálculo Rápido | 45 s de operaciones contrarreloj con racha |
| 🔤 Palabra Oculta | Reordena letras y forma palabras (60 s) |
| 🎼 Secuencia Neón | Repite la secuencia de luces estilo Simon |
| 🎯 Lluvia de Dianas | Revienta dianas que se encogen (30 s) |
| 💓 Pulso Perfecto | Frena el cursor en la zona verde (5 intentos) |

Todos los minijuegos usan un **RNG determinista sembrado con la fecha**, así que el reto es idéntico para todos los jugadores del día.

## El Tablero 🎲 (estilo la oca)

Cada victoria mueve tu ficha en un tablero de 40 casillas en serpiente:

- Completar el reto diario → avanzas **1–6 casillas** según tu puntuación (500 pts ≈ 1 casilla; solo la primera partida del día).
- Ganar un duelo → **+3 casillas**.
- Pegar el código de un amigo → su ficha también avanza.
- 🌀 **Portal turbo** (casillas 6, 12, 18, 24, 30, 36): saltas al siguiente portal, "de oca a oca".
- 🕳️ **Agujero negro** (9, 21, 33): retrocedes 3.
- 🏁 **Meta** (casilla 40): ganas la temporada, insignia para el vencedor y el tablero se reinicia.

## Pantallas

- **Inicio** — reto de hoy, cuenta atrás, racha 🔥, mini-ranking y próximos retos.
- **Sala de Duelo** — tarjeta VS, duelo pasa-y-juega, compartir/importar códigos, historial.
- **Tablero** — la carrera estilo oca con las fichas de todos los jugadores.
- **Clasificación** — pódium con medallas (hoy / semana / total).
- **Perfil** — estadísticas, insignias desbloqueables y actividad reciente.

## Stack

HTML + CSS + JavaScript vanilla, sin dependencias ni build. Los datos se guardan en `localStorage`. Funciona offline (las fuentes de Google Fonts tienen fallback del sistema).
