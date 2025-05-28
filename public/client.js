const slider = document.getElementById("size-slider");
slider.addEventListener("input", (e) => {
  const n = e.target.value;
  // rebuild the CSS expression
  document.documentElement.style.setProperty("--u", `min(${n}dvh, ${n}dvw)`);
});

const send = (data) => ws.send(JSON.stringify(data));

function debounce(callback, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback.apply(this, args), delay);
  };
}

const username = document.getElementById("username");

username.addEventListener(
  "input",
  debounce((event) => {
    send({ type: "name", name: event.target.value });
  }, 300)
);

const winrateTooltip = (element, { name, lane, points, winrate }) => {
  const imageSpan = document.createElement("span");
  const image = document.createElement("img");
  image.src = championImage(name);
  imageSpan.append(image);

  const laneSpan = document.createElement("span");
  const imageLane = document.createElement("img");
  imageLane.src = laneImage(lane);
  laneSpan.append(imageLane);

  const pointSpan = document.createElement("span");
  pointSpan.innerText = "◊" + points;
  alphaToShimmer(pointSpan, points / 4);

  const toolTip = pSpan`${laneSpan} ${imageSpan} earns ${pointSpan} points because they have a ${(
    winrate * 100
  ).toFixed(2)}% winrate.`;

  toolTip.classList.add("tooltip");
  element.append(toolTip);
};

function pSpan(strings, ...values) {
  const p = document.createElement("p");
  strings.forEach((text, i) => {
    // append the literal chunk (even if it’s just “ ”)
    p.append(text);
    // then append the corresponding value (if any)
    if (i < values.length) p.append(values[i]);
  });
  return p;
}

