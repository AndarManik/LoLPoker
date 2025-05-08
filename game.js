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
      socket.send(JSON.stringify({ leftButton: "queue up" })); // CALM: add players data
    }

    socket.on("message", (message) => {
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
          if (this.players.length < 6) {
            player.state = "ready";

            this.spectators.splice(this.spectators.indexOf(player), 1);
            this.players.push(player);

            if (
              this.players.length > 1 &&
              this.readyCount() === this.players.length
            )
              this.startGame();
            else this.sendReady();
            return;
          }

          player.state = "queue";
          this.spectators.splice(this.spectators.indexOf(player), 1);
          this.queue.push(player);
          this.sendQueue();
          break;
        case "unready":
          if (player.state !== "ready") return;
          player.state = "ready up";
          socket.send(JSON.stringify({ leftButton: "ready up" }));
          this.sendReady();
          break;
        case "unqueue":
          if (player.state !== "queue") return;
          player.state = "queue up";
          this.queue.splice(this.queue.indexOf(player), 1);
          this.spectators.push(player);
          socket.send(JSON.stringify({ leftButton: "queue up" }));
          this.sendQueue();
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
        //CALM: Both fold and all in will need to split the pot.
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
      }
    });

    //MAYHEM: HANDLE THE EXIT LOGIC
    socket.on("close", () => {
      console.log("socket closed", player.state);
      switch (player.state) {
        case "ready up":
        case "ready":
          this.players.splice(this.players.indexOf(player), 1);
          if (this.state === "ready up" && this.queue.length) {
            const queuedPlayer = this.queue.shift();
            this.players.push(queuedPlayer);
            queuedPlayer.state = "ready up";
            queuedPlayer.socket.send(
              JSON.stringify({ leftButton: "ready up" })
            );
            this.sendQueue();
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
        case "waiting turn":
          const playerIndex = this.players.indexOf(player);
          this.players.splice(playerIndex, 1);
          if (this.players.length === 1) {
            while (this.players.length <= 6 && this.queue.length)
              this.players.push(this.queue.shift());
            // startGame doesn't check player state
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
    });
  }

  nextPlayer(player) {
    player.cancelTimeout();
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

    //CALM: check if there is only one player left that is not all in or folded
    let drawnChamp;
    switch (this.state) {
      case "first bet":
        drawnChamp = this.deck[2].pop();
        while (!this.isLegalDraw(drawnChamp)) drawnChamp = this.deck[2].pop();
        this.board.push(drawnChamp);
        this.state = "first card";
        break;
      case "first card":
        drawnChamp = this.deck[3].pop();
        while (!this.isLegalDraw(drawnChamp)) drawnChamp = this.deck[3].pop();
        this.board.push(this.deck[3].pop());
        this.state = "second card";
        break;
      case "second card":
        drawnChamp = this.deck[4].pop();
        while (!this.isLegalDraw(drawnChamp)) drawnChamp = this.deck[3].pop();
        this.board.push(this.deck[4].pop());
        this.state = "third card";
        break;
      case "third card":
        //CALM: game is finished
        break;
    }

    const outNextTurn = ["all in", "folded"];
    this.players.forEach((other) => {
      if (!outNextTurn.includes(other.state)) other.state = "waiting turn";

      other.score = this.scoreHand(other.hand);
      other.winchance = this.evalutateHand(other.hand);
    });

    this.nextPlayer(player);
  }

  startGame() {
    this.state = "first bet";

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

      player.hand = [this.deck[0].pop(), this.deck[1].pop()];
      player.handSynergy =
        player.hand[0].synergy[player.hand[1].lane][player.hand[1].name];

      if (index === bigBlind) player.pot += 10;
      if (index === smallBlind) player.pot += 5;
    });

    this.players.forEach((player) => {
      player.score = this.scoreHand(player.hand);
      player.winchance = this.evalutateHand(player.hand);
    });

    this.sendTurn();
  }

  sendTurn() {
    /*

    THIS HAS SOME TERMS WHICH CHANGED IN THE REST OF THE CODE.

    we setup the bet amounts for each player and set their states.
    All players will be 'waiting turn' and one player will be 'current turn'.

    if the 'current turn' player checks/calls:
      if the next player is 'waiting turn' or 'needs call'
        set the current player to 'checked'
        set next player to 'current player'
        sendTurn
      else
        find next player and set as above.
      else if all players are 'checked' 'folded' 'all-in'
        advance the game to the next turn.
    if the 'current turn' player raises:
      set all players which are check to needs call
      go to next 'needs call' player
      sendTurn
    if the 'current turn' player folds:
      if this is the second to last player 
        declare the last player winner
        send out pot winnings
      else go to next turn.

    if the game ends and there multiple hands declare the winner and provide a show hand button. this button will be available for 5 seconds if clicked the cards are shown for 5 seconds
      
    Another thing to consider is side pots, the game should have a list of pots, where a pot is a {size: number, players: [player...]}, once someone all in you make a new pot.
    */
    const playersData = this.players.map((player) => {
      return {
        bank: player.bank - player.pot,
        pot: player.pot,
      };
    });

    this.players.forEach((player, index) => {
      const maxBet = player.bank - player.pot;
      const minBet = Math.min(maxBet, this.toBet - player.pot);
      const allIn = maxBet === minBet;

      const board = this.board.map((champ) => {
        return {
          name: champ.name,
          leftPoints: player.hand[0].synergy[champ.lane][champ.name],
          rightPoints: player.hand[1].synergy[champ.lane][champ.name],
        };
      });

      let maxScore = 12;
      switch (this.state) {
        case "first card":
          maxScore = 20;
          break;
        case "second card":
          maxScore = 28;
          break;
        case "third card":
          maxScore = 36;
          break;
      }

      const UI = {
        playersData,
        playerHand: player.hand,
        synergy: player.handSynergy,
        index,
        score: player.score,
        winchance: player.winchance,
        maxScore,
        minBet,
        maxBet,
        pot: this.pot,
        potBet: this.toBet,
        board,
      };

      switch (player.state) {
        case "current turn":
          if (minBet === 0) {
            UI.leftButton = "check";
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
        case "waiting turn":
          if (minBet === 0) {
            UI.leftButton = "check fold";
            UI.middleButton = "check";
            UI.rightButton = "call any";
          } else if (allIn) {
            UI.leftButton = "fold any";
            UI.rightButton = "all in any";
          } else {
            UI.leftButton = "fold any";
            UI.rightButton = "call any";
          }
          break;
        case "finished":
        case "folded":
        case "all in":
          // no buttons
          break;
      }

      player.socket.send(JSON.stringify(UI));

      if (player.state === "current turn") {
        player.timeLeft = 30;
        let activePlayer = this.players.map(
          (player) => player.state === "current turn"
        );
        const tickFunction = () => {
          activePlayer = this.players.map(
            (player) => player.state === "current turn"
          );

          this.players.forEach((other, index) => {
            other.socket.send(
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

        tickFunction();

        player.cancelTimeout = () => {
          clearTimeout(player.choiceTimeout);
          this.players.forEach((other, index) => {
            other.socket.send(
              JSON.stringify({
                activePlayer,
                index,
                timeLeft: 0,
              })
            );
          });
        };
      }
    });
  }

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
      if (player.state !== "ready") return;
      player.socket.send(
        JSON.stringify({
          leftButton: "ready count",
          readyCount: this.readyCount(),
          playerCount: this.players.length,
        })
      );
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
