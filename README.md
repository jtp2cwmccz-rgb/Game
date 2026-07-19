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

## Minijuegos

| Juego | Descripción |
|---|---|
| 🤸 Flip Jump | Mantén pulsado para cargar, suelta para saltar: aterriza el salto mortal en la siguiente plataforma. Centro de la plataforma = ¡PERFECTO! con combo. Si caes, fin de la partida. |
| ☯️ Dúo Neón | Estilo *Duet*: dos esferas (cian y rosa) orbitan un eje. Toca izquierda/derecha para girarlas y esquivar los bloques que caen (¡giran y aceleran por niveles!). +100 por bloque; un golpe y se acabó. |
| 🪜 Escalera Infinita | Estilo *Infinite Stairs*: sube la escalera en zigzag con SUBIR (recto) y GIRAR (cambia de lado). +10 por escalón; un paso al vacío o quedarte sin energía termina la partida, y el desgaste crece con la altura. |

El catálogo está pensado para crecer: añade más juegos al array `GAMES` de `js/games.js` y entran solos en la rotación diaria. Todos los minijuegos usan un **RNG determinista sembrado con la fecha**, así que el reto (distancias y anchos de plataforma) es idéntico para todos los jugadores del día.

## El Tablero 🎲 (estilo la oca)

Cada victoria mueve tu ficha en un tablero de 40 casillas en serpiente:

- Cada partida del reto diario → avanzas **1–6 casillas** según tu puntuación (500 pts ≈ 1 casilla).
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
