const slider = document.getElementById("size-slider");
slider.addEventListener("input", (e) => {
  const n = e.target.value;
  // rebuild the CSS expression
  document.documentElement.style.setProperty("--u", `min(${n}dvh, ${n}dvw)`);
});

// --- WebSocket Connection ---
const protocol = location.protocol === "https:" ? "wss" : "ws";
//const ws = new WebSocket(`${protocol}://${location.host}`);

ws.addEventListener("open", () => {
  console.log("🟢 Connected to server");
});

let timerDebounce;

ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  requestAnimationFrame(() => {
    if (data.timeLeft !== undefined) {
      if (data.activePlayer[data.index]) {
        const percent = data.timeLeft / 30;
        playerTimer.style.width = `calc(min(calc(100vw - var(--u)), 900px) * ${percent})`;

        setTimeout(() => {
          playerTimer.innerText = data.timeLeft;
        }, 100);

        if (playerTimer.debounce) clearTimeout(playerTimer.debounce);
        playerTimer.debounce = setTimeout(() => {
          // auto reset after 2 seconds
          playerTimer.style.width = `0px`;
          playerTimer.innerText = "";
        }, 1100);
        return;
      }

      const playerCount = data.activePlayer.length;
      const order = opponentOrder[playerCount];
      for (let oppIndex = 0; oppIndex < order.length; oppIndex++) {
        const trueIndex = (oppIndex + 1 + data.index) % playerCount;
        if (!data.activePlayer[trueIndex]) continue;
        const timer = order[oppIndex].querySelector(".timer");
        timer.style.width = Math.floor((data.timeLeft / 30) * 100) + "%";

        setTimeout(() => {
          timer.innerText = data.timeLeft ? data.timeLeft : "";
        }, 100);
        if (timer.debounce) clearTimeout(timer.debounce);
        timer.debounce = setTimeout(() => {
          // auto reset after 2 seconds
          timer.style.width = `0px`;
          timer.innerText = "";
        }, 1100);
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
const lanes = document.getElementById("lanes");

//raise elements

// --- Utility Functions ---
const championImage = (name) => `/image/${name}`;
const laneImage = (lane) => `/lanes/${lane}`;

const pointsToClass = {
  0: "zero",
  1: "one",
  3: "two",
  7: "four",
};

const alphaToShimmer = (element, alpha) => {
  if (alpha > 1) alpha *= 2/3;
  const hue = 150 + alpha * 150;
  const baseChroma = 0.05 + alpha * 0.1;
  const liteChroma = baseChroma - alpha * 0.1;
  const liteLum = Math.min(0.7 + alpha * 0.2, 0.90);
  element.style.backgroundImage = `
    linear-gradient(
      60deg,
      oklch(0.7 ${baseChroma} ${hue}) 40%,
      oklch(${liteLum} ${liteChroma} ${hue}) 50%,
      oklch(0.7 ${baseChroma} ${hue}) 60%
    )`;
  element.classList.add("shimmer");
};

const alphaToShimmerBlock = (element, alpha) => {
  const hue = 150 + alpha * 150;
  const baseChroma = 0.05 + alpha * 0.1;
  const liteChroma = baseChroma - alpha * 0.1;
  const liteLum = 0.7 + alpha * 0.2;
  element.style.backgroundImage = `
    linear-gradient(
      60deg,
      oklch(0.7 ${baseChroma} ${hue}) 25%,
      oklch(${liteLum} ${liteChroma} ${hue}) 50%,
      oklch(0.7 ${baseChroma} ${hue}) 75%
    )`;
  element.classList.add("shimmerBlock");
};

const alphaToOKCLH = (alpha) => {
  const hue = 150 + alpha * 150;
  const baseChroma = 0.05 + alpha * 0.1;
  return `oklch(0.7 ${baseChroma} ${hue})`;
};

const stateToClass = {
  "waiting turn": "waitingPlayer",
  "finished turn": "finishedPlayer",
  folded: "foldedPlayer",
  "all in": "allInPlayer",
  "current turn": "currentPlayer",
};

const stateClassList = Object.values(stateToClass);

// --- Update Functions ---
function updatePlayerHand(data) {
  if (data.playerHand === undefined) {
    playerHand.style.display = "none";
    percentBorder.style.border = "0px solid black";
    handInfo.style.display = "none";
    toBet.innerText = "";
    toBet.classList.add("noBet");
    topLeft.style.display = "none";
    topMiddle.style.display = "none";
    topRight.style.display = "none";
    middleLeft.style.display = "none";
    middleRight.style.display = "none";

    boardCards.forEach((card) => {
      card.innerHTML = "";
      card.classList.add("noCard");
    });

    pot.querySelector("p").innerText = "";
    lanes.innerHTML = "";

    return;
  }

  playerHand.style.display = "flex";
  leftCard.innerHTML = "";
  rightCard.innerHTML = "";
  synergy.innerHTML = "";

  const playerPotData = data.playersData[data.index];
  const playerPot = document.createElement(data.finished ? "span" : "p");
  if (data.finished) {
    playerPot.innerHTML = `◊${data.score}`;
    alphaToShimmer(playerPot, data.alpha);
  } else playerPot.innerHTML = `&nbsp;`;

  const playerScore = document.createElement("p");
  if (data.finished) playerScore.innerHTML = `¢${playerPotData.bank}`;
  else playerScore.innerHTML = `¢${playerPotData.bank}`;

  const [left, right] = data.playerHand;

  if (data.finished && false) {
    const leftImage = document.createElement("img");
    leftImage.src = championImage(data.playersData[data.index].left.name);
    const leftP = document.createElement("p");
    data.playersData[data.index].leftPoints.forEach((point) => {
      const leftPoints = document.createElement("span");
      leftPoints.classList.add(pointsToClass[point]);
      leftPoints.innerText = "" + point;
      leftP.append(leftPoints);
    });
    leftCard.append(leftImage, leftP);

    const rightImage = document.createElement("img");
    rightImage.src = championImage(data.playersData[data.index].right.name);
    const rightP = document.createElement("p");
    data.playersData[data.index].rightPoints.forEach((point) => {
      const rightPoints = document.createElement("span");
      rightPoints.classList.add(pointsToClass[point]);
      rightPoints.innerText = "" + point;
      rightP.append(rightPoints);
    });
    rightCard.append(rightImage, rightP);
  } else {
    const leftImage = document.createElement("img");
    leftImage.src = championImage(left.name);
    const leftText = document.createElement("p");
    const leftPoints = document.createElement("span");
    alphaToShimmer(leftPoints, left.points / 4);
    leftPoints.innerText = "" + left.points;
    leftText.appendChild(leftPoints);
    leftCard.append(leftImage, leftText);

    const rightImage = document.createElement("img");
    rightImage.src = championImage(right.name);
    const rightText = document.createElement("p");
    const rightPoints = document.createElement("span");
    alphaToShimmer(rightPoints, right.points / 4);
    rightPoints.innerText = "" + right.points;
    rightText.appendChild(rightPoints);
    rightCard.append(rightImage, rightText);
  }

  stateClassList.forEach((state) => leftCard.classList.remove(state));
  leftCard.classList.add(stateToClass[playerPotData.state]);
  stateClassList.forEach((state) => rightCard.classList.remove(state));
  rightCard.classList.add(stateToClass[playerPotData.state]);
  const handSynergy = document.createElement("span");
  alphaToShimmer(handSynergy, data.synergy / 4);
  handSynergy.innerText = data.synergy;
  synergy.append(playerPot, playerScore, handSynergy);

  if (data.finished) {
    handInfo.style.display = "none";
    toBet.innerText = ``;
    toBet.classList.add("noBet");
  } else {
    handInfo.style.display = "flex";
    percentBorder.style.border = `1px solid ${alphaToOKCLH(
      data.winchance / 100
    )}`;
    percentFill.style.height = data.winchance + "%";
    alphaToShimmerBlock(percentFill, data.winchance / 100);
    percentFill.style.boxShadow = `0 0 calc(var(--u) / 16) ${alphaToOKCLH(
      data.winchance / 100
    )}
`;
    handChance.innerText = data.winchance + "%";
    handScore.innerText = `◊${data.score}`;
    if (data.minBet === 0 || data.middleButton === "call") {
      toBet.innerText = ``;
      toBet.classList.add("noBet");
    } else {
      toBet.innerText = `¢${data.minBet}`;
      toBet.classList.remove("noBet");
    }
  }

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

    stateClassList.forEach((state) => leftCard.classList.remove(state));
    stateClassList.forEach((state) => rightCard.classList.remove(state));

    leftCard.classList.add(stateToClass[data.playersData[trueIndex].state]);
    rightCard.classList.add(stateToClass[data.playersData[trueIndex].state]);

    const bet = opponent.querySelector(".opponentBet");

    if (data.finished) {
      const synergyPoint = document.createElement("div");
      data.playersData[trueIndex].leftPoints.forEach((point, index) => {
        if (index === 0) return;

        const leftPoints = document.createElement("span");
        alphaToShimmer(leftPoints, point / 4);
        leftPoints.innerText = "" + point;
        synergyPoint.append(leftPoints);
      });

      const synergy = document.createElement("span");
      const point = data.playersData[trueIndex].synergy;
      alphaToShimmer(synergy, point / 4);

      synergy.innerText = "" + point;
      synergyPoint.append(synergy);

      data.playersData[trueIndex].rightPoints.forEach((point, index) => {
        if (index === 0) return;

        const rightPoints = document.createElement("span");
        alphaToShimmer(rightPoints, point / 4);
        rightPoints.innerText = "" + point;
        synergyPoint.append(rightPoints);
      });

      synergyPoint.style.width = "100%";
      synergyPoint.style.display = "flex";
      synergyPoint.style.justifyContent = "space-evenly";

      const textSynergy = document.createElement("p");
      textSynergy.innerHTML = `¢${data.playersData[trueIndex].bank}`;
      textSynergy.style.margin = "0px";

      const text = document.createElement("span");
      text.innerHTML = `◊${data.playersData[trueIndex].score}`;
      alphaToShimmer(text, data.playersData[trueIndex].alpha);
      bet.innerHTML = "";
      text.style.margin = "0px";
      bet.append(synergyPoint, textSynergy, text); //
      bet.style.width = "100%";
    } else {
      bet.innerHTML = "";
      bet.innerText = `¢${data.playersData[trueIndex].bank}`;
    }

    if (data.finished) {
      const leftImage = document.createElement("img");
      leftImage.src = championImage(data.playersData[trueIndex].left.name);
      const leftP = document.createElement("p");
      data.playersData[trueIndex].leftPoints.forEach((point, index) => {
        if (index != 0) return;
        const leftPoints = document.createElement("span");
        alphaToShimmer(leftPoints, point / 4);
        leftPoints.innerText = "" + point;
        leftP.append(leftPoints);
      });
      leftCard.append(leftImage, leftP);

      const rightImage = document.createElement("img");
      rightImage.src = championImage(data.playersData[trueIndex].right.name);
      const rightP = document.createElement("p");
      data.playersData[trueIndex].rightPoints.forEach((point, index) => {
        if (index != 0) return;
        const rightPoints = document.createElement("span");
        alphaToShimmer(rightPoints, point / 4);
        rightPoints.innerText = "" + point;
        rightP.append(rightPoints);
      });
      rightCard.append(rightImage, rightP);
    }
  }

  pot.querySelector("p").innerText = `POT ¢${data.pot}`;
  lanes.innerHTML = "";

  data.lanes.forEach((lane, index) => {
    const image = document.createElement("img");
    image.src = laneImage(lane);
    if (index - 2 < data.board.length) image.classList.add("activeLane");
    else image.classList.add("inactiveLane");
    lanes.append(image);
  });

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
    alphaToShimmer(leftPoints, champ.leftPoints / 4);
    leftPoints.innerText = "" + champ.leftPoints;

    const rightPoints = document.createElement("span");
    alphaToShimmer(rightPoints, champ.rightPoints / 4);
    rightPoints.innerText = "" + champ.rightPoints;

    const p = document.createElement("p");
    p.append(leftPoints, rightPoints);

    if (data.finished && false) boardCards[index].append(image);
    else boardCards[index].append(image, p);
  });
}

function updateButtons(data) {
  updateLeftButton(data.leftButton, data);
  updateMiddleButton(data.middleButton, data);
  updateRightButton(data.rightButton, data);
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
    case "check any":
      leftButton.classList.add("activeButton");
      leftButtonState = "uncheck any";
      middleButton.classList.remove("activeButton");
      middleButtonState = "call any";
      rightButton.classList.remove("activeButton");
      rightButtonState = "fold any";
      break;
    case "uncheck any":
      leftButton.classList.remove("activeButton");
      leftButtonState = "check any";
      break;
  }
});

