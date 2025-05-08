// --- WebSocket Connection ---
const protocol = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${protocol}://${location.host}`);

ws.addEventListener("open", () => {
  console.log("🟢 Connected to server");
});

ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  requestAnimationFrame(() => {
    if (data.timeLeft !== undefined) {
      console.log(Math.floor((data.timeLeft / 30) * 100) + "%");
      if (data.activePlayer[data.index]) {
        const percent = data.timeLeft / 30;
        playerTimer.style.width = `calc(min(calc(100vw - var(--u)), 900px) * ${percent})`;
        setTimeout(() => {
          playerTimer.innerText = data.timeLeft;
        }, 100);

        return;
      }

      const order = opponentOrder[data.activePlayer.length];
      for (
        let opponentIndex = 0;
        opponentIndex < order.length;
        opponentIndex++
      ) {
        const trueIndex =
          (opponentIndex + 1 + data.index) % data.activePlayer.length;
        if (!data.activePlayer[trueIndex]) continue;

        const opponent = order[opponentIndex];

        const timer = opponent.querySelector(".timer");
        timer.style.width = Math.floor((data.timeLeft / 30) * 100) + "%";

        setTimeout(() => {
          timer.innerText = data.timeLeft ? data.timeLeft : "";
        }, 100);
      }
      return;
    }
    updatePlayerHand(data);
    updateButtons(data);
  });
});

// --- DOM Elements ---
const leftButton = document.getElementById("left-button");
const middleButton = document.getElementById("middle-button");
const rightButton = document.getElementById("right-button");

const playerHand = document.getElementById("player-hand");
const [leftCard, rightCard] = playerHand.querySelectorAll(".card");
const playerTimer = document.querySelector(".control .timer");
const synergy = document.getElementById("synergy");

const handInfo = document.getElementById("info");
const percentBorder = document.getElementById("percent");
const percentFill = document.getElementById("fill");
const handScore = document.getElementById("score");
const handChance = document.getElementById("chance");
const toBet = document.getElementById("bet");

const topLeft = document.getElementById("top-left");
const topMiddle = document.getElementById("top-middle");
const topRight = document.getElementById("top-right");
const middleLeft = document.getElementById("middle-left");
const middleRight = document.getElementById("middle-right");

const opponentOrder = {
  2: [topMiddle],
  3: [topLeft, topRight],
  4: [middleLeft, topMiddle, middleRight],
  5: [middleLeft, topLeft, topRight, middleRight],
  6: [middleLeft, topLeft, topMiddle, topRight, middleRight],
};

const board = document.getElementById("board");
const boardCards = board.querySelectorAll(".card");
const pot = board.querySelector(".opponentBet");

// --- Utility Functions ---
const championImage = (name) => `/image/${name}`;

const pointsToClass = {
  0: "zero",
  1: "one",
  2: "two",
  4: "four",
};

// --- Update Functions ---
function updatePlayerHand(data) {
  if (data.playerHand === undefined) {
    playerHand.style.display = "none";
    percentBorder.classList.remove("percentBorder");
    handInfo.style.display = "none";
    toBet.innerText = "";
    topLeft.style.display = "none";
    topMiddle.style.display = "none";
    topRight.style.display = "none";
    middleLeft.style.display = "none";
    middleRight.style.display = "none";

    boardCards.forEach((card) => {
      card.innerHTML = "";
      card.classList.add("noCard");
    });

    pot.innerText = "";
    return;
  }

  playerHand.style.display = "flex";
  leftCard.innerHTML = "";
  rightCard.innerHTML = "";
  synergy.innerHTML = "";

  const [left, right] = data.playerHand;

  const leftImage = document.createElement("img");
  leftImage.src = championImage(left.name);
  const leftPoints = document.createElement("span");
  leftPoints.classList.add(pointsToClass[left.points]);
  leftPoints.innerText = "" + left.points;
  leftCard.append(leftImage, leftPoints);

  const rightImage = document.createElement("img");
  rightImage.src = championImage(right.name);
  const rightPoints = document.createElement("span");
  rightPoints.classList.add(pointsToClass[right.points]);
  rightPoints.innerText = "" + right.points;
  rightCard.append(rightImage, rightPoints);

  const playerPotData = data.playersData[data.index];
  const playerPot = document.createElement("p");
  playerPot.innerHTML = `${playerPotData.bank} <br>Synergy`;

  const handSynergy = document.createElement("span");
  handSynergy.classList.add(pointsToClass[data.synergy]);
  handSynergy.innerText = data.synergy;
  synergy.append(playerPot, handSynergy);

  handInfo.style.display = "flex";
  percentBorder.classList.add("percentBorder");
  percentFill.style.height = data.winchance + "%";
  handChance.innerText = data.winchance + "%";
  handScore.innerText = `${data.score}/${data.maxScore}`;

  toBet.innerText = `${data.minBet}`;

  opponentOrder[6].forEach((opponent) => {
    opponent.style.display = "none";
  });

  const order = opponentOrder[data.playersData.length];
  for (let opponentIndex = 0; opponentIndex < order.length; opponentIndex++) {
    const opponent = order[opponentIndex];
    opponent.style.display = "flex";
    const [leftCard, rightCard] = opponent.querySelectorAll(".card");
    leftCard.innerHTML = "";
    rightCard.innerHTML = "";

    const trueIndex =
      (opponentIndex + 1 + data.index) % data.playersData.length;
    const bet = opponent.querySelector(".opponentBet");
    bet.innerText = `${data.playersData[trueIndex].pot} | ${data.playersData[trueIndex].bank}`;
  }

  pot.innerText = `${playerPotData.pot} | ${data.pot}`;

  boardCards.forEach((card) => {
    card.innerHTML = "";
    card.classList.add("noCard");
  });

  data.board.forEach((champ, index) => {
    boardCards[index].innerHTML = "";
    boardCards[index].classList.remove("noCard");
    const image = document.createElement("img");
    image.src = championImage(champ.name);
    const leftPoints = document.createElement("span");
    leftPoints.classList.add(pointsToClass[champ.leftPoints]);
    leftPoints.innerText = "" + champ.leftPoints;

    const rightPoints = document.createElement("span");
    rightPoints.classList.add(pointsToClass[champ.rightPoints]);
    rightPoints.innerText = "" + champ.rightPoints;

    const p = document.createElement("p");
    p.append(leftPoints, rightPoints);

    boardCards[index].append(image, p);
  });
}

