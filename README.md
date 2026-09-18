# 🎲 Sala de juegos

Cuatro juegos de cartas para echar partidas con tus amigos desde el navegador. Sin
registro y sin instalar nada: uno crea la sala, comparte un código de 4 letras y los
demás entran desde su móvil, su tablet o su portátil.

| | | |
|---|---|---|
| ♠️ **Texas Hold'em** | Poker No Limit completo: botes laterales, all-in, torneo con ciegas que suben. | |
| 🃏 **UNO** | El de toda la vida: colores, +2, +4, cambio de sentido y cantar ¡UNO! antes de que te pillen. | |
| 🂡 **Blackjack** | Llegar a 21 sin pasarse. Doblar, dividir, pago 3 a 2 y la banca plantándose en 17. | |
| 🔮 **Alto o bajo** | ¿La siguiente será más alta o más baja? Todos a la vez, tres vidas y gana el que aguante. | |

**Las salas viven en el servidor.** Él baraja, reparte y lleva los tiempos, así que
nadie tiene que dejar su dispositivo encendido haciendo de crupier: si se te apaga la
pantalla o cierras la tapa, la partida sigue y tu sitio te espera. Y como todo viaja
por HTTPS normal, funciona también en redes que bloquean casi todo, como las de los
colegios.

## Ponerlo en marcha (vale desde un iPad, sin terminal)

