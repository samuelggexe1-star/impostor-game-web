# ♠️ Hold'em Club

Texas Hold'em No Limit para jugar con tus amigos desde el navegador. Sin registro,
sin servidor que mantener y sin instalar nada: uno crea la mesa, comparte un código
de 4 letras y los demás entran desde su móvil o su portátil.

## Jugar con los amigos que están en tu wifi

Esta es la forma más fiable: no depende de internet ni de servidores de terceros.

```bash
npm start
```

Al arrancar te dice exactamente qué direcciones repartir:

```
  ♠️  Hold'em Club en marcha

  En este ordenador:   http://localhost:8080

  Para tus amigos en la misma wifi:
      http://192.168.1.42:8080
```

1. Tú abres `http://localhost:8080` y pulsas **Crear mesa**.
2. Tus amigos abren `http://192.168.1.42:8080` (la dirección que te haya salido)
   desde el móvil o el portátil, **conectados a la misma wifi**.
3. En la pestaña **Unirme** les aparece tu mesa en la lista: un toque y dentro.
   Si prefieres, les pasas el código de 4 letras.

El ordenador que ejecuta `npm start` hace de servidor, así que tiene que quedarse
encendido mientras jugáis. El puerto se cambia con `PORT=3000 npm start`.

> El servidor solo pasa mensajes de un navegador a otro: no conoce las reglas ni
> ve las cartas. Quien reparte sigue siendo el navegador del anfitrión. Como no
> lleva contraseñas, úsalo en una red de confianza (tu casa), no en una wifi
> pública.

## Jugar con amigos que no están en tu casa

Si publicas la web (GitHub Pages, por ejemplo) no hay servidor que ejecutar, y la
partida usa conexión directa entre navegadores (WebRTC):

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

## Publicarlo en internet

La web es estática, así que se puede servir tal cual. Con **GitHub Pages**: en
*Settings → Pages*, elige la rama y la carpeta raíz; en un minuto tendrás algo como
`https://usuario.github.io/impostor-game-web/`. Ahí no hay servidor propio, así que
las mesas usan WebRTC.

En cualquier caso hace falta servirlo por HTTP (no vale abrir `index.html` con doble
clic) porque el código usa módulos ES.

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
├── net.js        Sesiones local / anfitrión / invitado (WebRTC o red local)
├── lan.js        Transporte para la wifi de casa contra server.js
├── sound.js      Efectos con WebAudio
├── fx.js         Confeti, fichas voladoras, tweens
├── ui.js         Pintado de la mesa y animaciones
└── app.js        Vestíbulo, ajustes y arranque
```

Y `server.js` en la raíz: sirve la web y hace de centralita para el modo wifi. No
tiene dependencias: solo Node.

El motor (`engine.js`) es lógica pura: no toca el DOM ni la red, así que se puede
probar entero desde Node.

Las dos formas de conectar hablan el mismo protocolo, así que el resto del juego no
sabe (ni le importa) si los mensajes llegan por WebRTC o por la red de casa.

## Pruebas

```bash
npm test          # 35 pruebas, sin dependencias externas
```

Cubren las reglas que más fácil se rompen (ciegas heads-up, subida mínima, all-in
corto, botes laterales, empates, conservación de fichas en 40 manos aleatorias), el
protocolo de red con un PeerJS simulado —incluyendo que un invitado nunca reciba las
cartas ajenas— y la centralita local: reparto de mensajes, salas que no se mezclan,
códigos que no se pueden robar y rutas que no salen de la carpeta.

## Limitaciones

- Si el anfitrión cierra la pestaña, la mesa se cierra. No hay partidas persistentes.
- En modo wifi, el ordenador que ejecuta `npm start` debe seguir encendido.
- WebRTC (el modo por internet) puede fallar en redes muy restrictivas —algunas
  corporativas o con VPN—; en tu casa, usa el modo wifi y te ahorras el problema.
- El servidor local no pide contraseña: cualquiera en esa wifi puede entrar en una
  mesa si sabe el código. Para jugar en casa está bien; no lo expongas a internet.
- Las fichas son de mentira: esto es para jugar entre amigos, no para apostar dinero.