function updateButtons(data) {
  updateLeftButton(data.leftButton, data);
  updateMiddleButton(data.middleButton);
  updateRightButton(data.rightButton);
}

// --- Button State ---
let leftButtonState = "";

leftButton.addEventListener("click", (e) => {
  if (e.button === 2) return; // Ignore right-clicks

  switch (leftButtonState) {
    case "ready up":
      return ws.send(JSON.stringify({ type: "ready up" }));
    case "queue up":
      return ws.send(JSON.stringify({ type: "queue up" }));
    case "unready":
      return ws.send(JSON.stringify({ type: "unready" }));
    case "unqueue":
      return ws.send(JSON.stringify({ type: "unqueue" }));
    case "check":
      return ws.send(JSON.stringify({ type: "check" }));
    case "fold":
      return ws.send(JSON.stringify({ type: "fold" }));
    case "check fold":
      leftButton.innerText = "Uncheck/Fold";
      leftButtonState = "uncheck fold";
      break;
    case "uncheck fold":
      leftButton.innerText = "Check/Fold";
      leftButtonState = "check fold";
      break;
  }
});

function updateLeftButton(state, data) {
  leftButton.classList.remove("noButton");
  leftButton.classList.remove("smallText");

  switch (state) {
    case "ready up":
      leftButton.innerText = "Ready";
      leftButtonState = "ready up";
      break;
    case "queue up":
      leftButton.innerText = "Queue";
      leftButtonState = "queue up";
      break;
    case "ready count":
      leftButton.innerText = `${data.readyCount} | ${data.playerCount}`;
      leftButtonState = "unready";
      break;
    case "queue position":
      leftButton.innerText = data.position;
      leftButtonState = "unqueue";
      break;
    case "check":
      if (leftButtonState === "uncheck fold" || middleButtonState === "uncheck")
        ws.send(JSON.stringify({ type: "check" }));

      leftButton.innerText = "Check";
      leftButtonState = "check";
      break;
    case "fold":
      if (leftButtonState === "uncheck fold")
        ws.send(JSON.stringify({ type: "fold" }));

      leftButton.innerText = "Fold";
      leftButtonState = "fold";
      break;
    case "check fold":
      leftButton.innerText = "Check/Fold";
      leftButton.classList.add("smallText");
      leftButtonState = "check fold";
      break;
    case "fold any":
      leftButton.innerText = "Fold";
      leftButtonState = "fold any";
      break;
    default:
      leftButton.classList.add("noButton");
      break;
  }
}

let middleButtonState = "";

middleButton.addEventListener("click", (e) => {
  if (e.button === 2) return; // Ignore right-clicks

  switch (middleButtonState) {
    case "call":
      return ws.send(JSON.stringify({ type: "call" }));
    case "check":
      middleButton.innerText = "Uncheck";
      middleButtonState = "uncheck";
      break;
    case "uncheck":
      middleButton.innerText = "Check";
      middleButtonState = "check";
      break;
  }
});

function updateMiddleButton(state) {
  console.log(state);
  middleButton.classList.remove("noButton");
  middleButton.classList.remove("smallText");
  switch (state) {
    case "call":
      middleButton.innerText = "Call";
      middleButtonState = "call";
      break;
    case "check":
      middleButton.innerText = "Check";
      middleButtonState = "check";
      break;
    case "call any":
      middleButton.classList.add("smallText");
      middleButton.innerText = "Call Any";
      middleButtonState = "call any";
      break;
    default:
      middleButton.classList.add("noButton");
      break;
  }
}

function updateRightButton(state) {
  rightButton.classList.remove("noButton");
  rightButton.classList.remove("smallText");
  switch (state) {
    case "raise":
      rightButton.innerText = "Raise";
      break;
    default:
      rightButton.classList.add("noButton");
  }
}
