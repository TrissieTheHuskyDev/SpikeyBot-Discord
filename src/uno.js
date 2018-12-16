// Copyright 2018 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)
require('./subModule.js')(Uno);  // Extends the SubModule class.

/**
 * @classdesc Manages an Uno game.
 * @class
 * @augments SubModule
 * @listens Command#uno
 */
function Uno() {
  const self = this;
  /** @inheritdoc */
  this.myName = 'Uno';

  /** @inheritdoc */
  this.initialize = function() {
    pFlags = self.Discord.Permissions.FLAGS;
    self.command.on(
        new self.command.SingleCommand(
            ['uno', 'one'], commandUno, {validOnlyInGuild: true},
            [new self.command.SingleCommand('endall', commandEndAll, {
              validOnlyInGuild: true,
              permissions: pFlags.MANAGE_CHANNELS,
              defaultDisabled: true,
            })]));
  };

  /** @inheritdoc */
  this.shutdown = function() {
    self.command.removeListener('uno');

    let entries = Object.entries(games);
    entries.forEach((el) => {
      if (typeof el[1].end === 'function') el[1].end();
    });
  };

  /** @inheritdoc */
  this.unloadable = function() {
    return numGames === 0;
  };

  /**
   * ASCII art text to show when a player calls Uno.
   * @private
   * @constant
   * @default
   * @type {string}
   */
  const unoText = '888     888 888b    888  .d88888b.  888 \n' +
      '888     888 8888b   888 d88P" "Y88b 888 \n' +
      '888     888 88888b  888 888     888 888 \n' +
      '888     888 888Y88b 888 888     888 888 \n' +
      '888     888 888 Y88b888 888     888 888 \n' +
      '888     888 888  Y88888 888     888 Y8P \n' +
      'Y88b. .d88P 888   Y8888 Y88b. .d88P  "  \n' +
      ' "Y88888P"  888    Y888  "Y88888P"  888 ';

  /**
   * The number of currently active games. Used to determine of submodule is
   * unloadable.
   * @private
   * @type {number}
   * @default
   */
  let numGames = 0;

  /**
   * self.Discord.Permissions.FLAGS
   * @private
   */
  let pFlags = null;

  /**
   * All games currently in progress mapped by guilds, then by the game ID.
   * @private
   * @type {Object.<Object.<Uno.Game>>}
   */
  let games = {};

  /**
   * Starts an Uno game. If someone is mentioned it will start a game
   * between the message author and the mentioned person. Otherwise, waits for
   * someone to play.
   *
   * @private
   * @type {commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens Command#uno
   */
  function commandUno(msg) {
    if (!msg.guild.me.hasPermission(pFlags.MANAGE_CHANNELS)) {
      self.common.reply(
          msg,
          'I need permission to manage channels in order to start a game of ' +
              'UNO.');
      return;
    }
    self.common.reply(msg, 'Creating a game of UNO.');
    if (!games[msg.guild.id]) games[msg.guild.id] = {};
    let newGame = new self.Game(
        (msg.mentions.members.array() || []).concat([msg.member]), msg.member);
    games[msg.guild.id][newGame.id] = newGame;
  }

  /**
   * Ends all Uno games.
   *
   * @private
   * @type {commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens Command#uno_endall
   */
  function commandEndAll(msg) {
    if (!msg.guild.me.hasPermission(pFlags.MANAGE_CHANNELS)) {
      self.common.reply(msg, 'I don\'t have permission to manage channels.');
      return;
    }
    if (!games[msg.guild.id]) {
      self.common.reply(
          msg, 'There are no UNO games in progress in this server.');
      return;
    }
    let list = Object.values(games[msg.guild.id]);
    list.forEach((g) => {
      if (typeof g.end == 'function') g.end();
    });
    delete games[msg.guild.id];
    self.common.reply(msg, 'All UNO games have been ended.');
  }

  /**
   * Enum for card colors.
   * @public
   * @constant
   * @default
   * @enum {number}
   */
  this.Color = {
    NONE: 0,
    RED: 1,
    BLUE: 2,
    GREEN: 3,
    YELLOW: 4,
  };
  /**
   * Color as entries.
   *
   * @private
   * @constant
   */
  const colorPairs = Object.entries(self.Color);

  /**
   * Regular expression search for acceptable colors. Case insensitive and
   * global flags are set.
   *
   * @private
   * @constant
   * @type {RegExp}
   */
  const colorRegExp = new RegExp(colorPairs.map((el) => el[0]).join('|'), 'ig');

  /**
   * Enum for card faces. The least significant nibble is the card number, all
   * following bits are a bitfield of card properties.
   *
   * 0x010: The card is a wild card.
   * 0x020: The card skips the next player's turn.
   * 0x040: The card reverses play direction.
   * 0x080: The card causes the next player after the turn is over, to draw 2
   * cards.
   * 0x100: The next player must draw 4 cards.
   *
   * EFFECT entries are NOT real card faces, just the bitfield represented with
   * that effect.
   *
   * @public
   * @constant
   * @default
   * @enum {number}
   */
  this.CardFace = {
    SKIP_EFFECT: 0x020,
    SKIP: 0x02A,
    DRAW_TWO_EFFECT: 0x080,
    DRAW_TWO: 0x0AB,
    DRAW_2: 0x0AB,
    REVERSE_EFFECT: 0x040,
    REVERSE: 0x06C,
    WILD_EFFECT: 0x010,
    WILD: 0x01E,
    DRAW_FOUR_EFFECT: 0x100,
    DRAW_FOUR: 0x13D,
    DRAW_4: 0x13D,
    ZERO: 0, 0: 0,
    ONE: 1, 1: 1,
    TWO: 2, 2: 2,
    THREE: 3, 3: 3,
    FOUR: 4, 4: 4,
    FIVE: 5, 5: 5,
    SIX: 6, 6: 6,
    SEVEN: 7, 7: 7,
    EIGHT: 8, 8: 8,
    NINE: 9, 9: 9,
  };
  /**
   * CardFace as entries.
   *
   * @private
   */
  const cardFacePairs =
      Object.entries(self.CardFace).filter((el) => !el[0].endsWith('_EFFECT'));

  /**
   * Regular expression search for acceptable card faces. Case insensitive and
   * global flags are set.
   *
   * @private
   * @constant
   * @type {RegExp}
   */
  const cardFaceRegExp = new RegExp(
      cardFacePairs.map((el) => el[0].replace(/_/g, ' ')).join('|'), 'ig');

  /**
   * Class that stores the current information about a particular card. All
   * cards with the same color and face value are represented here using the
   * `count` attribute.
   * @class
   *
   * @public
   * @param {CardFace} face The face value or type of card this is.
   * @param {Color} color The color of this card.
   */
  this.Card = function(face, color) {
    if (typeof face !== 'number') {
      throw new Error('Given value for card face is not a number!');
    }
    const card = this;
    /**
     * The face value of this card.
     * @public
     * @type {Uno.CardFace}
     */
    this.face = face;
    if (typeof color !== 'number') {
      throw new Error('Given value for card color is not a number!');
    }
    /**
     * The color of this card.
     * @public
     * @type {Uno.Color}
     */
    this.color = color;

    /**
     * The name of this card retreivable with `toString()`. Null until first
     * `toString()` call.
     *
     * @private
     * @type {?string}
     */
    let myName;

    /**
     * Stringifies the face and colors to their key names.
     * @public
     *
     * @return {string} This card as a string.
     */
    this.toString = function() {
      // Wild cards can change color, so we can't cache their name.
      if (myName && !(card.face & self.CardFace.WILD_EFFECT)) return myName;
      if (card.color == self.Color.NONE) {
        myName = cardFacePairs.find((el) => el[1] == card.face)[0];
      } else {
        let colorName = colorPairs.find((el) => el[1] == card.color);
        if (!colorName) {
          console.log(card.color, 'not a valid color');
        }
        colorName = colorName[0];
        myName =
            colorName + ' ' + cardFacePairs.find((el) => el[1] == card.face)[0];
      }
      return myName;
    };
  };

  /**
   * Class that stores the current state of an Uno game.
   * @class
   *
   * @public
   * @param {Discord~GuildMember[]} memberList The players to initially add to
   * this game.
   * @param {Discord~GuildMember} maker The player who created the game and can
   * change settings and manage users.
   */
  this.Game = function(memberList, maker) {
    const game = this;

    numGames++;

    if (!memberList || !memberList.length) {
      throw new Error('Member list must be an array of Discord.GuildMembers.');
    }
    if (!maker || !maker.guild) {
      throw new Error('Game maker must be a guild member.');
    }
    /**
     * The guild members in this game mapped by their ID.
     *
     * @private
     * @type {Object.<Discord~GuildMember>}
     */
    let members = {};

    do {
      /**
       * The ID of this uno game. Should be unique per guild.
       *
       * @public
       * @readonly
       * @type {number}
       */
      this.id = Math.floor((Math.random() * 1000));
    } while (games[maker.guild.id][game.id]);

    /**
     * The array of all player in the game in the order of their turn.
     *
     * @private
     * @type {Uno.Player[]}
     */
    let players = [];

    /**
     * The category that stores all channels for this game. Null until it is
     * created.
     *
     * @public
     * @type {?Discord~CategoryChannel}
     */
    this.catChannel = null;
    /**
     * The channel that all players of this game can view and type in. Null
     * until the channel is created.
     *
     * @public
     * @type {?Discord~TextChannel}
     */
    this.groupChannel = null;

    /**
     * All cards currently not in a player's hand.
     *
     * @private
     * @type {Uno.Card[]}
     */
    let discarded = self.getHand();

    /**
     * Has this game been started.
     *
     * @public
     * @default
     * @readonly
     * @type {boolean}
     */
    this.started = false;

    /**
     * The current index of the player whose turn it is.
     *
     * @private
     * @default
     * @type {number}
     */
    let turn = -1;

    /**
     * If we need to wait for the player to choose a color for a wild card.
     * `null` if not waiting, or a reference to the player we are waiting for.
     *
     * @private
     * @default
     * @type {Uno.Player}
     */
    // let waitingForColor = -1;

    /**
     * The current number of cards a player will need to draw if they cannot
     * stack another draw card.
     *
     * @private
     * @type {number}
     */
    // let drawCount = 0;

    /**
     * The card played by the previous player in the turn order. Will be null
     * after a player has been skipped, since they did not play a card.
     * @see {@link Uno.Game~topCard}
     *
     * @private
     * @type {?Uno.Card}
     */
    // let previousCard = null;

    /**
     * The index of the player whose turn it was previously. This is -1 if the
     * current turn is the first turn of the game, and will otherwise be the
     * previous player to play a card.
     *
     * @private
     * @type {number}
     */
    let previousTurn = -1;

    /**
     * The current card on the top of the discard pile that will need to be
     * matched by the next player to play a card.
     * @see {@link Uno.Game~previousCard}
     *
     * @private
     * @type {?Uno.Card}
     */
    let topCard = null;

    /**
     * The current direction of play. Either 1 or -1.
     *
     * @private
     * @default
     * @type {number}
     */
    let direction = 1;

    /**
     * The current Discord~MessageCollector that is listening to messages in the
     * groupChannel.
     *
     * @private
     * @default
     * type {?Discord~MessageCollector}
     */
    let currentCollector = null;

    /**
     * Creates all channels for this game and currently added players.
     *
     * @private
     */
    (function setupChannels() {
      let channelOpts = {
        topic: 'UNO! (ID:' + game.id + ')',
        permissionOverwrites: [
          {
            id: maker.guild.defaultRole,
            allow: 0,
            deny: pFlags.VIEW_CHANNEL | pFlags.SEND_MESSAGES,
            type: 'role',
          },
          {
            id: self.client.user.id,
            allow: pFlags.VIEW_CHANNEL | pFlags.SEND_MESSAGES,
            deny: 0,
            type: 'member',
          },
        ],
        type: 'category',
        reason: 'An UNO game was started by ' + maker.user.tag,
      };

      for (let i = 0; i < memberList.length; i++) {
        members[memberList[i].id] = memberList[i];
        channelOpts.permissionOverwrites.push({
          id: memberList[i].id,
          allow: pFlags.VIEW_CHANNEL | pFlags.SEND_MESSAGES,
          deny: 0,
          type: 'member',
        });
      }

      maker.guild.channels.create('uno-' + game.id, channelOpts).then((c) => {
        game.catChannel = c;
        maker.guild.channels
            .create('uno-' + game.id, {
              topic: 'UNO! (ID:' + game.id + ')',
              type: 'text',
              reason: 'An UNO game was started by ' + maker.user.tag,
              parent: c,
            })
            .then((c) => {
              game.groupChannel = c;
              for (let i = 0; i < memberList.length; i++) {
                game.addPlayer(memberList[i]);
              }
              finishSetup();
            });
      });
    })();

    /**
     * Begins listening for messages in the groupChannel that relate to the
     * setup of the game, and sends a message to the group channel with game
     * instructions.
     *
     * @private
     */
    function finishSetup() {
      sendHelp().then(() => {
        game.catChannel.overwritePermissions({
          permissionOverwrites: [{
            id: maker.guild.defaultRole,
            allow: pFlags.VIEW_CHANNEL,
            type: 'role',
          }],
        });
      });
      currentCollector = game.groupChannel.createMessageCollector((m) => {
        if (m.author.id != maker.id) {
          if (m.content.toLowerCase().startsWith('uno leave')) {
            game.removePlayer(m.author.id);
          }
          return false;
        }
        if (m.content.toLowerCase().startsWith('uno')) {
          self.log(msg.content);
          let cmd = m.content.toLowerCase().split(' ')[1];
          switch (cmd) {
            case 'begin':
            case 'start':
              if (players.length > 1) {
                setTimeout(startGame);
                return true;
              } else {
                self.common.reply(
                    m,
                    'You can\'t play by yourself! `invite` other players to' +
                        ' join you first.');
                return false;
              }
            case 'end':
            case 'abort':
            case 'stop':
              game.end();
              return true;
            case 'players':
              listPlayers();
              return false;
            case 'invite':
              if (m.mentions.members.size == 0) {
                self.common.reply(m, 'Please mention users to invite.');
              } else {
                m.mentions.members.forEach((m) => {
                  game.addPlayer(m);
                });
                self.common.reply(m, 'Players have been added to the game.');
              }
              return false;
            case 'kick':
              m.mentions.members.forEach((el) => {
                game.removePlayer(el);
              });
              listPlayers();
              return false;
            case 'leave':
              self.common.reply(
                  m, 'As the game creator you cannot leave the game.\nIf' +
                      ' you wish to end the game, use `uno end`.');
              return false;
          }
          return false;
        }
      }, {max: 1});
      currentCollector.on('end', () => {
        currentCollector = null;
      });
    }

    /**
     * Send the list of current players in this game to the group channel.
     */
    function listPlayers() {
      let embed = new self.Discord.MessageEmbed();
      embed.setTitle('Current Players');
      embed.setDescription(players.map((p) => p.name).join(', '));
      game.groupChannel.send(embed);
    }

    /**
     * Deal cards to all players, and start the game.
     *
     * @private
     */
    function startGame() {
      game.catChannel.overwritePermissions({
        permissionOverwrites: [{
          id: maker.guild.defaultRole,
          deny: pFlags.VIEW_CHANNEL,
          type: 'role',
          reason: 'The UNO game has started.',
        }],
      });

      for (turn = 0; turn < players.length; turn++) {
        players[turn].hand = [];
        drawCards(7, true);
      }

      game.groupChannel.send('`Cards have been dealt.`');

      turn = -1;
      game.started = true;

      // Play the game's first card.
      playCard();

      currentCollector = game.groupChannel.createMessageCollector((m) => {
        // Check for Uno calls.
        if (m.content.match(/^uno\W*$/i)) {
          callUno(m.author.id);
          return false;
        }
        if (m.author.id == maker.id &&
            m.content.toLowerCase().startsWith('uno')) {
          self.log(m.content);
          switch (m.content.toLowerCase().split(' ')[1]) {
            case 'end':
              game.end();
              return true;
            case 'kick':
              m.mentions.members.forEach((el) => {
                game.removePlayer(el);
              });
              listPlayers();
              return false;
          }
        }
        if (turn < 0 || m.author.id != players[turn].id) return false;
        if (m.content.toLowerCase().startsWith('uno')) {
          self.log(m.content);
          let cmd = m.content.toLowerCase().split(' ')[1];
          switch (cmd) {
            case 'play':
              if (playCard(m.content.split(' ').slice(2).join(' '))) {
                setTimeout(finishSetup, 5000);
                game.started = false;
                return true;
              } else {
                return false;
              }
            case 'leave':
              game.removePlayer(m.author.id);
              return false;
          }
          return false;
        } else if (m.content.toLowerCase().startsWith('play')) {
          self.log(m.content);
          if (playCard(m.content.split(' ').slice(1).join(' '))) {
            setTimeout(finishSetup, 5000);
            return true;
          } else {
            return false;
          }
        } else if (m.content.toLowerCase().startsWith('draw')) {
          self.log(m.content);
          drawAndSkip();
          game.groupChannel.send(`\`\`\`${topCard.toString()}\`\`\``);
          return false;
        }
      }, {max: 1});
      currentCollector.on('end', () => {
        currentCollector = null;
      });
    }

    /**
     * Sends the game help to the group channel.
     *
     * @private
     * @return {Promise.<Discord~Message>}
     */
    function sendHelp() {
      let embed = new self.Discord.MessageEmbed();
      embed.setTitle('Welcome to UNO!');
      embed.setAuthor(maker.user.tag);
      embed.setColor([237, 21, 31]);
      embed.setDescription(
          'Just type `UNO!` into this channel to call uno.\nTo play a card, ' +
          'just type `play red 4` or `play yellow two` or `play draw 4` or ' +
          'something like that.\nIf you play a wild card, you must say what ' +
          'color it is when you play it (eg: `play wild red` or `play yellow ' +
          'draw four`).');
      embed.addField(
          'Current Rules',
          'Original rules (non-point based) as described here: ' +
              'https://www.unorules.com/\nWith the following exceptions:\n' +
              '1) Challenging a plus four card is not in this version,\n' +
              '2) If you draw a card, you do not get to play it until your ' +
              'next turn.');
      embed.addField(
          'Player Commands',
          'If you do not wish to be in this game anymore, just type ' +
              '`uno leave` in this channel, and you will be removed.');
      if (!game.started) {
        embed.addField(
            'Lobby Settings',
            'The creator of this game can use the following commands in this ' +
                'channel.\n\nUse `invite @SpikeyRobot#0971` to add new people' +
                ' to this game.\nType `uno kick @SpikeyRobot#0971` to remove ' +
                'them from the game (Note: don\'t use the command prefix).\n' +
                'Type `uno start` to start the game once you\'re ready!\n`uno' +
                ' end` to end this game at any time.');
      } else {
        embed.addField(
            'Lobby Settings',
            'The creator of this game can use the following commands in this ' +
                'channel.\n\n`uno end` to end this game at any time (this ' +
                'deletes all Uno text channels).\n`uno kick @SpikeyRobot#0971' +
                '` to kick players (Careful! They cannot be added back!).');
      }
      return game.groupChannel.send(embed);
    }

    /**
     * Called after a player's turn, to trigger the next player's turn.
     *
     * @param {boolean} [skip=false] True to add additional message saying this
     * player is skipped. Also doesn't send the player their hand. True if this
     * turn is intended to be skipped.
     * @private
     */
    function nextTurn(skip) {
      if (turn > -1) {
        players[turn].channel.send(
            '`Your current hand:`\n' +
            players[turn].hand.map((card) => card.toString()).join('\n'));
      }

      turn += direction;
      if (turn < 0) turn = players.length - 1;
      if (turn > players.length - 1) turn = 0;
      if (skip) {
        game.groupChannel.send(
            '`Skipping` <@' + players[turn].id + '>\'s turn!');
      } else {
        game.groupChannel.send(
            '`Next turn.` <@' + players[turn].id + '>\'s turn! They have ' +
            players[turn].hand.length + ' cards.');
      }
    }

    /**
     * Cause the current player to draw cards from the discarded pile, then skip
     * their turn and continue to the next player.
     *
     * @private
     * @param {number} [num=1] The number of cards to draw.
     */
    function drawAndSkip(num = 1) {
      drawCards(num);
      // previousCard = null;
      nextTurn();
    }

    /**
     * Cause the current player to draw cards from the discarded pile.
     *
     * @private
     * @param {number} num The number of cards to draw.
     * @param {boolean} [silent=false] Do not send a message to the group
     * channel.
     */
    function drawCards(num, silent = false) {
      let drawn = [];
      for (let j = 0; j < num; j++) {
        let single = discarded.splice(
            Math.floor(Math.random() * discarded.length), 1)[0];
        if (single.face & self.CardFace.WILD_EFFECT) {
          single.color = self.Color.NONE;
        }
        drawn.push(single);
      }
      players[turn].hand = drawn.concat(players[turn].hand).sort((a, b) => {
        if (a.face == b.face) {
          return a.color - b.color;
        } else {
          return a.face - b.face;
        }
      });

      if (!silent) {
        game.groupChannel.send(
            '`' + players[turn].name + '` drew ' + num + ' card' +
            (num == 1 ? '' : 's') + ' from the deck.');
        players[turn].channel.send(
            '`You drew:` ' + drawn.map((card) => card.toString()).join(', '));
      } else {
        players[turn].channel.send(
            '`Your current hand:`\n' +
            players[turn].hand.map((card) => card.toString()).join('\n'));
      }
      players[turn].calledUno = false;
    }

    /**
     * Play a card for the current player.
     *
     * @private
     * @param {?string} text User inputted text to parse into a card to play.
     * @return {boolean} True if the game has ended. False if the game should
     * continue.
     */
    function playCard(text) {
      let selected = -1;
      let hand;
      let color;  // Used if a wild card was played.
      if (turn == -1) {
        // First card to be played. No restrictions, any card can be played.
        selected = Math.floor(Math.random() * discarded.length);
        hand = discarded;
        if (hand[selected].face & self.CardFace.WILD_EFFECT) {
          color =
              colorPairs[Math.floor(Math.random() * (colorPairs.length - 1)) +
                         1];
        }
      } else {
        hand = players[turn].hand;
        if (players[turn].bot) {
          let i = hand.length;
          do {
            selected = --i;
          } while (selected >= 0 && !checkCard(hand[selected]));
          if (selected < 0) {
            drawAndSkip();
            return false;
          }
        } else if (!text || !text.trim()) {
          game.groupChannel.send(
              '`Please specify a card, that you have, to play.`');
          return false;
        } else {
          let parsed = parseToCard(text);
          if (!parsed) {
            game.groupChannel.send(
                '`I\'m not sure what card that is.`\n' + text);
            return false;
          }
          if (parsed.face & self.CardFace.WILD_EFFECT) {
            if (parsed.color == self.Color.NONE) {
              game.groupChannel.send(
                  '`Please specify a color to make this card.`');
              return false;
            } else {
              color = parsed.color;
            }
          }
          if (!((parsed.face == topCard.face) ||
                (parsed.face & self.CardFace.WILD_EFFECT ||
                 parsed.color == topCard.color))) {
            game.groupChannel.send('`That\'s not a valid card to play.`');
            return false;
          }
          selected = hand.findIndex((el) => {
            return parsed.face == el.face &&
                (parsed.face & self.CardFace.WILD_EFFECT ||
                 parsed.color == el.color);
          });
          if (selected < 0) {
            game.groupChannel.send(
                '`You don\'t have that card.` Please play a card that you ' +
                'have, or \'draw\' to draw a card from the deck.');
            return false;
          }
        }
      }

      let card = hand.splice(selected, 1)[0];
      discarded.push(card);
      topCard = card;
      // previousCard = card;

      if (color) {
        card.color = color;
      }

      if (turn > -1 && players[turn].hand.length > 0) {
        game.groupChannel.send(
            '`' + players[turn].name + '` has ' + players[turn].hand.length +
            ' cards.```' + card.toString() + '```');
      } else {
        game.groupChannel.send(`\`\`\`${card.toString()}\`\`\``);
      }

      if (hand.length == 0) {
        game.groupChannel.send(
            '<@' + players[turn].id + '> `has no cards remaining!`\n```' +
            players[turn].name + ' is the winner!```');
        return true;
      }

      previousTurn = turn;

      if (card.face & self.CardFace.REVERSE_EFFECT) {
        direction *= -1;
      }
      /* if (card.face & self.CardFace.WILD_EFFECT && !card.color) {
        waitingForColor = players[turn].id;
      } */
      nextTurn(card.face & self.CardFace.SKIP_EFFECT);

      if (card.face & self.CardFace.DRAW_TWO_EFFECT) {
        drawCards(2);
        // previousCard = null;
      }

      if (card.face & self.CardFace.DRAW_FOUR_EFFECT) {
        drawCards(4);
        // previousCard = null;
      }

      if (card.face & self.CardFace.SKIP_EFFECT) {
        nextTurn();
      }
      return false;
    }

    /**
     * Parse a string of text to a playable card.
     * @private
     *
     * @param {string} text The user-input to parse.
     * @return {?Uno.Card} The matched card, or null if no match.
     */
    function parseToCard(text) {
      let colorMatch = text.match(colorRegExp);
      let faceMatch = text.match(cardFaceRegExp);

      if (!faceMatch) return null;
      if (faceMatch.length != 1) return null;
      faceMatch[0] = faceMatch[0].replace(/ /g, '_');

      let color = self.Color.NONE;
      if (colorMatch && colorMatch.length == 1) {
        color = self.Color[colorMatch[0].toUpperCase()];
      }
      let face = self.CardFace[faceMatch[0].toUpperCase()];

      // If not a wild card, and no color was chosen.
      if (!(face & self.CardFace.WILD_EFFECT) && color == self.Color.NONE) {
        return null;
      }

      return new self.Card(face, color);
    }

    /**
     * Checks if the given card may be played next.
     * @see {@link Uno.Game~topCard}
     *
     * @private
     * @param {Uno.Card} card The card to check.
     * @param {Uno.Card} [card2] The card to check against. If not defined, the
     * current topCard will be used.
     * @return {boolean} True if can be played, false otherwise.
     */
    function checkCard(card, card2) {
      card2 = card2 || topCard;
      return (card.face & card2.face) || (card.color & card2.color);
    }

    /**
     * A player has called Uno. To say that they are about to have one card,
     * they now have one card after playing, or the previous person now has one
     * card and did not call Uno.
     *
     * @private
     * @param {string|number} caller The user ID of the player who called Uno.
     */
    function callUno(caller) {
      if (players[turn].id == caller && !players[turn].calledUno &&
          players[turn].hand.length == 2) {
        players[turn].calledUno = true;
        let id = players[turn].id;
        game.groupChannel.send(`<@${id}> called\`\`\`\n${unoText}\n\`\`\``);
      }
      if (previousTurn > -1) {
        if (players[previousTurn].id == caller &&
            !players[previousTurn].calledUno &&
            players[previousTurn].hand.length == 1) {
          players[previousTurn].calledUno = true;
          let id = players[previousTurn].id;
          game.groupChannel.send(`<@${id}> called\`\`\`\n${unoText}\n\`\`\``);
        }
        if (!players[previousTurn].calledUno &&
            players[previousTurn].hand.length == 1) {
          game.groupChannel.send(
              '<@' + players[previousTurn].id +
              '> `forgot to call "UNO!" and now must draw 2 cards!`');
          let tmp = turn;
          turn = previousTurn;
          drawCards(2);
          turn = tmp;
        }
      }
    }

    /**
     * Ends this game and deletes all created channels.
     *
     * @public
     */
    this.end = function() {
      if (currentCollector) currentCollector.stop('Game has ended');
      if (game.groupChannel) {
        game.groupChannel.delete('The UNO game has ended.');
      }
      if (players) {
        players.forEach((p) => {
          if (p.channel) p.channel.delete('The UNO game has ended.');
        });
      }
      if (game.catChannel &&
          game.catChannel.children.size == (1 + players.length)) {
        game.catChannel.delete('The UNO game has ended.');
      }
      delete games[maker.guild.id][game.id];
      numGames--;
    };

    /**
     * Add the given guild member to the game.
     * @public
     *
     * @param {Discord~GuildMember} p The member to add to the game.
     */
    this.addPlayer = function(p) {
      if (!p) return;
      if (!game.catChannel) {
        memberList.push(p);
        return;
      }
      if (p.user.bot) {
        game.groupChannel.send(
            p.user.tag +
            ' could not be added to the game (Bots are not supported yet).');
        return;
      }
      players.push(new self.Player(p, game));
    };

    /**
     * Remove the user with the given ID from the game.
     * @public
     *
     * @param {string|number|Discord~GuildMember|Uno.Player} p The ID of the
     * user to remove.
     */
    this.removePlayer = function(p) {
      if (typeof p === 'object') p = p.id;
      if (!p) return;
      if (!players || !players.length || p.id == maker.id) return;

      let index = players.findIndex((player) => player.id == p);
      if (index > -1) {
        players[index].remove();
        discarded = discarded.concat(players[index].hand.splice(0));
        players.splice(index, 1);
        game.groupChannel.permissionOverwrites.get(p).delete(
            'User removed from game');
        if (turn == index) nextTurn();
      }
    };
  };

  /**
   * A single player in the game.
   *
   * @public
   * @param {Discord~GuildMember} member The guild member this is based off of.
   * @param {Uno.Game} parent The parent game this player will be in.
   */
  this.Player = function(member, parent) {
    const player = this;
    if (typeof member !== 'object') {
      throw new Error('A new player must be based off of a GuildMember.');
    }

    let permOverwrites = [
      {
        id: member.guild.defaultRole,
        allow: 0,
        deny: pFlags.VIEW_CHANNEL,
        type: 'role',
      },
      {
        id: member.id,
        allow: pFlags.VIEW_CHANNEL,
        deny: pFlags.SEND_MESSAGES,
        type: 'member',
      },
      {
        id: self.client.user.id,
        allow: pFlags.VIEW_CHANNEL | pFlags.SEND_MESSAGES,
        deny: 0,
        type: 'member',
      },
    ];

    let channelOpts = Object.assign({
      topic: (member.nickname || member.user.username) + '\'s UNO cards.',
      parent: parent.catChannel,
      permissionOverwrites: permOverwrites,
      type: 'text',
      reason: 'An UNO game was started.',
    });

    /**
     * The Discord ID of this player.
     * @public
     * @readonly
     * @type {string}
     */
    this.id = member.id;
    /**
     * The name of this player.
     * @public
     * @readonly
     * @type {string}
     */
    this.name = member.nickname || member.user.username;
    /**
     * Whether this player is a bot or not.
     *
     * @public
     * @readonly
     * @type {boolean}
     */
    this.bot = member.user.bot;

    /**
     * Whether this player has called uno recently.
     *
     * @public
     * @type {boolean}
     * @default
     */
    this.calledUno = false;

    /**
     * The channel for this player's private messages for the game. Null until
     * the channel is created.
     * @public
     * @readonly
     * @type {?Discord~TextChannel}
     */
    this.channel = null;
    member.guild.channels
        .create(
            parent.catChannel.name + '-' +
                (member.nickname || member.user.username),
            channelOpts)
        .then((channel) => {
          player.channel = channel;
          channel.send(
              '<@' + member.id +
              '> You have been added to this game of Uno!\n\nThis channel ' +
              'will show you the cards you currently have in your hand once ' +
              'the game starts.\n\nUse <#' + parent.groupChannel.id +
              '> to play your cards and talk to other players!');
        })
        .catch((err) => {
          self.error(
              'Failed to create private text channel for member: ' + member.id +
              ' in guild: ' + member.guild.id);
          console.error(err);
          if (parent.groupChannel) {
            parent.groupChannel.send(
                'Failed to create text channel for ' + member.user.tag);
          }
        });
    /**
     * The current cards that this player has in their hand.
     * @public
     * @type {Uno.Card[]}
     */
    this.hand = [];

    /**
     * Remove this player from a game. Deletes the player's text channel.
     *
     * @public
     */
    this.remove = function() {
      if (player.channel) {
        player.channel.delete('Player was removed from the UNO game.');
      }
    };
  };

  /**
   * A default hand of cards that the classic game starts with.
   *
   * @return {Uno.Card[]}
   */
  this.getHand = function() {
    let c = self.Color;
    let f = self.CardFace;
    /* eslint-disable no-multi-spaces */
    return [
      new self.Card(f.ZERO, c.RED),        new self.Card(f.ZERO, c.GREEN),
      new self.Card(f.ZERO, c.YELLOW),     new self.Card(f.ZERO, c.BLUE),
      new self.Card(f.ONE, c.RED),         new self.Card(f.ONE, c.RED),
      new self.Card(f.ONE, c.GREEN),       new self.Card(f.ONE, c.GREEN),
      new self.Card(f.ONE, c.YELLOW),      new self.Card(f.ONE, c.YELLOW),
      new self.Card(f.ONE, c.BLUE),        new self.Card(f.ONE, c.BLUE),
      new self.Card(f.TWO, c.RED),         new self.Card(f.TWO, c.RED),
      new self.Card(f.TWO, c.GREEN),       new self.Card(f.TWO, c.GREEN),
      new self.Card(f.TWO, c.YELLOW),      new self.Card(f.TWO, c.YELLOW),
      new self.Card(f.TWO, c.BLUE),        new self.Card(f.TWO, c.BLUE),
      new self.Card(f.THREE, c.RED),       new self.Card(f.THREE, c.RED),
      new self.Card(f.THREE, c.GREEN),     new self.Card(f.THREE, c.GREEN),
      new self.Card(f.THREE, c.YELLOW),    new self.Card(f.THREE, c.YELLOW),
      new self.Card(f.THREE, c.BLUE),      new self.Card(f.THREE, c.BLUE),
      new self.Card(f.FOUR, c.RED),        new self.Card(f.FOUR, c.RED),
      new self.Card(f.FOUR, c.GREEN),      new self.Card(f.FOUR, c.GREEN),
      new self.Card(f.FOUR, c.YELLOW),     new self.Card(f.FOUR, c.YELLOW),
      new self.Card(f.FOUR, c.BLUE),       new self.Card(f.FOUR, c.BLUE),
      new self.Card(f.FIVE, c.RED),        new self.Card(f.FIVE, c.RED),
      new self.Card(f.FIVE, c.GREEN),      new self.Card(f.FIVE, c.GREEN),
      new self.Card(f.FIVE, c.YELLOW),     new self.Card(f.FIVE, c.YELLOW),
      new self.Card(f.FIVE, c.BLUE),       new self.Card(f.FIVE, c.BLUE),
      new self.Card(f.SIX, c.RED),         new self.Card(f.SIX, c.RED),
      new self.Card(f.SIX, c.GREEN),       new self.Card(f.SIX, c.GREEN),
      new self.Card(f.SIX, c.YELLOW),      new self.Card(f.SIX, c.YELLOW),
      new self.Card(f.SIX, c.BLUE),        new self.Card(f.SIX, c.BLUE),
      new self.Card(f.SEVEN, c.RED),       new self.Card(f.SEVEN, c.RED),
      new self.Card(f.SEVEN, c.GREEN),     new self.Card(f.SEVEN, c.GREEN),
      new self.Card(f.SEVEN, c.YELLOW),    new self.Card(f.SEVEN, c.YELLOW),
      new self.Card(f.SEVEN, c.BLUE),      new self.Card(f.SEVEN, c.BLUE),
      new self.Card(f.EIGHT, c.RED),       new self.Card(f.EIGHT, c.RED),
      new self.Card(f.EIGHT, c.GREEN),     new self.Card(f.EIGHT, c.GREEN),
      new self.Card(f.EIGHT, c.YELLOW),    new self.Card(f.EIGHT, c.YELLOW),
      new self.Card(f.EIGHT, c.BLUE),      new self.Card(f.EIGHT, c.BLUE),
      new self.Card(f.NINE, c.RED),        new self.Card(f.NINE, c.RED),
      new self.Card(f.NINE, c.GREEN),      new self.Card(f.NINE, c.GREEN),
      new self.Card(f.NINE, c.YELLOW),     new self.Card(f.NINE, c.YELLOW),
      new self.Card(f.NINE, c.BLUE),       new self.Card(f.NINE, c.BLUE),
      new self.Card(f.DRAW_TWO, c.RED),    new self.Card(f.DRAW_TWO, c.RED),
      new self.Card(f.DRAW_TWO, c.GREEN),  new self.Card(f.DRAW_TWO, c.GREEN),
      new self.Card(f.DRAW_TWO, c.YELLOW), new self.Card(f.DRAW_TWO, c.YELLOW),
      new self.Card(f.DRAW_TWO, c.BLUE),   new self.Card(f.DRAW_TWO, c.BLUE),
      new self.Card(f.SKIP, c.RED),        new self.Card(f.SKIP, c.RED),
      new self.Card(f.SKIP, c.GREEN),      new self.Card(f.SKIP, c.GREEN),
      new self.Card(f.SKIP, c.YELLOW),     new self.Card(f.SKIP, c.YELLOW),
      new self.Card(f.SKIP, c.BLUE),       new self.Card(f.SKIP, c.BLUE),
      new self.Card(f.REVERSE, c.RED),     new self.Card(f.REVERSE, c.RED),
      new self.Card(f.REVERSE, c.GREEN),   new self.Card(f.REVERSE, c.GREEN),
      new self.Card(f.REVERSE, c.YELLOW),  new self.Card(f.REVERSE, c.YELLOW),
      new self.Card(f.REVERSE, c.BLUE),    new self.Card(f.REVERSE, c.BLUE),
      new self.Card(f.WILD, c.NONE),       new self.Card(f.WILD, c.NONE),
      new self.Card(f.WILD, c.NONE),       new self.Card(f.WILD, c.NONE),
      new self.Card(f.DRAW_FOUR, c.NONE),  new self.Card(f.DRAW_FOUR, c.NONE),
      new self.Card(f.DRAW_FOUR, c.NONE),  new self.Card(f.DRAW_FOUR, c.NONE),
    ];
    /* eslint-enable no-multi-spaces */
  };
}

module.exports = new Uno();
