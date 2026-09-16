# ♠️ Hold'em Club

Texas Hold'em No Limit para jugar con tus amigos desde el navegador. Sin registro
y sin instalar nada: uno crea la mesa, comparte un código de 4 letras y los demás
entran desde su móvil, su tablet o su portátil.

**Las mesas viven en el servidor.** Él baraja, reparte y lleva los tiempos, así que
nadie tiene que dejar su dispositivo encendido haciendo de crupier: si se te apaga
la pantalla o cierras la tapa, la partida sigue y tu silla te espera. Y como todo
viaja por HTTPS normal, funciona también en redes que bloquean casi todo, como las
de los colegios.

## Ponerlo en marcha (vale desde un iPad, sin terminal)

Necesitas que el juego esté colgado en algún sitio. Con [Render](https://render.com)
son unos toques y el plan gratuito sobra:

1. Entra en Render y pulsa **New → Blueprint**.
2. Elige este repositorio. El archivo `render.yaml` ya le dice todo lo que necesita.
3. Espera a que despliegue y quédate con la dirección que te da, algo como
   `https://holdem-club.onrender.com`.
4. Esa dirección es la que repartes. Todos la abrís, tú pulsas **Crear mesa** y a
   tus amigos les aparece en la lista de mesas abiertas: un toque y dentro.

> Ojo con el plan gratuito de Render: si nadie juega durante un rato, el servidor se
> duerme. El primero en entrar esperará cerca de un minuto a que despierte. A partir
> de ahí va fino.

Si prefieres levantarlo en tu ordenador (hace falta Node 18 o más nuevo):

```bash
npm start
```

Te imprime la dirección de tu red local para repartirla a quien esté en la misma
wifi. Esto sirve en casa; en una wifi de colegio no, porque esas redes suelen
impedir que los dispositivos se vean entre sí.

## Jugar

1. Abrís la dirección del servidor y escribís vuestro nombre.
2. **Crear mesa** → sale un código de 4 letras (y un enlace para compartir).
3. Los demás entran en **Unirme**: o tocan la mesa en la lista, o escriben el código.
4. Puedes rellenar los huecos con bots mientras llega la gente.

¿Solo quieres practicar? La pestaña **Practicar** abre una mesa contra bots en tu
propio dispositivo, sin conexión con nadie.

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
- Si te quedas sin conexión o cierras la pestaña, tu silla y tus fichas te esperan.
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

El servidor tiene una mesa por sala y manda a cada jugador **su** copia del estado,
ya censurada: las cartas de los demás no salen del servidor hasta el showdown. Para
hablar usa SSE (el servidor te habla) y POST (tú le hablas): HTTPS del normal, nada
de websockets ni puertos raros, que es justo lo que sobrevive a una red restrictiva.

Si no hay servidor, el mismo juego funciona con el motor dentro del navegador del
anfitrión y conexión directa por WebRTC ([PeerJS](https://peerjs.com)). Las dos
formas hablan el mismo protocolo, así que al resto del juego le da igual por dónde
lleguen los mensajes.

```
js/
├── cards.js      Baraja, barajado y azar (con PRNG determinista para los tests)
├── evaluator.js  Mejor jugada de 5 entre 7 cartas
├── odds.js       Equity por Montecarlo y puntuación Chen
├── engine.js     Reglas de Hold'em: turnos, apuestas, botes laterales, showdown
├── table.js      Ritmo de la partida: tiempos, temporizadores, bots, niveles
├── bots.js       Decisión de los bots según personalidad
├── net.js        Sesiones: local, contra el servidor, o anfitrión/invitado por WebRTC
├── relay.js      Conexión con el servidor de partidas (SSE + POST)
├── sound.js      Efectos con WebAudio
├── fx.js         Confeti, fichas voladoras, tweens
├── ui.js         Pintado de la mesa y animaciones
└── app.js        Vestíbulo, ajustes y arranque
```

Y `server.js` en la raíz: sirve la web y aloja las mesas, reutilizando el mismo
motor que corre en el navegador. No tiene dependencias: solo Node.

El motor (`engine.js`) es lógica pura: no toca el DOM ni la red, así que se puede
probar entero desde Node.

Las dos formas de conectar hablan el mismo protocolo, así que el resto del juego no
sabe (ni le importa) si los mensajes llegan por WebRTC o por la red de casa.

## Pruebas

```bash
npm test          # 38 pruebas, sin dependencias externas
```

Cubren las reglas que más fácil se rompen (ciegas heads-up, subida mínima, all-in
corto, botes laterales, empates, conservación de fichas en 40 manos aleatorias), el
protocolo por WebRTC con un PeerJS simulado, y el servidor: que reparta sin que nadie
haga de crupier, que a cada jugador solo le lleguen sus cartas, que solo quien creó la
mesa pueda cambiarla, que puedas reconectar y conservar tus fichas, y que nadie de
fuera pueda mandarle nada a una mesa.

## Limitaciones

- Las mesas viven en memoria: si el servidor se reinicia o se duerme, las partidas en
  curso se pierden. Una mesa vacía se recoge sola a los 20 minutos.
- En el plan gratuito de Render el servidor se duerme; el primero en entrar espera
  cerca de un minuto.
- No hay contraseñas: quien sepa el código de 4 letras puede sentarse. Para jugar
  entre amigos vale; no lo uses para nada serio.
- Sin servidor, el modo WebRTC puede fallar en redes de colegios y oficinas.
- Las fichas son de mentira: esto es para jugar entre amigos, no para apostar dinero.
