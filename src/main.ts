import "./style.css";
import { Game } from "./game/game";
import { MultiplayerGame } from "./game/multiplayerGame";

type RunningGame = { dispose(): void } | null;

const appRoot = document.getElementById("app");
if (!appRoot) {
  throw new Error("Missing #app root element");
}
const app: HTMLElement = appRoot;

let runningGame: RunningGame = null;

const launcher = document.createElement("div");
launcher.className = "launcher";
launcher.innerHTML = `
  <div class="launcher-card">
    <h1>Minecraft Clone</h1>
    <p>Select mode</p>
    <div class="launcher-row">
      <button id="single-btn">Singleplayer</button>
      <button id="multi-btn">Multiplayer</button>
    </div>
    <div class="launcher-form">
      <label>Server URL <input id="server-url" type="text" /></label>
      <label>Room Code <input id="room-code" type="text" value="alpha" /></label>
      <label>Nickname <input id="nickname" type="text" /></label>
    </div>
    <div id="launcher-error" class="launcher-error hidden"></div>
  </div>
`;
app.appendChild(launcher);

const singleBtn = launcher.querySelector<HTMLButtonElement>("#single-btn")!;
const multiBtn = launcher.querySelector<HTMLButtonElement>("#multi-btn")!;
const serverUrlInput = launcher.querySelector<HTMLInputElement>("#server-url")!;
const roomCodeInput = launcher.querySelector<HTMLInputElement>("#room-code")!;
const nicknameInput = launcher.querySelector<HTMLInputElement>("#nickname")!;
const errorDiv = launcher.querySelector<HTMLDivElement>("#launcher-error")!;

serverUrlInput.value = `ws://${window.location.hostname}:8080`;
nicknameInput.value = `Player${Math.floor(Math.random() * 900 + 100)}`;

singleBtn.addEventListener("click", async () => {
  await startSingleplayer();
});

multiBtn.addEventListener("click", async () => {
  await startMultiplayer();
});

async function startSingleplayer(): Promise<void> {
  errorDiv.classList.add("hidden");
  teardown();
  launcher.classList.add("hidden");
  const game = new Game(app);
  runningGame = game;
  await game.init();
}

async function startMultiplayer(): Promise<void> {
  errorDiv.classList.add("hidden");
  teardown();
  launcher.classList.add("hidden");

  const game = new MultiplayerGame(app, {
    serverUrl: serverUrlInput.value.trim(),
    roomCode: roomCodeInput.value.trim() || "alpha",
    nickname: nicknameInput.value.trim() || "Player"
  });
  runningGame = game;
  try {
    await game.init();
  } catch (error) {
    teardown();
    launcher.classList.remove("hidden");
    errorDiv.classList.remove("hidden");
    errorDiv.textContent = error instanceof Error ? error.message : "Failed to connect";
  }
}

function teardown(): void {
  if (runningGame) {
    runningGame.dispose();
    runningGame = null;
  }
  app.querySelectorAll(".game-canvas,.hud-root").forEach((node) => node.remove());
}
