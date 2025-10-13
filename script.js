const socket = io("https://impostor-game-server-6343.onrender.com");

const pantallaInicio = document.getElementById("pantalla-inicio");
const pantallaJuego = document.getElementById("pantalla-juego");

const nombreInput = document.getElementById("nombre");
const salaInput = document.getElementById("sala");
const promptInput = document.getElementById("prompt");

const btnUnirse = document.getElementById("btn-unirse");
const btnPrompt = document.getElementById("btn-prompt");
const btnMostrar = document.getElementById("btn-mostrar");
const btnOcultar = document.getElementById("btn-ocultar");
const btnNueva = document.getElementById("btn-nueva");

const palabraDiv = document.getElementById("palabra");
const mensajeRol = document.getElementById("mensaje-rol");
const jugadoresDiv = document.getElementById("jugadores");

let palabra = "";
let miRol = "";

btnUnirse.onclick = () => {
  const nombre = nombreInput.value.trim();
  const sala = salaInput.value.trim() || "PRUEBA";
  if (!nombre) return alert("Introduce tu nombre");

  socket.emit("unirse", { nombre, sala });
  pantallaInicio.classList.add("oculto");
  pantallaJuego.classList.remove("oculto");
};

btnPrompt.onclick = () => {
  const sala = salaInput.value.trim() || "PRUEBA";
  const prompt = promptInput.value.trim();
  socket.emit("promptRonda", { sala, prompt });
  socket.emit("nuevaRonda", sala);
};

socket.on("asignarRol", (rol, palabraAsignada) => {
  miRol = rol;
  palabra = palabraAsignada || "";

  if (rol === "impostor") {
    mensajeRol.textContent = "Eres el IMPOSTOR 🕵️‍♂️";
    btnMostrar.classList.add("oculto");
    palabraDiv.classList.add("oculto");
  } else {
    mensajeRol.textContent = "Eres un jugador ✅";
    btnMostrar.classList.remove("oculto");
  }

  btnOcultar.classList.add("oculto");
  btnNueva.classList.add("oculto");
  palabraDiv.textContent = "";
});

btnMostrar.onclick = () => {