Necesitas que el juego esté colgado en algún sitio. Con [Render](https://render.com)
son unos toques y el plan gratuito sobra:

1. Entra en Render y pulsa **New → Blueprint**.
2. Elige este repositorio. El archivo `render.yaml` ya le dice todo lo que necesita.
3. Espera a que despliegue y quédate con la dirección que te da, algo como
   `https://sala-de-juegos.onrender.com`.
4. Esa dirección es la que repartes. Todos la abrís, elegís juego, uno pulsa **Crear**
   y comparte el código o el enlace.

> Ojo con el plan gratuito de Render: si nadie juega durante un rato, el servidor se
> duerme. El primero en entrar esperará cerca de un minuto a que despierte. A partir
> de ahí va fino.

Si prefieres levantarlo en tu ordenador (hace falta Node 18 o más nuevo):

```bash
npm start
```

Te imprime la dirección de tu red local para repartirla a quien esté en la misma wifi.
Esto sirve en casa; en una wifi de colegio no, porque esas redes suelen impedir que
los dispositivos se vean entre sí.

## Jugar

1. Abrís la dirección, escribís vuestro nombre y elegís juego en el hub.
2. **Crear** → sale un código de 4 letras. Tocando el código se copia un enlace de
   invitación (`…?sala=ABCD&juego=uno`) que entra directo.
3. Los demás entran en **Unirme** con el código, o simplemente abren el enlace.
4. Podéis rellenar los huecos con bots mientras llega la gente.

¿Solo quieres practicar? La pestaña **Practicar** abre una partida contra bots en tu
propio dispositivo, sin conexión con nadie.

**Si se te bloquea el iPad o recargas sin querer, la página vuelve sola a la sala
donde estabas.** No hay que apuntar el código en ningún sitio.

## Qué trae cada juego

**Texas Hold'em**
- Ciegas, antes y botón que rota; heads-up con las ciegas invertidas.
- Subida mínima real, all-in corto que no reabre la subida, opción de la ciega grande.
- Botes laterales por cada all-in, empates repartidos y fichas sueltas a la izquierda
  del botón.
- Desempates por los mejores 5 naipes de 7, con la jugada resaltada y volteo en 3D en
  el showdown.
- Probabilidad de ganar en vivo (Montecarlo) y nombre de tu jugada actual.
- Acciones anticipadas, atajos de teclado, apuesta con ½ / ¾ / bote / all-in.
- Modo cash con recargas o torneo con ciegas que suben y **copa para el que se lleva
  todas las fichas**.
- Bots con seis personalidades que leen tu agresividad y no se retiran solo porque
  subas fuerte.

**UNO**
- Baraja completa de 108 cartas con +2, +4, salta, cambio de sentido y comodines.
- Cantar ¡UNO! y pillar a quien se olvide (ventana de 5 segundos).
- Partida a puntos (200, 500 o 1000) con **pantalla de campeón** y revancha.
- Botón para ordenar la mano por color y valor.
- Las cartas vuelan de la mano al montón, que se ve como una pila de verdad.

**Blackjack**
- Zapato de 6 barajas, pedir, plantarse, doblar y dividir (los ases parten con una
  carta cada uno).
- Pago 3 a 2, empate si la banca también tiene blackjack, la banca se planta en 17.
- Las fichas apostadas se ven, y si te quedas sin nada puedes recargar.
- Volteo de la carta tapada, sello de PASADO y fichas que viajan al liquidar.

**Alto o bajo**
- Todos apuestan a la vez: nadie espera turno.
- Tres vidas, rachas que multiplican los puntos, el empate no cuenta.
- **Enseña la probabilidad real** de que suba o baje contando las cartas que quedan.
- Partida a puntos (15, 30 o 60) con pantalla de campeón.

**Para todos**
- Si te quedas sin conexión o cierras la pestaña, tu sitio te espera.
- Chat con bocadillos sobre quien habla, emojis que se lanzan y frases de un toque.
- Los bots comentan la jugada.
- Historial, estadísticas y aviso de turno aunque tengas la pestaña en segundo plano.
- Ajustes: volumen, velocidad de animación, baraja de 4 colores, cuatro tapetes.
- Sonido sintetizado con WebAudio: cero archivos que descargar.
- Pensado para iPad en horizontal, con botones que llegan a los 44 px que pide Apple,
  y respeta `prefers-reduced-motion`.

## Sin servidor propio

También puedes colgar solo la web (por ejemplo en **GitHub Pages**: *Settings →
Pages*, eligiendo la rama y la carpeta raíz). Entonces no hay servidor que reparta y
las mesas usan conexión directa entre navegadores (WebRTC). Funciona entre casas
normales, pero **muchas redes de colegios y oficinas lo bloquean**.

Si te pasa, el vestíbulo te deja apuntar a tu propio servidor: pulsa *indica la
dirección de tu servidor* y pega la de Render. La web se queda donde está y las
partidas pasan por tu servidor.

En cualquier caso hace falta servirlo por HTTP (no vale abrir `index.html` con doble
clic) porque el código usa módulos ES.

## Cómo funciona por dentro

El servidor tiene una mesa por sala y manda a cada jugador **su** copia del estado, ya
censurada: las cartas de los demás no salen del servidor hasta que toca enseñarlas.
Para hablar usa SSE (el servidor te habla) y POST (tú le hablas): HTTPS del normal,
nada de websockets ni puertos raros, que es justo lo que sobrevive a una red
restrictiva.

Si no hay servidor, el mismo juego funciona con el motor dentro del navegador del
anfitrión y conexión directa por WebRTC ([PeerJS](https://peerjs.com)). Las dos formas
hablan el mismo protocolo, así que al resto del juego le da igual por dónde lleguen
los mensajes.

Los cuatro juegos exponen la misma interfaz de mesa (`join`, `leave`, `act`, `chat`,
`snapshotFor`…), así que el servidor, la red y el hub no saben a qué se está jugando.

```
js/
├── cards.js          Baraja, barajado y azar (con PRNG determinista para los tests)
├── evaluator.js      Mejor jugada de 5 entre 7 cartas
├── odds.js           Equity por Montecarlo y puntuación Chen
├── engine.js         Reglas de Hold'em: turnos, apuestas, botes laterales, showdown
├── table.js          Ritmo del póker: tiempos, temporizadores, bots, niveles
├── bots.js           Decisión de los bots de póker según personalidad
├── uno.js            Reglas del UNO
├── uno-mesa.js       Ritmo del UNO: turnos, bots, cantar UNO
├── blackjack.js      Reglas del blackjack
├── blackjack-mesa.js Ritmo del blackjack: apuestas, bots con estrategia básica
├── altobajo.js       Reglas de alto o bajo
├── altobajo-mesa.js  Ritmo de alto o bajo: cuenta atrás por carta
├── charla.js         Los comentarios de los bots
├── net.js            Sesiones: local, contra el servidor, o anfitrión/invitado
├── relay.js          Conexión con el servidor de partidas (SSE + POST)
├── sound.js          Efectos con WebAudio
├── fx.js             Confeti, fichas voladoras, tweens, aviso de turno
├── ui.js             Pintado de la mesa de póker
├── uno-ui.js         Pintado del UNO
├── bj-ui.js          Pintado del blackjack
├── ab-ui.js          Pintado de alto o bajo
└── app.js            Hub, vestíbulos, ajustes y arranque
```

Y `server.js` en la raíz: sirve la web y aloja las salas de los cuatro juegos,
reutilizando los mismos motores que corren en el navegador. No tiene dependencias:
solo Node.

Los motores son lógica pura: no tocan el DOM ni la red, así que se pueden probar
enteros desde Node.

## Pruebas

```bash
npm test          # 114 pruebas, sin dependencias externas
```

Para saber si las pruebas valen de algo, se han roto las reglas a propósito
(mutation testing) y se ha comprobado que saltan: subida mínima a la mitad,
full contado como color, escalera al as bajo desactivada, ciegas heads-up
invertidas, botes laterales fundidos en uno y el blackjack pagando 1 a 1.
Las seis se detectan.

Cubren las reglas que más fácil se rompen:

- **Póker**: ciegas heads-up, subida mínima, all-in corto, botes laterales, empates y
  conservación de fichas en 40 manos aleatorias; fin de torneo.
- **UNO**: efectos de cada carta, rebarajado, cantar UNO y pillar, fin de partida.
- **Blackjack**: ases que cambian de valor, pago 3 a 2, doblar, dividir, y que salga
  blackjack en la proporción que dicen las matemáticas (medido sobre miles de manos).
- **Alto o bajo**: vidas, rachas, empates, que nadie vea la apuesta ajena antes de
  tiempo, y que la probabilidad que se enseña cuadre con el mazo.
- **Red**: el protocolo por WebRTC con un PeerJS simulado.
- **Servidor**: que reparta sin que nadie haga de crupier, que a cada jugador solo le
  lleguen sus cartas, que solo quien creó la sala pueda cambiarla, que puedas
  reconectar conservando tus fichas, y que nadie de fuera pueda mandarle nada.
- **Caos**: los cuatro juegos corriendo solos mientras la gente entra, se va, se
  ausenta y vuelve a mitad de partida. Es la que más bugs raros ha pillado: los que
  solo salen cuando alguien cierra la tapa del iPad en el peor momento.

## Limitaciones

- Las salas viven en memoria: si el servidor se reinicia o se duerme, las partidas en
  curso se pierden. Una sala vacía se recoge sola a los 20 minutos.
- En el plan gratuito de Render el servidor se duerme; el primero en entrar espera
  cerca de un minuto.
- No hay contraseñas: quien sepa el código de 4 letras puede sentarse. Para jugar
  entre amigos vale; no lo uses para nada serio.
- Sin servidor, el modo WebRTC puede fallar en redes de colegios y oficinas.
- Las fichas son de mentira: esto es para jugar entre amigos, no para apostar dinero.
