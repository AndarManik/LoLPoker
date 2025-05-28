class Game {
  constructor(id, gameData) {
    this.id = id;
    this.gameData = gameData;
    this.state = "ready up";
    this.players = [];
    this.spectators = [];
    this.queue = [];
  }

  addUser(socket) {
    const player = new Player(socket);
    if (this.state === "ready up") {
      if (this.players.length < 6) {
        player.state = "ready up";
        this.players.push(player);
        this.sendReady();
        socket.send(JSON.stringify({ leftButton: "ready up" }));
      } else {
        player.state = "queue up";
        this.spectators.push(player);
        socket.send(JSON.stringify({ leftButton: "queue up" }));
      }
    } else {
      this.spectators.push(player);
      player.state = "queue up";
      socket.send(JSON.stringify({ leftButton: "queue up" }));
    }

    socket.on("message", (message) => this.onMessage(player, message));

    //MAYHEM: HANDLE THE EXIT LOGIC
    socket.on("close", () => this.onClose(player));
  }

  onMessage(player, message) {
    const data = JSON.parse(message);
    console.log(data);
    switch (data.type) {
      case "ready up":
        if (player.state !== "ready up") return;
        player.state = "ready";
        if (
          this.players.length > 1 &&
          this.readyCount() === this.players.length
        )
          this.startGame();
        else this.sendReady();
        break;
      case "queue up":
        if (player.state !== "queue up") return;
        player.state = "queue";
        this.spectators.splice(this.spectators.indexOf(player), 1);
        this.queue.push(player);
        this.sendQueue();
        break;
      case "unready":
        if (player.state !== "ready") return;
        player.state = "ready up";
        player.socket.send(JSON.stringify({ leftButton: "ready up" }));
        this.sendReady();
        break;
      case "unqueue":
        if (player.state !== "queue") return;
        player.state = "queue up";
        this.queue.splice(this.queue.indexOf(player), 1);
        this.spectators.push(player);
        player.socket.send(JSON.stringify({ leftButton: "queue up" }));
        this.sendQueue();
        break;
      case "name":
        player.name = data.name;
        if (this.state === "ready up") return;
        if (this.state === "finished") return this.sendFinished(false);
        if (this.state === "chopped") return this.sendFinished(false);
        this.sendTurn(false);
        break;
      case "check":
        if (player.state !== "current turn") return;
        player.state = "finished turn";
        this.nextPlayer(player);
        break;
      case "raise":
        if (player.state !== "current turn") return;
        player.pot += data.raise;
        this.toBet = player.pot;
        this.pot += data.raise;
        if (player.pot === player.bank) player.state = "all in";
        else player.state = "finished turn";
        this.players.forEach((otherPlayer) => {
          if (otherPlayer === player) return;
          if (["all in", "folded"].includes(otherPlayer.state)) return;
          otherPlayer.state = "waiting turn";
        });
        this.nextPlayer(player);
        break;
      case "call":
        if (player.state !== "current turn") return;
        this.pot += this.toBet - player.pot;
        player.pot = this.toBet;
        player.state = "finished turn";
        this.nextPlayer(player);
        break;
      case "fold":
        if (player.state !== "current turn") return;
        player.state = "folded";
        this.nextPlayer(player);
        break;
      case "all in":
        if (player.state !== "current turn") return;
        this.pot += player.bank - player.pot;
        player.pot = player.bank;
        player.state = "all in";
        if (player.bank > this.toBet) {
          this.toBet = player.bank;
          this.players.forEach((otherPlayer) => {
            if (otherPlayer === player) return;
            if (["all in", "folded"].includes(otherPlayer.state)) return;
            otherPlayer.state = "waiting turn";
          });
        }
        this.nextPlayer(player);
        break;
      case "show":
        if (player.state !== "folded") return;
        if (this.state !== "finished" && this.state !== "chopped") return;
        if (player.winner) player.state = "current turn";
        else player.state = "waiting turn";
        this.sendFinished(false);
    }
  }

  onClose(player) {
    console.log("socket closed", player.state);
    switch (player.state) {
      case "ready up":
      case "ready":
        this.players.splice(this.players.indexOf(player), 1);

        if (this.queue.length) {
          const queuedPlayer = this.queue.shift();
          this.players.push(queuedPlayer);
          queuedPlayer.state = "ready up";
          queuedPlayer.socket.send(JSON.stringify({ leftButton: "ready up" }));
          this.sendQueue();
        } else if (this.spectators.length) {
          const spectatingPlayer = this.spectators.shift();
          this.players.push(spectatingPlayer);
          spectatingPlayer.state = "ready up";
          spectatingPlayer.socket.send(
            JSON.stringify({ leftButton: "ready up" })
          );
        }

        this.sendReady();
        break;
      case "queue up":
        this.spectators.splice(this.spectators.indexOf(player), 1);
        break;
      case "queue":
        this.queue.splice(this.queue.indexOf(player), 1);
        this.sendQueue();
        break;
      case "all in":
      case "folded":
      case "current turn":
      case "finished turn":
      case "waiting turn":
        if (player.choiceTimeout) player.exitTick();
        const playerIndex = this.players.indexOf(player);
        this.players.splice(playerIndex, 1);
        if (this.players.length === 1) {
          while (this.players.length <= 6 && this.queue.length)
            this.players.push(this.queue.shift());
          // startGame doesn't check player state
          //CALM: Must clear the game restart timeout

          if (this.players.length > 1) return this.startGame();

          this.players[0].state = "ready up";
          this.players[0].socket.send(
            JSON.stringify({ leftButton: "ready up" })
          );
          this.players[0].bank += this.players[0].pot;
          this.players[0].pot = 0;
          this.state = "ready up";
          return;
        }
        this.sendTurn();
        break;
    }
  }

  startGame() {
    if (this.state !== "ready up") return;

    this.state = "zeroth card";
    this.pickOrder = shuffle(["TOP", "MIDDLE", "JUNGLE", "BOTTOM", "UTILITY"]);
    this.deck = this.pickOrder.map(
      (lane) => shuffle(this.gameData[lane]).map((x) => x) //sorta clone
    );

    this.board = [];
    this.toBet = 10;
    this.pot = 15;

    const startingPlayer = Math.floor(Math.random() * this.players.length);
    const bigBlind = Math.floor(Math.random() * this.players.length);
    let smallBlind = Math.floor(Math.random() * (this.players.length - 1));
    if (smallBlind >= bigBlind) smallBlind++;

    this.players.forEach((player, index) => {
      player.state = "waiting turn";
      if (index === startingPlayer) player.state = "current turn";
      const hand = [this.deck[0].pop(), this.deck[1].pop()];
      while (hand[0].name === hand[1].name) {
        this.deck[1].unshift(hand[1]);
        hand[1] = this.deck[1].pop();
      }
      const [left, right] = hand;
      player.hand = [left, right];
      player.handSynergy = left.synergy[right.lane][right.name];
      player.handDelta = left.delta[right.lane][right.name];
      if (index === bigBlind) player.pot += 10;
      if (index === smallBlind) player.pot += 5;
    });

    this.players.forEach((player) => {
      player.score = this.scoreHand(player.hand);
      player.winchance = this.evalutateHand(player.hand);
    });

    this.sendTurn();
  }

  sendTurn(startTick = true) {
    const validStates = [
      "zeroth card",
      "first card",
      "second card",
      "third card",
    ];
    if (!validStates.includes(this.state)) return;
    const playersData = this.players.map(({ bank, pot, state, name }) => {
      return { bank: bank - pot, pot, state, name };
    });

    this.players.forEach((player, index) => {
      const maxBet = player.bank - player.pot;
      const minBet = Math.min(maxBet, this.toBet - player.pot);
      const allIn = maxBet === minBet;
      const board = this.board.map(({ name, lane }) => {
        const [left, right] = player.hand;
        return {
          name,
          leftPoints: left.synergy[lane][name],
          rightPoints: right.synergy[lane][name],
          leftDelta: left.delta[lane][name],
          rightDelta: right.delta[lane][name],
        };
      });

      let maxScore = 12;
      if (this.state === "first card") maxScore = 20;
      if (this.state === "second card") maxScore = 28;
      if (this.state === "third card") maxScore = 36;

      const UI = {
        playersData,
        playerHand: player.hand,
        synergy: player.handSynergy,
        delta: player.handDelta,
        index,
        score: player.score,
        winchance: player.winchance,
        maxScore,
        minBet,
        maxBet,
        pot: this.pot,
        potBet: this.toBet,
        board,
        lanes: this.pickOrder,
      };

      switch (player.state) {
        case "current turn":
          if (minBet === 0) {
            UI.leftButton = "fold";
            UI.middleButton = "check";
            UI.rightButton = "raise";
          } else if (allIn) {
            UI.leftButton = "fold";
            UI.rightButton = "all in";
          } else {
            UI.leftButton = "fold";
            UI.middleButton = "call";
            UI.rightButton = "raise";
          }
          break;
        case "finished turn":
        case "waiting turn":
          UI.leftButton = "fold any";
          UI.middleButton = "check any";
          UI.rightButton = "call any";
          break;
        case "folded":
        case "all in":
          // no buttons
          break;
      }

      player.socket.send(JSON.stringify(UI));

      if (player.state !== "current turn" || !startTick) return;

      player.timeLeft = 30;
      let activePlayer = this.players.map(
        ({ state }) => state === "current turn"
      );

      const tickFunction = () => {
        activePlayer = this.players.map(
          ({ state }) => state === "current turn"
        );

        this.players.forEach(({ socket }, index) => {
          socket.send(
            JSON.stringify({
              activePlayer,
              index,
              timeLeft: player.timeLeft,
            })
          );
        });

        if (player.timeLeft > 0) {
          player.timeLeft--;
          player.choiceTimeout = setTimeout(tickFunction, 1000);
          return;
        }

        if (minBet === 0) player.state = "finished turn";
        else player.state = "folded";
        this.nextPlayer(player);
      };

      player.exitTick = () => {
        this.players.forEach(({ socket }, index) => {
          socket.send(
            JSON.stringify({
              activePlayer,
              index,
              timeLeft: 0,
            })
          );
        });

        clearTimeout(player.choiceTimeout);
      };

      tickFunction();
    });

    //CALM: send spectators
  }

  nextPlayer(player) {
    const validStates = [
      "zeroth card",
      "first card",
      "second card",
      "third card",
    ];
    if (!validStates.includes(this.state)) return;

    this.players.forEach(({ exitTick }) => exitTick && exitTick());

    let notFolded = 0;
    this.players.forEach(
      ({ state }) => (notFolded += state === "folded" ? 0 : 1)
    );

    const potChopped = notFolded === 1;
    if (potChopped) {
      this.state = "chopped";
      this.settlePots();
      this.players.forEach((player) => (player.state = "folded"));
      this.sendFinished();
      return;
    }

    const finished = ["all in", "folded", "finished turn"];
    let allFinished = true;
    this.players.forEach(({ state }) => {
      if (!finished.includes(state)) allFinished = false;
    });

    if (!allFinished) {
      const playerIndex = this.players.indexOf(player);
      const playerCount = this.players.length;
      let nextPlayerIndex = (playerIndex + 1) % playerCount;
      let nextPlayer = this.players[nextPlayerIndex];
      const finished = ["finished turn", "all in", "folded"];
      while (finished.includes(nextPlayer.state) && nextPlayer !== player) {
        nextPlayerIndex = (nextPlayerIndex + 1) % playerCount;
        nextPlayer = this.players[nextPlayerIndex];
      }

      if (nextPlayer !== player) {
        nextPlayer.state = "current turn";
        this.sendTurn();
        return;
      }
    }

    let drawnChamp;
    switch (this.state) {
      case "zeroth card":
        drawnChamp = this.deck[2].pop();
        while (!this.isLegalDraw(drawnChamp)) drawnChamp = this.deck[2].pop();
        this.board.push(drawnChamp);
        this.state = "first card";
        break;
      case "first card":
        drawnChamp = this.deck[3].pop();
        while (!this.isLegalDraw(drawnChamp)) drawnChamp = this.deck[3].pop();
        this.board.push(drawnChamp);
        this.state = "second card";
        break;
      case "second card":
        drawnChamp = this.deck[4].pop();
        while (!this.isLegalDraw(drawnChamp)) drawnChamp = this.deck[4].pop();
        this.board.push(drawnChamp);
        this.state = "third card";
        break;
      case "third card":
        this.state = "finished";
        this.settlePots();
        this.sendFinished();
        return;
    }

    const outNextTurn = ["all in", "folded"];
    this.players.forEach((other) => {
      if (!outNextTurn.includes(other.state)) other.state = "waiting turn";

      other.score = this.scoreHand(other.hand);
      other.winchance = this.evalutateHand(other.hand);
    });

    this.nextPlayer(player);
  }

  // CALM: when players leave they needs to be stored somewhere to be added back into the list as a folded player, their pot will be settled. The player will then be cleaned after. The cleaning needs to happen before the game starts.
  settlePots() {
    if (!["finished", "chopped"].includes(this.state)) return;
    // Reset winners, adjust banks, compute min/max scores
    let minScore = Infinity,
      maxScore = -Infinity;
    this.players.forEach((p) => {
      p.winner = false;
      minScore = Math.min(minScore, p.score);
      maxScore = Math.max(maxScore, p.score);
    });

    // Compute alphas
    const deltaScore = maxScore - minScore;
    this.players.forEach((p) => (p.alpha = (p.score - minScore) / deltaScore));

    // Capture each player’s original pot, deduct from their bank, then zero it
    const origPots = this.players.map((p) => p.pot);
    this.players.forEach((p, i) => {
      p.bank -= origPots[i];
      p.pot = 0;
    });

    // Sort the unique positive bet‐levels
    const levels = Array.from(new Set(origPots.filter((x) => x > 0))).sort(
      (a, b) => a - b
    );

    // For each “layer” between levels, build & award the side‐pot
    let prev = 0;
    for (const lvl of levels) {
      const sliceSize = lvl - prev;

      // Who contributed at least this much?
      const participants = this.players.filter((_, i) => origPots[i] >= lvl);

      // Total chips in this slice
      const subPot = sliceSize * participants.length;

      // Who’s actually contesting? (folded players contributed but can’t win)
      const contenders = participants.filter((p) => p.state !== "folded");
      if (contenders.length === 0) {
        prev = lvl;
        continue;
      }

      // Find the top score among contenders
      const best = Math.max(...contenders.map((p) => p.score));
      const winners = contenders.filter((p) => p.score === best);

      // Split subPot evenly, assign remainders to earliest winners
      const share = Math.floor(subPot / winners.length);
      const remainder = subPot % winners.length;
      winners.forEach((p, i) => {
        p.winner = true;
        p.bank += share + (i < remainder ? 1 : 0);
      });

      prev = lvl;
    }
  }

  sendFinished(restart = true) {
    if (!["finished", "chopped"].includes(this.state)) return;

    const playersData = this.players.map(
      ({ hand, winner, score, bank, alpha, state, name }) => {
        const [left, right] = hand;
        const leftPoints = [left.points];
        const rightPoints = [right.points];
        this.board.forEach(({ name, lane }) => {
          leftPoints.push(left.synergy[lane][name]);
          rightPoints.push(right.synergy[lane][name]);
        });

        const synergy = left.synergy[right.lane][right.name];

        return {
          left,
          right,
          leftPoints,
          rightPoints,
          synergy,
          score,
          alpha: this.state === "chopped" ? 0 : alpha,
          bank,
          name,
          state: winner
            ? "current turn"
            : state === "folded"
            ? "folded"
            : "waiting turn",
          unshow: state === "folded",
        };
      }
    );

    this.players.forEach((player, index) => {
      const board = this.board.map(({ name, lane }) => {
        const [left, right] = player.hand;
        return {
          name,
          leftPoints: left.synergy[lane][name],
          rightPoints: right.synergy[lane][name],
        };
      });
      player.socket.send(
        JSON.stringify({
          playersData,
          playerHand: player.hand,
          synergy: player.handSynergy,
          index,
          score: player.score,
          alpha: this.state === "chopped" ? 0 : player.alpha,
          board,
          finished: true,
          pot: this.pot,
          lanes: this.pickOrder,
          leftButton: playersData[index].unshow ? "show" : "",
        })
      );
    });

    //CALM: send spectators

    if (!restart) return;

    setTimeout(() => {
      this.players.forEach((player) => {
        if (player.bank >= 10) return;
        if (!player.maxBuyIn) player.maxBuyIn = (1000 * 2) / 3;
        player.bank = Math.round(player.maxBuyIn);
        player.maxBuyIn = Math.max((player.maxBuyIn * 2) / 3, 10);
      });
      if (this.players.length < 2) return true; //CALM: reset to queuing lobby
      this.state = "ready up";
      this.startGame();
    }, 7500);
  }

  sendShowOption() {}

  isLegalDraw(drawnChamp) {
    for (let index = 0; index < this.players.length; index++) {
      const player = this.players[index];
      if (player.hand[0].name === drawnChamp.name) return false;
      if (player.hand[1].name === drawnChamp.name) return false;
    }
    for (let index = 0; index < this.board.length; index++) {
      const champ = this.board[index].name;
      if (champ === drawnChamp.name) return false;
      if (champ === drawnChamp.name) return false;
    }
    return true;
  }

  evalutateHand(hand) {
    let betterThan = 0;
    let count = 0;

    const name0 = hand[0].name;
    const name1 = hand[1].name;

    if (this.board.length === 3) {
      const currentScore = this.scoreHand(hand);
      const leftPool = this.gameData[this.pickOrder[0]];
      const rightPool = this.gameData[this.pickOrder[1]];

      for (let i = 0; i < leftPool.length; i++) {
        const left = leftPool[i];
        if (left.name === name0 || left.name === name1) continue;

        for (let j = 0; j < rightPool.length; j++) {
          const right = rightPool[j];
          if (right.name === name0 || right.name === name1) continue;

          if (currentScore >= this.scoreHand([left, right])) betterThan++;
          count++;
        }
      }

      return Math.floor((betterThan / count) * 100);
    }

    if (this.board.length === 2) {
      const champPool = this.gameData[this.pickOrder[4]];
      const leftPool = this.gameData[this.pickOrder[0]];
      const rightPool = this.gameData[this.pickOrder[1]];

      for (let i = 0; i < champPool.length; i++) {
        const champ = champPool[i];
        if (!this.isLegalDraw(champ)) continue;

        this.board.push(champ);
        const currentScore = this.scoreHand(hand);

        for (let j = 0; j < leftPool.length; j++) {
          const left = leftPool[j];
          if (left.name === name0 || left.name === name1) continue;

          for (let k = 0; k < rightPool.length; k++) {
            const right = rightPool[k];
            if (right.name === name0 || right.name === name1) continue;

            if (currentScore >= this.scoreHand([left, right])) betterThan++;
            count++;
          }
        }

        this.board.pop();
      }

      return Math.floor((betterThan / count) * 100);
    }

    const lane = this.board.length + 2;
    const champPool1 = this.gameData[this.pickOrder[lane]];
    const leftPool = this.gameData[this.pickOrder[0]];
    const rightPool = this.gameData[this.pickOrder[1]];

    for (let i = 0; i < champPool1.length; i++) {
      const champ1 = champPool1[i];
      if (!this.isLegalDraw(champ1)) continue;

      this.board.push(champ1);

      const currentScore = this.scoreHand(hand);

      for (let k = 0; k < leftPool.length; k++) {
        const left = leftPool[k];
        if (left.name === name0 || left.name === name1) continue;
        for (let l = 0; l < rightPool.length; l++) {
          const right = rightPool[l];
          if (right.name === name0 || right.name === name1) continue;
          if (currentScore >= this.scoreHand([left, right])) betterThan++;
          count++;
        }
      }

      this.board.pop();
    }

    return Math.floor((betterThan / count) * 100);
  }

  scoreHand(hand) {
    let currentScore = hand[0].points + hand[1].points;
    currentScore += hand[0].synergy[hand[1].lane][hand[1].name];
    for (let index = 0; index < this.board.length; index++) {
      const champ = this.board[index];
      currentScore += hand[0].synergy[champ.lane][champ.name];
      currentScore += hand[1].synergy[champ.lane][champ.name];
    }
    return currentScore;
  }

  readyCount() {
    return this.players.reduce(
      (sum, player) => (player.state === "ready" ? sum + 1 : sum),
      0
    );
  }

  sendReady() {
    this.players.forEach((player) => {
      if (player.state === "ready") {
        player.socket.send(
          JSON.stringify({
            leftButton: "ready count",
            readyCount: this.readyCount(),
            playerCount: this.players.length,
          })
        );
      }

      if (player.state === "ready up") {
        player.socket.send(
          JSON.stringify({
            leftButton: "ready up",
            readyCount: this.readyCount(),
            playerCount: this.players.length,
          })
        );
      }
    });
  }

  sendQueue() {
    this.queue.forEach((player, index) => {
      if (player.state !== "queue") return;
      player.socket.send(
        JSON.stringify({
          leftButton: "queue position",
          position: index + 1,
        })
      );
    });
  }
}

class Player {
  constructor(socket) {
    this.state = "";
    this.socket = socket;
    this.bank = 1000;
    this.pot = 0;
    this.name = "&nbsp;";
  }
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); // random index from 0 to i
    [array[i], array[j]] = [array[j], array[i]]; // swap elements
  }
  return array;
}

module.exports = { Game };
