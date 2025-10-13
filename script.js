// ⚠️ CAMBIA esta URL por la de tu servidor Render:
const socket = io("https://impostor-game-server-6343.onrender.com");

const pantallaInicio = document.getElementById("pantalla-inicio");
const pantallaJuego = document.getElementById("pantalla-juego");
const nombreInput = document.getElementById("nombre");
const btnUnirse = document.getElementById("btn-unirse");
const btnMostrar = document.getElementById("btn-mostrar");
const btnOcultar = document.getElementById("btn-ocultar");
const btnNueva = document.getElementById("btn-nueva");
const palabraDiv = document.getElementById("palabra");
const mensajeRol = document.getElementById("mensaje-rol");

let miRol = "";
let palabra = "";

btnUnirse.onclick = () => {
  const nombre = nombreInput.value.trim();
  if (!nombre) return alert("Introduce tu nombre");
  socket.emit("unirse", nombre);
  pantallaInicio.classList.add("oculto");
  pantallaJuego.classList.remove("oculto");
};

socket.on("asignarRol", (rol, palabraAsignada) => {
  miRol = rol;
  palabra = palabraAsignada || "";

  if (miRol === "impostor") {
    mensajeRol.textContent = "Eres el IMPOSTOR 🕵️‍♂️";
    btnMostrar.classList.add("oculto");
    palabraDiv.classList.add("oculto");
  } else {
    mensajeRol.textContent = "Eres un jugador normal ✅";
    btnMostrar.classList.remove("oculto");
  }

  btnNueva.classList.add("oculto");
});

btnMostrar.onclick = () => {
  palabraDiv.textContent = palabra;
  palabraDiv.classList.remove("oculto");
  btnOcultar.classList.remove("oculto");
  btnMostrar.classList.add("oculto");
};

btnOcultar.onclick = () => {
  palabraDiv.classList.add("oculto");
  btnOcultar.classList.add("oculto");
  btnNueva.classList.remove("oculto");
};

btnNueva.onclick = () => {
  socket.emit("nuevaRonda");
  mensajeRol.textContent = "Esperando nueva ronda...";
  palabraDiv.textContent = "";
  palabraDiv.classList.add("oculto");
  btnNueva.classList.add("oculto");
};