function updateLeftButton(state, data) {
  leftButton.style.position = "static";
  leftButton.classList.remove("noButton");
  leftButton.classList.remove("smallText");
  leftButton.classList.remove("activeButton");

  switch (state) {
    case "ready up":
      leftButton.style.position = "absolute";
      leftButton.innerText = "Ready";
      leftButtonState = "ready up";
      break;
    case "queue up":
      leftButton.style.position = "absolute";
      leftButton.innerText = "Queue";
      leftButtonState = "queue up";
      break;
    case "ready count":
      leftButton.style.position = "absolute";
      leftButton.innerText = `${data.readyCount} | ${data.playerCount}`;
      leftButtonState = "unready";
      break;
    case "queue position":
      leftButton.style.position = "absolute";
      leftButton.innerText = data.position;
      leftButtonState = "unqueue";
      break;
    case "check":
      if (
        leftButtonState === "uncheck any" ||
        middleButtonState === "uncall any" ||
        rightButtonState === "unfold any"
      ) {
        leftButton.classList.add("noButton");
        middleButton.classList.add("noButton");
        rightButton.classList.add("noButton");
        leftButtonState = "";
        middleButtonState = "";
        rightButtonState = "";
        return ws.send(JSON.stringify({ type: "check" }));
      }
      leftButton.innerText = "Check";
      leftButtonState = "check";
      break;
    case "fold":
      if (rightButtonState === "unfold any") {
        leftButton.classList.add("noButton");
        middleButton.classList.add("noButton");
        rightButton.classList.add("noButton");
        leftButtonState = "";
        middleButtonState = "";
        rightButtonState = "";
        return ws.send(JSON.stringify({ type: "fold" }));
      }

      leftButton.innerText = "Fold";
      leftButtonState = "fold";
      break;
    case "check any":
      if (leftButtonState == "uncheck any") {
        leftButton.classList.add("smallText");
        leftButton.classList.add("activeButton");
        return;
      }
      leftButton.classList.add("smallText");
      leftButton.innerText = "Pre Check";
      leftButtonState = "check any";
      break;
    default:
      leftButton.classList.add("noButton");
      leftButtonState = "";
      break;
  }
}

