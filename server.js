/**************************************************************************
 *  server.js – game server + champion‑image proxy/cache
 **************************************************************************/

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const pathLib = require("path");
const { Game } = require("./game.js");

/* --------------------------------------------------------------------- */
/* 0. helpers / polyfills                                                */
/* --------------------------------------------------------------------- */
const fetch = global.fetch
  ? global.fetch
  : (...args) => import("node-fetch").then(({ default: f }) => f(...args));

/* --------------------------------------------------------------------- */
/* 1. basic server + hot‑reloading game data                             */
/* --------------------------------------------------------------------- */
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const dataPath = "./game_data.json";
let gameData = JSON.parse(fs.readFileSync(dataPath));
let setData;
fs.watch(dataPath, () => {
  if (setData) clearTimeout(setData);
  setData = setTimeout(() => {
    gameData = JSON.parse(fs.readFileSync(dataPath));
    console.log("Game data updated");
  }, 10000);
});

const game = new Game("id", gameData);
wss.on("connection", (socket) => game.addUser(socket));

/* --------------------------------------------------------------------- */
/* 2. champion list → id‑map (⚡ new)                                     */
/* --------------------------------------------------------------------- */
const PATCH = "15.9.1"; // bump when Riot ships a new patch
const LANG = "en_US";
const CHAMP_URL = `https://ddragon.leagueoflegends.com/cdn/${PATCH}/data/${LANG}/champion.json`;

let championIdByLower = Object.create(null); // { 'fiddlesticks': 'Fiddlesticks', … }

(async () => {
  try {
    const { data } = await fetch(CHAMP_URL).then((r) => r.json());
    championIdByLower = Object.fromEntries(
      Object.values(data).map((c) => [c.id.toLowerCase(), c.id])
    );
    console.log(
      `[champ‑map] Loaded ${Object.keys(championIdByLower).length} champions`
    );
  } catch (err) {
    console.error(
      "[champ‑map] FAILED to fetch champion list – icons may 404!",
      err
    );
  }
})();

/* --------------------------------------------------------------------- */
/* 3. champion‑image endpoint with on‑disk cache                         */
/* --------------------------------------------------------------------- */
const CACHE_ROOT = pathLib.join(__dirname, "cache", "images");
fs.mkdirSync(CACHE_ROOT, { recursive: true });

app.get("/image/:champion", async (req, res) => {
  try {
    // ⚡ normalise request name (strip non‑alphanum, lower‑case),
    //    then look up official id from championIdByLower.
    const key = req.params.champion.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const id = championIdByLower[key] ?? req.params.champion; // fallback if map not ready
    const file = `${id}.png`;
    const filePath = pathLib.join(CACHE_ROOT, file);

    // --- serve from cache if we already have it -----------------------
    if (fs.existsSync(filePath)) {
      return res
        .type("png")
        .set("Cache-Control", "public, max-age=2592000, immutable")
        .sendFile(filePath);
    }

    // --- otherwise fetch from Data Dragon, cache, and stream ----------
    const cdnURL = `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${file}`;
    const response = await fetch(cdnURL);
    if (!response.ok) return res.sendStatus(404);

    const buf = Buffer.from(await response.arrayBuffer());
    fs.writeFile(
      filePath,
      buf,
      (e) => e && console.error(`[img‑cache] write failed: ${e.message}`)
    );

    res
      .type("png")
      .set("Cache-Control", "public, max-age=2592000, immutable")
      .send(buf);
  } catch (err) {
    console.error("[img‑proxy]", err);
    res.sendStatus(500);
  }
});

/* --------------------------------------------------------------------- */
/* 4. boot                                                               */
/* --------------------------------------------------------------------- */
const PORT = 3000;
server.listen(PORT, () =>
  console.log(`🌐 Server running on http://localhost:${PORT}`)
);