// --- WebSocket Connection ---
const protocol = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${protocol}://${location.host}`);

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
        }, 1250);
        return;
      }

      const playerCount = data.activePlayer.length;
      const order = opponentOrder[playerCount];
      for (let oppIndex = 0; oppIndex < order.length; oppIndex++) {
        const trueIndex = (oppIndex + 1 + data.index) % playerCount;
        if (!data.activePlayer[trueIndex]) continue;
        const timer = order[oppIndex].hand.querySelector(".timer");
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

const playerTimer = document.querySelector(".control .timer");
const handInfo = document.getElementById("info");
const percentBorder = document.getElementById("percent");
const percentFill = document.getElementById("fill");
const handScore = document.getElementById("score");
const handChance = document.getElementById("chance");
const toBet = document.getElementById("bet");

const buildHand = (handID) => {
  const hand = document.getElementById(handID);
  const cards = hand.querySelectorAll(".card");
  const boardScore = Array.from(hand.querySelectorAll(".matrixRow")).map(
    (row) => {
      return row.querySelectorAll(".holePoint");
    }
  );
  return {
    hand,
    name: hand.querySelector(".name"),
    bank: hand.querySelector(".bank"),
    totalScore: hand.querySelector(".totalScore"),

    firstCard: cards[0],
    secondCard: cards[1],

    //These are a list of 3 divs
    holeScore: hand.querySelectorAll(".holeScore > .holePoint"),
    firstBoardScore: boardScore[0],
    secondBoardScore: boardScore[1],
  };
};

const playerHand = buildHand("player-hand");
const topLeft = buildHand("top-left");
const topMiddle = buildHand("top-middle");
const topRight = buildHand("top-right");
const middleLeft = buildHand("middle-left");
const middleRight = buildHand("middle-right");

const board = document.getElementById("board");
const boardCards = board.querySelectorAll(".card");
const pot = board.querySelector(".opponentBet");

const opponentOrder = {
  2: [topMiddle],
  3: [topLeft, topRight],
  4: [middleLeft, topMiddle, middleRight],
  5: [middleLeft, topLeft, topRight, middleRight],
  6: [middleLeft, topLeft, topMiddle, topRight, middleRight],
};

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

const removeShimmer = (element) => {
  element.classList.remove("shimmer");
  element.style.backgroundImage = "none";
  element.style.backgroundColor = "#02010600";
};

const alphaToShimmer = (element, alpha) => {
  if (alpha > 1) alpha *= 2 / 3;
  const hue = 150 + alpha * 150;
  const baseChroma = 0.05 + alpha * 0.1;
  const liteChroma = baseChroma - alpha * 0.1;
  const liteLum = Math.min(0.7 + alpha * 0.2, 0.9);
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
    playerHand.hand.style.display = "none";
    percentBorder.style.border = "0px solid black";
    handInfo.style.display = "none";
    toBet.innerText = "";
    toBet.classList.add("noBet");
    topLeft.hand.style.display = "none";
    topMiddle.hand.style.display = "none";
    topRight.hand.style.display = "none";
    middleLeft.hand.style.display = "none";
    middleRight.hand.style.display = "none";

    board.style.display = "none";
    boardCards.forEach((card) => {
      card.innerHTML = "";
      card.classList.add("noCard");
    });

    pot.querySelector("p").innerText = "";

    return;
  }

  playerHand.hand.style.display = "flex";
  playerHand.holeScore.forEach((e) => (e.innerHTML = ""));
  playerHand.firstBoardScore.forEach((e) => (e.innerHTML = ""));
  playerHand.secondBoardScore.forEach((e) => (e.innerHTML = ""));

  const playerPotData = data.playersData[data.index];
  playerHand.bank.innerHTML = `¢${playerPotData.bank}`;
  playerHand.totalScore.innerHTML = `◊${data.score}`;
  removeShimmer(playerHand.totalScore);
  if (data.finished) alphaToShimmer(playerHand.totalScore, data.alpha);

  const [left, right] = data.playerHand;
  playerHand.holeScore[0].innerText = left.points;
  alphaToShimmer(playerHand.holeScore[0], left.points / 4);
  winrateTooltip(playerHand.holeScore[0], left);

  playerHand.holeScore[1].innerText = data.synergy;
  alphaToShimmer(playerHand.holeScore[1], data.synergy / 4);

  playerHand.holeScore[2].innerText = right.points;
  alphaToShimmer(playerHand.holeScore[2], right.points / 4);
  winrateTooltip(playerHand.holeScore[2], right);


  console.log(left.winrate, data.delta, right.winrate);

  playerHand.firstCard.innerHTML = "";
  const leftImage = document.createElement("img");
  leftImage.src = championImage(left.name);
  playerHand.firstCard.append();
  const leftLaneImage = document.createElement("img");
  leftLaneImage.src = championImage(data.lanes[0]);
  leftLaneImage.classList.add("champLane");
  playerHand.firstCard.append(leftImage, leftLaneImage);

  playerHand.secondCard.innerHTML = "";
  const rightImage = document.createElement("img");
  rightImage.src = championImage(right.name);
  const rightLaneImage = document.createElement("img");
  rightLaneImage.src = championImage(data.lanes[1]);
  rightLaneImage.classList.add("champLane");
  playerHand.secondCard.append(rightImage, rightLaneImage);

  stateClassList.forEach((state) => playerHand.hand.classList.remove(state));
  playerHand.hand.classList.add(stateToClass[playerPotData.state]);

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
      console.log(data.minBet);
      toBet.innerText = `¢${data.minBet}`;
      toBet.classList.remove("noBet");
    }
  }

  opponentOrder[6].forEach((opponent) => {
    opponent.hand.style.display = "none";
  });

  const order = opponentOrder[data.playersData.length];
  for (let opponentIndex = 0; opponentIndex < order.length; opponentIndex++) {
    const trueIndex =
      (opponentIndex + 1 + data.index) % data.playersData.length;
    const opData = data.playersData[trueIndex];
    const opponent = order[opponentIndex];
    opponent.hand.style.display = "flex";
    stateClassList.forEach((state) => opponent.hand.classList.remove(state));
    opponent.hand.classList.add(stateToClass[opData.state]);

    opponent.totalScore.innerHTML = "";
    opponent.holeScore.forEach((s) => (s.innerText = ""));
    opponent.firstBoardScore.forEach((s) => (s.innerText = ""));
    opponent.secondBoardScore.forEach((s) => (s.innerText = ""));

    opponent.bank.innerHTML = `¢${opData.bank}`;
    opponent.name.innerHTML = opData.name;

    if (data.finished) {
      if (!opData.unshow) {
        opponent.holeScore[0].innerText = opData.leftPoints[0];
        alphaToShimmer(opponent.holeScore[0], opData.leftPoints[0] / 4);

        opponent.holeScore[1].innerText = opData.synergy;
        alphaToShimmer(opponent.holeScore[1], opData.synergy / 4);

        opponent.holeScore[2].innerText = opData.rightPoints[0];
        alphaToShimmer(opponent.holeScore[2], opData.rightPoints[0] / 4);

        opData.leftPoints.forEach((point, index) => {
          if (index === 0) return;
          alphaToShimmer(opponent.firstBoardScore[index - 1], point / 4);
          opponent.firstBoardScore[index - 1].innerText = "" + point;
        });

        opData.rightPoints.forEach((point, index) => {
          if (index === 0) return;
          alphaToShimmer(opponent.secondBoardScore[index - 1], point / 4);
          opponent.secondBoardScore[index - 1].innerText = "" + point;
        });
        opponent.totalScore.innerHTML = `◊${opData.score}`;
        alphaToShimmer(opponent.totalScore, opData.alpha);
      }
    }

    opponent.firstCard.innerHTML = "";
    opponent.secondCard.innerHTML = "";

    if (data.finished && !data.playersData[trueIndex].unshow) {
      opponent.firstCard.innerHTML = "";
      opponent.secondCard.innerHTML = "";
      const leftImage = document.createElement("img");
      leftImage.src = championImage(data.playersData[trueIndex].left.name);
      opponent.firstCard.append(leftImage);

      const rightImage = document.createElement("img");
      rightImage.src = championImage(data.playersData[trueIndex].right.name);
      opponent.secondCard.append(rightImage);
    }
  }

  board.style.display = "flex";
  pot.querySelector("p").innerText = `POT ¢${data.pot}`;

  boardCards.forEach((card, index) => {
    card.innerHTML = "";
    card.classList.remove("noCard");

    if (index < data.board.length) {
      const champ = data.board[index];
      const image = document.createElement("img");
      image.src = championImage(champ.name);
      const laneImage = document.createElement("img");
      laneImage.src = championImage(data.lanes[2 + index]);
      laneImage.classList.add("boardLane");
      card.append(image, laneImage);

      playerHand.firstBoardScore[index].innerText = champ.leftPoints;
      alphaToShimmer(playerHand.firstBoardScore[index], champ.leftPoints / 4);
      playerHand.secondBoardScore[index].innerText = champ.rightPoints;
      alphaToShimmer(playerHand.secondBoardScore[index], champ.rightPoints / 4);
    } else {
      const laneImage = document.createElement("img");
      laneImage.src = championImage(data.lanes[2 + index]);
      laneImage.classList.add("dimLane");
      card.append(laneImage);
    }
  });
}