let middleButtonState = "";

middleButton.addEventListener("click", (e) => {
  if (e.button === 2) return; // Ignore right-clicks

  switch (middleButtonState) {
    case "call":
      leftButton.classList.add("noButton");
      middleButton.classList.add("noButton");
      rightButton.classList.add("noButton");
      return ws.send(JSON.stringify({ type: "call" }));
    case "call any":
      middleButton.classList.add("activeButton");
      middleButtonState = "uncall any";
      rightButton.classList.remove("activeButton");
      rightButtonState = "fold any";
      leftButton.classList.remove("activeButton");
      leftButtonState = "check any";
      break;
    case "uncall any":
      middleButton.classList.remove("activeButton");
      middleButtonState = "call any";
      break;
  }
});

function updateMiddleButton(state, data) {
  console.log(state);
  middleButton.classList.remove("noButton");
  middleButton.classList.remove("smallText");
  middleButton.classList.remove("activeButton");
  switch (state) {
    case "call":
      if (middleButtonState === "uncall any") {
        leftButton.classList.add("noButton");
        middleButton.classList.add("noButton");
        rightButton.classList.add("noButton");
        leftButtonState = "";
        middleButtonState = "";
        rightButtonState = "";
        return ws.send(JSON.stringify({ type: "call" }));
      }
      middleButton.classList.add("smallText");
      middleButton.innerText = `Call ¢${data.minBet}`;
      middleButtonState = "call";
      break;
    case "call any":
      if (middleButtonState == "uncall any") {
        middleButton.classList.add("smallText");
        middleButton.classList.add("activeButton");
        return;
      }

      middleButton.classList.add("smallText");
      middleButton.innerText = "Call Any";
      middleButtonState = "call any";
      break;
    default:
      middleButton.classList.add("noButton");
      break;
  }
}

