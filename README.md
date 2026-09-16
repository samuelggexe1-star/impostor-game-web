# ♠️ Hold'em Club

Texas Hold'em No Limit para jugar con tus amigos desde el navegador. Sin registro,
sin servidor que mantener y sin instalar nada: uno crea la mesa, comparte un código
de 4 letras y los demás entran desde su móvil o su portátil.

## Cómo se juega

1. Abre la web y escribe tu nombre.
2. **Crear mesa** → obtienes un código (por ejemplo `KQ7M`) y un enlace para compartir.
3. Tus amigos entran en **Unirme**, escriben el código y ya están sentados.
4. Puedes rellenar los huecos con bots mientras llega la gente.

> El que crea la mesa hace de crupier: mientras tenga la pestaña abierta la partida
> sigue viva. Si la cierra, se acaba la mano para todos.

¿Solo quieres practicar? La pestaña **Practicar** abre una mesa contra bots sin
necesidad de conexión con nadie.

## Qué trae

**Reglas completas de No Limit**
- Ciegas, antes y botón que rota; heads-up con las ciegas invertidas.
- Subida mínima real, all-in corto que no reabre la subida, opción de la ciega grande.
- Botes laterales por cada all-in, empates repartidos y fichas sueltas a la izquierda del botón.
- Desempates por los mejores 5 naipes de 7, con la jugada resaltada en el showdown.

**La mesa**
- Reparto carta a carta, volteo en 3D, fichas que vuelan al bote y del bote al ganador.
- Confeti y lluvia de monedas al llevarte un bote, contadores de fichas animados.
- Anillo de tiempo en el jugador que habla, banco de tiempo y auto-check/fold al agotarse.
- Burbujas de acción, sello de ALL-IN, botón del crupier que se desliza entre asientos.
- Sonido sintetizado (cartas, fichas, golpe de check, victoria…): cero archivos que descargar.

**Para la partida con amigos**
- Chat y emojis que se lanzan sobre el tapete.
- Historial de manos con el board y quién ganó qué.
- Estadísticas por jugador: manos, % de manos ganadas y VPIP.
- Probabilidad de ganar en vivo (Montecarlo) y nombre de tu jugada actual.
- Acciones anticipadas, atajos de teclado, control de apuesta con ½ / ¾ / bote / all-in.
- Modo torneo con subida de ciegas por tiempo, o cash con recargas.
- Bots con seis personalidades distintas (roca, pescado, tiburón, maníaco…).
- Ajustes: volumen, velocidad de animación, baraja de 4 colores, cuatro tapetes.
- Aviso de turno aunque tengas la pestaña en segundo plano.
- Funciona en móvil y respeta `prefers-reduced-motion`.

## Publicarlo

Es una web estática: sirve la carpeta tal cual.

Con **GitHub Pages**: en *Settings → Pages*, elige la rama y la carpeta raíz. En un
minuto tendrás algo como `https://usuario.github.io/impostor-game-web/`.

En local:

```bash
python3 -m http.server 8000   # y abre http://localhost:8000
```

Hace falta servirlo por HTTP (no vale abrir `index.html` con doble clic) porque el
código usa módulos ES.

## Cómo funciona por dentro

No hay backend. El anfitrión ejecuta el motor del juego en su navegador y manda a
cada jugador **su** copia del estado, ya censurada: las cartas de los demás no salen
del navegador del anfitrión hasta el showdown. La conexión es WebRTC directa entre
navegadores mediante [PeerJS](https://peerjs.com); su servidor público solo sirve
para que los navegadores se encuentren, los datos de la partida no pasan por él.

```
js/
├── cards.js      Baraja, barajado y azar (con PRNG determinista para los tests)
├── evaluator.js  Mejor jugada de 5 entre 7 cartas
├── odds.js       Equity por Montecarlo y puntuación Chen
├── engine.js     Reglas de Hold'em: turnos, apuestas, botes laterales, showdown
├── table.js      Ritmo de la partida: tiempos, temporizadores, bots, niveles
├── bots.js       Decisión de los bots según personalidad
├── net.js        Sesiones local / anfitrión / invitado sobre PeerJS
├── sound.js      Efectos con WebAudio
├── fx.js         Confeti, fichas voladoras, tweens
├── ui.js         Pintado de la mesa y animaciones
└── app.js        Vestíbulo, ajustes y arranque
```

El motor (`engine.js`) es lógica pura: no toca el DOM ni la red, así que se puede
probar entero desde Node.

## Pruebas

```bash
npm test          # 26 pruebas, sin dependencias externas
```

Cubren las reglas que más fácil se rompen (ciegas heads-up, subida mínima, all-in
corto, botes laterales, empates, conservación de fichas en 40 manos aleatorias) y el
protocolo de red con un PeerJS simulado, incluyendo que un invitado nunca reciba las
cartas ajenas.

## Limitaciones

- Si el anfitrión cierra la pestaña, la mesa se cierra. No hay partidas persistentes.
- WebRTC puede fallar en redes muy restrictivas (algunas corporativas o con VPN);
  en ese caso el juego avisa y puedes seguir en modo local.
- Las fichas son de mentira: esto es para jugar entre amigos, no para apostar dinero.