const clear = () => {
  leftButton.classList.add("noButton");
  middleButton.classList.add("noButton");
  rightButton.classList.add("noButton");
  leftButtonState = "";
  middleButtonState = "";
  rightButtonState = "";
};

function updateButtons(data) {
  if (
    data.middleButton === "check" &&
    (leftButtonState === "unfold any" ||
      middleButtonState === "uncheck any" ||
      rightButtonState === "uncall any")
  ) {
    clear();
    return setTimeout(() => send({ type: "check" }), 250);
  }

  if (data.leftButton === "fold" && leftButtonState === "unfold any") {
    clear();
    return setTimeout(() => send({ type: "fold" }), 250);
  }

  if (data.rightButton === "call" && rightButtonState === "uncall any") {
    clear();
    return setTimeout(() => send({ type: "call" }), 250);
  }

  if (data.rightButton === "all in" && rightButtonState === "uncall any") {
    clear();
    return setTimeout(() => send({ type: "all in" }), 250);
  }

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
      return send({ type: "ready up" });
    case "queue up":
      return send({ type: "queue up" });
    case "unready":
      return send({ type: "unready" });
    case "unqueue":
      return send({ type: "unqueue" });
    case "fold":
      return send({ type: "fold" });
    case "fold any":
      rightButton.classList.remove("activeButton");
      rightButtonState = "call any";
      middleButton.classList.remove("activeButton");
      middleButtonState = "check any";
      leftButton.classList.add("activeButton");
      leftButtonState = "unfold any";
      break;
    case "unfold any":
      leftButton.classList.remove("activeButton");
      leftButtonState = "fold any";
      break;
    case "show":
      return send({ type: "show" });
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
    case "show":
      leftButton.style.position = "absolute";
      leftButton.innerText = "Show";
      leftButtonState = "show";
      break;
    case "fold":
      leftButton.innerText = "Fold";
      leftButtonState = "fold";
      break;
    case "fold any":
      if (leftButtonState === "unfold any") {
        leftButton.classList.add("smallText");
        leftButton.classList.add("activeButton");
        return;
      }
      leftButton.classList.add("smallText");
      leftButton.innerText = "Fold Any";
      leftButtonState = "fold any";
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
    case "check":
      return send({ type: "check" });
    case "call":
      return send({ type: "call" });
    case "check any":
      leftButton.classList.remove("activeButton");
      leftButtonState = "fold any";
      middleButton.classList.add("activeButton");
      middleButtonState = "uncheck any";
      rightButton.classList.remove("activeButton");
      rightButtonState = "call any";
      break;
    case "uncheck any":
      middleButton.classList.remove("activeButton");
      middleButtonState = "check any";
      break;
  }
});