const raisePanel = document.getElementById("raise");
const raiseSize = document.getElementById("raiseSize");
const raiseSlider = document.getElementById("slider");
const raiseFill = document.getElementById("sliderFill");
const increment = document.getElementById("increment");
const incrementButtons = increment.querySelectorAll(".incrementButton");
const incrementSizes = [-50, -10, -5, 5, 10, 50];

let raise = 0;
let minRaise = 0;
let maxRaise = 3000;
let isRaiseSliderClicked = false;

function computePercentage(e) {
  const rect = raiseSlider.getBoundingClientRect();
  let offsetY = e.clientY - rect.top;
  offsetY = Math.max(0, Math.min(offsetY, rect.height));
  raise = Math.round((maxRaise * (1 - offsetY / rect.height)) / 5) * 5;
  raise = Math.min(maxRaise, raise);
  raise = Math.max(minRaise, raise);
  raiseFill.style.height = `${(100 * raise) / maxRaise}%`;
  raiseSize.innerText = "" + raise;
}

raiseSlider.addEventListener("pointerdown", (e) => {
  isClicked = true;
  computePercentage(e);
});
raiseSlider.addEventListener("pointermove", (e) => {
  if (!isClicked) return;
  computePercentage(e);
});
raiseSlider.addEventListener("pointerup", (e) => {
  isClicked = false;
  computePercentage(e);
});