function updateMiddleButton(state, data) {
  console.log(state);
  middleButton.classList.remove("noButton");
  middleButton.classList.remove("smallText");
  middleButton.classList.remove("activeButton");
  switch (state) {
    case "check":
      middleButton.innerText = "Check";
      middleButtonState = "check";
      break;
    case "call":
      middleButton.classList.add("smallText");
      middleButton.innerText = `Call ¢${data.minBet}`;
      middleButtonState = "call";
      break;
    case "check any":
      if (middleButtonState == "uncheck any") {
        middleButton.classList.add("smallText");
        middleButton.classList.add("activeButton");
        return;
      }
      middleButton.classList.add("smallText");
      middleButton.innerText = "Pre Check";
      middleButtonState = "check any";
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
      if (raise > minRaise) send({ type: "raise", raise });
      else send({ type: "call" });
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
    case "call any":
      middleButton.classList.remove("activeButton");
      middleButtonState = "check any";
      rightButton.classList.add("activeButton");
      rightButtonState = "uncall any";
      leftButton.classList.remove("activeButton");
      leftButtonState = "fold any";
      break;
    case "uncall any":
      rightButton.classList.remove("activeButton");
      rightButtonState = "call any";
      break;
    case "all in":
      return send({ type: "all in" });
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
    case "call any":
      if (rightButtonState == "uncall any") {
        rightButton.classList.add("smallText");
        rightButton.classList.add("activeButton");
        return;
      }
      rightButton.classList.add("smallText");
      rightButton.innerText = "Call Any";
      rightButtonState = "call any";
      break;
    case "all in":
      rightButton.classList.add("smallText");
      rightButton.innerText = "All In";
      rightButtonState = "all in";
      break;
    default:
      rightButton.classList.add("noButton");
  }
}