incrementButtons.forEach((button, index) => {
  if (index >= incrementSizes.length)
    // Confirm button
    return button.addEventListener("click", () => {
      if (raise > minRaise) ws.send(JSON.stringify({ type: "raise", raise }));
      else ws.send(JSON.stringify({ type: "call" }));
    });

  function doRaise() {
    raise += incrementSizes[index];
    raise = Math.min(maxRaise, Math.max(minRaise, raise));
    raiseFill.style.height = `${(100 * raise) / maxRaise}%`;
    raiseSize.innerText = "" + raise;
  }

  let holdTimer = null;
  let burstInterval = null;

  function startBurst() {
    burstInterval = setInterval(doRaise, 50);
    holdTimer = null;
  }

  function endPress(e) {
    if (e.button !== 0) return;
    clearTimeout(holdTimer);
    clearInterval(burstInterval);
    holdTimer = null;
    burstInterval = null;
  }

  button.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    doRaise();
    holdTimer = setTimeout(startBurst, 300);
  });

  button.addEventListener("mouseup", endPress);
  button.addEventListener("mouseleave", endPress);
});

let rightButtonState = "";

rightButton.addEventListener("click", (e) => {
  if (e.button === 2) return; // Ignore right-clicks
  switch (rightButtonState) {
    case "raise":
      rightButtonState = "unraise";
      raiseFill.style.height = `${(100 * raise) / maxRaise}%`;
      raiseSize.innerText = "" + raise;
      raisePanel.style.display = "flex";
      break;
    case "unraise":
      rightButtonState = "raise";
      raisePanel.style.display = "none";
      break;
    case "fold any":
      rightButton.classList.add("activeButton");
      rightButtonState = "unfold any";
      middleButton.classList.remove("activeButton");
      middleButtonState = "call any";
      leftButton.classList.remove("activeButton");
      leftButtonState = "check any";
      break;
    case "unfold any":
      rightButton.classList.remove("activeButton");
      rightButtonState = "fold any";
      break;
    case "all in":
      return ws.send(JSON.stringify({ type: "all in" }));
  }
});

function updateRightButton(state, data) {
  rightButton.classList.remove("noButton");
  rightButton.classList.remove("smallText");
  rightButton.classList.remove("activeButton");
  raisePanel.style.display = "none";
  rightButtonState = "";
  switch (state) {
    case "raise":
      rightButton.innerText = "Raise";

      rightButtonState = "raise";
      raise = data.minBet;
      minRaise = data.minBet;
      maxRaise = data.playersData[data.index].bank;
      break;
    case "fold any":
      if (rightButtonState === "unfold any") {
        rightButton.classList.add("smallText");
        rightButton.classList.add("activeButton");
        return;
      }
      rightButton.classList.add("smallText");
      rightButton.innerText = "Fold Any";
      rightButtonState = "fold any";
      break;
    case "all in":
      if (middleButtonState === "uncall any") {
        leftButton.classList.add("noButton");
        middleButton.classList.add("noButton");
        rightButton.classList.add("noButton");
        leftButtonState = "";
        middleButtonState = "";
        rightButtonState = "";
        return ws.send(JSON.stringify({ type: "all in" }));
      }
      rightButton.classList.add("smallText");
      rightButton.innerText = "All In";
      rightButtonState = "all in";
      break;
    default:
      rightButton.classList.add("noButton");
  }
}
