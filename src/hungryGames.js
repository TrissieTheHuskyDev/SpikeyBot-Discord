// Copyright 2018-2020 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)
const fs = require('fs');
const Jimp = require('jimp');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const FuzzySearch = require('fuzzy-search');
const MessageMaker = require('./lib/MessageMaker.js');
require('./subModule.js').extend(HG);  // Extends the SubModule class.

/**
 * @classdesc Hunger Games simulator subModule.
 * @class
 * @augments SubModule
 * @listens Discord~Client#guildDelete
 * @listens Discord~Client#channelDelete
 * @listens Command#hg
 */
function HG() {
  const self = this;

  /**
   * Name of the HG Web submodule for lookup.
   *
   * @private
   * @constant
   * @default
   * @type {string}
   */
  const webSM = './web/hg.js';

  this.myName = 'HG';
  this.postPrefix = 'hg ';

  const hgPath = './hg/HungryGames.js';
  delete require.cache[require.resolve(hgPath)];
  const HungryGames = require(hgPath);
  const hg = new HungryGames(self);

  /**
   * @description Fetch a reference to the current HungryGames instance.
   * @public
   * @returns {HungryGames} Current instance.
   */
  this.getHG = function() {
    return hg;
  };

  /**
   * The maximum number of bytes allowed to be received from a client in an
   * image upload.
   *
   * @public
   * @type {number}
   * @constant
   * @default 8000000 (8MB)
   */
  this.maxBytes = 8000000;

  /**
   * The permission tags for all settings related to the Hungry Games.
   *
   * @private
   * @constant
   * @default
   * @type {string[]}
   */
  const patreonSettingKeys = [
    'hg:fun_translators',
    'hg:bar_color',
    'hg:customize_stats',
    'hg:personal_weapon',
  ];
  /**
   * The file path to read battle events.
   *
   * @see {@link HungryGames~battles}
   *
   * @private
   * @type {string}
   * @constant
   * @default
   */
  const battleFile = './save/hgBattles.json';

  /**
   * Maximum amount of time to wait for reactions to a message.
   *
   * @private
   * @type {number}
   * @constant
   * @default 5 Minutes
   */
  const maxReactAwaitTime = 5 * 1000 * 60;  // 5 Minutes

  /**
   * Regex to match all URLs in a string.
   *
   * @private
   * @type {RegExp}
   * @constant
   * @default
   */
  const urlRegex = new RegExp(
      '(http(s)?:\\/\\/.)?(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{2,256}\\.[a-z]' +
          '{2,6}\\b([-a-zA-Z0-9@:%_\\+.~#?&//=]*)(?![^<]*>)',
      'g');

  /**
   * Default options for a game.
   *
   * @private
   * @type {HungryGames~DefaultOptions}
   * @constant
   */
  const defaultOptions = hg.defaultOptions;

  const defaultOptSearcher = new FuzzySearch(defaultOptions.keys);
  let cmdSearcher;
  /**
   * Default options for a game.
   *
   * @type {object.<{
   *     value: string|number|boolean,
   *     values: null|string[],
   *     comment: string
   *   }>}
   * @constant
   */
  this.defaultOptions = defaultOptions;

  /**
   * Default color to choose for embedded messages.
   *
   * @private
   * @type {Discord~ColorResolveable}
   * @constant
   * @default
   */
  const defaultColor = [200, 125, 0];

  /**
   * Color to put above patrons avatars. RGBA Hex (0xRRGGBBAA).
   *
   * @private
   * @type {number}
   * @constant
   * @default
   */
  const patreonColor = 0xF96854FF;

  /**
   * Helper object of emoji characters mapped to names.
   *
   * @private
   * @type {object.<string>}
   * @constant
   */
  const emoji = {
    x: '❌',
    whiteCheckMark: '✅',
    0: '\u0030\u20E3',
    1: '\u0031\u20E3',
    2: '\u0032\u20E3',
    3: '\u0033\u20E3',
    4: '\u0034\u20E3',
    5: '\u0035\u20E3',
    6: '\u0036\u20E3',
    7: '\u0037\u20E3',
    8: '\u0038\u20E3',
    9: '\u0039\u20E3',
    10: '\u{1F51F}',
    arrowUp: '⬆',
    arrowDown: '⬇',
    arrowLeft: '⬅',
    arrowRight: '➡',
    arrowDoubleLeft: '⏪',
    arrowDoubleRight: '⏩',
    arrowsCounterClockwise: '🔄',
    crossedSwords: '⚔',
    shield: '🛡',
    heart: '❤',
    redHeart: '❤️',
    yellowHeart: '💛',
    blueHeart: '💙',
    brokenHeart: '💔',
    skull: '💀',
    question: '⚔',
    redCircle: '🔴',
    trophy: '🏆',
  };

  /**
   * All attacks and outcomes for battles.
   *
   * @see {@link HungryGames~battleFile}
   *
   * @private
   * @type {
   *  {
   *    starts: string[],
   *    attacks: HungryGames~Battle[],
   *    outcomes: string[]
   *   }
   * }
   */
  let battles = {};
  /**
   * @description The file where the default event IDs are listed.
   * @private
   * @type {string}
   * @default
   * @constant
   */
  const eventFileList = './save/hgDefaultEvents.json';
  /**
   * @description Container for all default events.
   * @private
   * @type {HungryGames~EventContainer}
   * @default
   * @constant
   */
  const defaultEvents = new HungryGames.EventContainer();
  /**
   * Messages I have sent showing current options.
   *
   * @private
   * @type {object.<Discord~Message>}
   * @default
   */
  const optionMessages = {};

  /**
   * The last time the currently scheduled reaction event listeners are expected
   * to end. Used for checking of submoduleis unloadable.
   *
   * @private
   * @type {number}
   */
  let listenersEndTime = 0;

  /**
   * All registered event handlers.
   *
   * @private
   * @type {object.<Array.<Function>>}
   */
  const eventHandlers = {};

  /**
   * @description Parse all default events from file.
   *
   * @private
   */
  function updateEvents() {
    fs.readFile(eventFileList, (err, data) => {
      if (err) {
        self.error('Failed to read default event list.');
        console.error(err);
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (!parsed) return;
        loadDefaultsFromIds(parsed);
      } catch (err) {
        self.error(eventFileList + ' Parse failed.');
        console.log(err);
      }
    });
  }
  updateEvents();
  fs.watchFile(eventFileList, {persistent: false}, (curr, prev) => {
    if (curr.mtime == prev.mtime) return;
    if (self.initialized) {
      self.debug('Re-reading default events from file');
    } else {
      console.log('HG: Re-reading default events from file');
    }
    updateEvents();
  });

  /**
   * @description Load all default events from file, described by the loaded
   * list from file.
   * @private
   * @param {{
   *   bloodbath: string[],
   *   player: string[],
   *   arena: string[],
   *   weapon: string[]
   * }} obj List of IDs to load.
   */
  function loadDefaultsFromIds(obj) {
    defaultEvents.updateAndFetchAll(
        obj, () => hg.setDefaultEvents(defaultEvents));
  }

  /**
   * @description Parse all battles from file.
   *
   * @private
   */
  function updateBattles() {
    fs.readFile(battleFile, (err, data) => {
      if (err) return;
      try {
        const parsed = JSON.parse(data);
        if (parsed) {
          battles = self.common.deepFreeze(parsed);
          hg.setDefaultBattles(battles);
        }
      } catch (err) {
        console.log(err);
      }
    });
  }
  updateBattles();
  fs.watchFile(battleFile, {persistent: false}, (curr, prev) => {
    if (curr.mtime == prev.mtime) return;
    if (self.initialized) {
      self.debug('Re-reading battles from file');
    } else {
      console.log('HG: Re-reading battles from file');
    }
    updateBattles();
  });

  /**
   * @description Reply to help on a server.
   *
   * @private
   * @type {string}
   * @default
   */
  const helpmessagereply = 'I sent you a DM with commands!';
  /**
   * @description Reply if unable to send message via DM.
   *
   * @private
   * @type {string}
   * @default
   */
  const blockedmessage =
      'I couldn\'t send you a message, you probably blocked me :(';
  /**
   * @description The object that stores all data to be formatted into the help
   * message.
   *
   * @private
   * @constant
   */
  const helpObject = JSON.parse(fs.readFileSync('./docs/hgHelp.json'));
  /** @inheritdoc */
  this.helpMessage = 'Module loading...';

  /**
   * @description Set all help messages once we know what prefix to use.
   *
   * @private
   */
  function setupHelp() {
    const prefix = self.bot.getPrefix() + self.postPrefix;
    self.helpMessage = '`' + prefix + 'help` for Hungry Games help.';
    // Format help message into rich embed.
    const tmpHelp = new self.Discord.MessageEmbed();
    tmpHelp.setTitle(helpObject.title);
    tmpHelp.setURL(
        self.common.webURL + '#' +
        encodeURIComponent(helpObject.title.replace(/\s/g, '_')));
    helpObject.sections.forEach((obj) => {
      const titleID =
          encodeURIComponent((self.postPrefix + obj.title).replace(/\s/g, '_'));
      const titleURL = `${self.common.webHelp}#${titleID} `;
      tmpHelp.addField(
          obj.title, titleURL + '```js\n' +
              obj.rows
                  .map((row) => {
                    if (typeof row === 'string') {
                      return prefix + row.replace(/\{prefix\}/g, prefix);
                    } else if (typeof row === 'object') {
                      return prefix +
                          row.command.replace(/\{prefix\}/g, prefix) + ' // ' +
                          row.description.replace(/\{prefix\}/g, prefix);
                    }
                  })
                  .join('\n') +
              '\n```',
          true);
    });
    tmpHelp.addField(
        'Web Interface', '[Hungry Games Online Control](' + self.common.webURL +
            'hg/)```Manage the Games without using commands!\n' +
            self.common.webURL + 'hg/```',
        true);
    self.helpMessage = tmpHelp;
  }

  /** @inheritdoc */
  this.initialize = function() {
    const cmdOpts = {
      validOnlyInGuild: true,
      defaultDisabled: true,
      permissions: self.Discord.Permissions.FLAGS.MANAGE_ROLES |
          self.Discord.Permissions.FLAGS.MANAGE_GUILD |
          self.Discord.Permissions.FLAGS.MANAGE_CHANNELS,
    };
    const cmdOptsAnywhere = {
      validOnlyInGuild: false,
      defaultDisabled: true,
      permissions: self.Discord.Permissions.FLAGS.MANAGE_ROLES |
          self.Discord.Permissions.FLAGS.MANAGE_GUILD |
          self.Discord.Permissions.FLAGS.MANAGE_CHANNELS,
    };
    const subCmds = [
      new self.command.SingleCommand('help', help),
      new self.command.SingleCommand('makemewin', commandMakeMeWin),
      new self.command.SingleCommand('makemelose', commandMakeMeLose),
      new self.command.SingleCommand(
          ['create', 'c', 'new'], mkCmd(createGame), cmdOpts),
      new self.command.SingleCommand(
          ['reset', 'clear'], mkCmd(resetGame), cmdOpts),
      new self.command.SingleCommand(['debug'], mkCmd(showGameInfo), cmdOpts),
      new self.command.SingleCommand(
          ['exclude', 'remove', 'exc', 'ex'], mkCmd(excludeUser), cmdOpts),
      new self.command.SingleCommand(
          ['include', 'add', 'inc', 'in'], mkCmd(includeUser), cmdOpts),
      new self.command.SingleCommand(
          ['options', 'setting', 'settings', 'set', 'option', 'opt', 'opts'],
          mkCmd(toggleOpt), cmdOpts),
      new self.command.SingleCommand(
          ['events', 'event'], mkCmd(useWebsiteForCustom), cmdOpts),
      new self.command.SingleCommand(
          ['claimlegacy'], mkCmd(commandClaimLegacyEvents), cmdOpts),
      new self.command.SingleCommand(
          ['npc', 'ai', 'npcs', 'ais', 'bots', 'bot'], mkCmd(listNPCs), cmdOpts,
          [
            new self.command.SingleCommand(
                ['add', 'create'], mkCmd(createNPC), cmdOpts),
            new self.command.SingleCommand(
                ['rename', 'name', 'edit'], mkCmd(renameNPC), cmdOpts),
            new self.command.SingleCommand(
                ['remove', 'delete'], mkCmd(removeNPC), cmdOpts),
            new self.command.SingleCommand(
                ['include', 'inc', 'in'], mkCmd(includeNPC), cmdOpts),
            new self.command.SingleCommand(
                ['exclude', 'exc', 'ex'], mkCmd(excludeNPC), cmdOpts),
          ]),
      new self.command.SingleCommand(
          ['players', 'player', 'list'], mkCmd(listPlayers), cmdOpts),
      new self.command.SingleCommand(
          ['start', 's', 'begin'], mkCmd(startGame), cmdOpts),
      new self.command.SingleCommand(['pause', 'p'], mkCmd(pauseGame), cmdOpts),
      new self.command.SingleCommand(
          ['autoplay', 'autostart', 'auto', 'play', 'go'], mkCmd(startAutoplay),
          cmdOpts),
      new self.command.SingleCommand(
          ['next', 'nextday', 'resume', 'continue', 'unpause'], mkCmd(nextDay),
          cmdOpts),
      new self.command.SingleCommand(
          ['step', 'single', 'one', 'nextevent'], mkCmd(commandStep), cmdOpts),
      new self.command.SingleCommand(
          ['end', 'abort', 'stop'], mkCmd(endGame), cmdOpts),
      new self.command.SingleCommand(
          ['save'],
          (msg) => {
            if (self.common.trustedIds.includes(msg.author.id)) {
              self.save('async');
              msg.channel.send('`Saving all data.`');
            } else {
              self.common.reply(msg, 'You can\'t do that.', 'No');
            }
          },
          cmdOpts),
      new self.command.SingleCommand(
          ['team', 'teams', 't'], mkCmd(editTeam), cmdOpts),
      new self.command.SingleCommand(
          ['stats', 'stat', 'info', 'me'], mkCmd(commandStats),
          {validOnlyInGuild: true}),
      new self.command.SingleCommand(
          [
            'lb', 'leaderboard', 'leaderboards', 'leader', 'leaders', 'top',
            'rank', 'ranks',
          ],
          mkCmd(commandLeaderboard), {validOnlyInGuild: true}),
      new self.command.SingleCommand(
          ['group', 'groups', 'season', 'seasons', 'g', 'gr'],
          mkCmd(commandGroups), cmdOpts,
          [
            new self.command.SingleCommand(
                ['create', 'new', 'make'], mkCmd(commandNewGroup), cmdOpts),
            new self.command.SingleCommand(
                ['delete', 'remove'], mkCmd(commandDeleteGroup), cmdOpts),
            new self.command.SingleCommand(
                ['select', 'choose', 'use'], mkCmd(commandSelectGroup),
                cmdOpts),
            new self.command.SingleCommand(
                ['rename', 'name', 'title'], mkCmd(commandRenameGroup),
                cmdOpts),
          ]),
      new self.command.SingleCommand(
          ['nums'], mkCmd(commandNums), cmdOptsAnywhere),
      new self.command.SingleCommand(
          ['rig', 'rigged'], mkCmd(commandRig), cmdOptsAnywhere),
      new self.command.SingleCommand(
          ['kill', 'smite'], mkCmd(commandKill), cmdOpts),
      new self.command.SingleCommand(
          ['heal', 'revive', 'thrive', 'resurrect', 'restore'],
          mkCmd(commandHeal), cmdOpts),
      new self.command.SingleCommand(
          ['wound', 'hurt', 'damage', 'stab', 'punch', 'slap', 'injure'],
          mkCmd(commandWound), cmdOpts),
      new self.command.SingleCommand(
          [
            'give', 'reward', 'award', 'sponsor', 'rewards', 'awards', 'gift',
            'gifts', 'sponsors',
          ],
          mkCmd(commandGiveWeapon), cmdOpts),
      new self.command.SingleCommand(
          ['take', 'destroy', 'reduce'], mkCmd(commandTakeWeapon), cmdOpts),
      new self.command.SingleCommand(
          ['rename', 'name'], mkCmd(commandRename), cmdOpts),
      new self.command.SingleCommand(
          ['react', 'reaction', 'emote', 'emoji'], mkCmd(commandReactJoin),
          cmdOpts),
    ];
    const hgCmd =
        new self.command.SingleCommand(
            [
              'hg', 'hunger', 'hungry', 'hungergames', 'hungrygames',
              'hungergame', 'hungrygame',
            ],
            function(msg) {
              if (cmdSearcher && msg.text && msg.text.length > 1) {
                const toSearch = msg.text.trim().split(' ')[0];
                const searched = cmdSearcher.search(toSearch);
                if (searched && searched.length > 0) {
                  if (searched.length > 1) {
                    self.common.reply(
                        msg, 'Hmm, did you mean one of the following commands?',
                        searched
                            .map((el) => `${msg.prefix}${self.postPrefix}${el}`)
                            .join('\n'));
                  } else {
                    self.common.reply(
                        msg, 'Hmm, did you mean "' + msg.prefix +
                            self.postPrefix + searched[0] + '"?');
                  }
                  return;
                }
              }
              self.common.reply(
                  msg, 'Oh noes! I can\'t understand that! "' + msg.prefix +
                      self.postPrefix + 'help" for help.');
            },
            null, subCmds);
    self.command.on(hgCmd);

    setupHelp();

    self.client.on('guildDelete', onGuildDelete);
    self.client.on('channelDelete', onChannelDelete);

    self.client.guilds.cache.forEach((g) => {
      hg.fetchGame(g.id, (game) => {
        if (!game) return;

        if (game.currentGame && game.currentGame.day.state > 1 &&
            game.currentGame.inProgress && !game.currentGame.ended &&
            !game.currentGame.isPaused) {
          try {
            self.nextDay(game.author, g.id, game.outputChannel);
          } catch (err) {
            console.error(err);
          }
        } else {
          delete hg._games[g.id];
          delete hg._findTimestamps[g.id];
        }
      });
    });

    cmdSearcher = new FuzzySearch(
        Object.values(hgCmd.subCmds)
            .map((el) => el.aliases)
            .reduce((a, c) => a.concat(c)));

    if (self.client.shard) {
      /**
       * @description Fetch a string with the HG stats for this shard.
       * @private
       * @returns {string} Formatted stats string.
       */
      self.client.getHGStats = getStatsString;
    }
  };

  /** @inheritdoc */
  this.shutdown = function() {
    self.command.deleteEvent('hg');
    self.client.removeListener('guildDelete', onGuildDelete);
    self.client.removeListener('channelDelete', onChannelDelete);
    self._fire('shutdown');

    Object.keys(eventHandlers).forEach((el) => delete eventHandlers[el]);

    fs.unwatchFile(eventFileList);
    fs.unwatchFile(battleFile);

    hg.shutdown();

    if (self.client.shard) {
      self.client.getHGStats = null;
    }
  };

  /** @inheritdoc */
  this.unloadable = function() {
    const web = self.bot.getSubmodule(webSM);
    return self.getNumSimulating() === 0 && listenersEndTime < Date.now() &&
        (!web || !web.getNumClients || web.getNumClients() == 0);
  };
  /** @inheritdoc */
  this.reloadable = function() {
    return self.getNumSimulating() === 0 && listenersEndTime < Date.now();
  };

  /**
   * @description Handle being removed from a guild.
   *
   * @private
   * @param {Discord~Guild} guild The guild that we just left.
   * @listens Discord~Client#guildDelete
   */
  function onGuildDelete(guild) {
    hg.fetchGame(guild.id, (game) => {
      if (!game || !game.currentGame || !game.currentGame.inProgress) return;
      self.endGame(null, guild.id, true);
    });
  }

  /**
   * @description Handle a channel being deleted. Cleans up games that may be in
   * progress in these channels.
   *
   * @private
   * @param {Discord~DMChannel|Discord~GuildChannel} channel The channel that
   * was deleted.
   * @listens Discord~Client#channelDelete
   */
  function onChannelDelete(channel) {
    if (!channel.guild) return;
    if (!hg._games[channel.guild.id]) return;
    self.pauseGame(channel.guild.id);
  }

  /**
   * Make a subcommand handler with the given callback function. This is a
   * wrapper around existing functions.
   *
   * @private
   * @param {HungryGames~hgCommandHandler} cb Command handler when subcommand is
   * triggered.
   * @returns {Command~commandHandler} Subcommand initial handler that will fire
   * when command is fired. Calls the passed callback handler with the mapped
   * parameters.
   */
  function mkCmd(cb) {
    return function(msg) {
      if (self.common.isRelease &&
          (msg.guild && msg.guild.memberCount > 75000)) {
        self.common.reply(
            msg,
            'Sorry, but HG has been temporarily disabled on servers larger' +
                ' than 75000 people.',
            'More information may be available on my support server.');
        return;
      }
      const id = msg.guild && msg.guild.id;
      const cached = id && hg._games[id];
      hg.fetchGame(id, (game) => {
        if (game) {
          if (!cached && game.legacyEvents) {
            setTimeout(() => {
              if (!hg._games[id]) return;
              if (!game.legacyEvents) return;
              self.common.reply(
                  msg, 'Important Legacy Event Notice',
                  'Storage for custom events has been updated.\nUse `' +
                      msg.prefix + self.postPrefix +
                      'claimlegacy` to move all custom events to your account' +
                      '.\n\nBe aware that whoever runs the command, will be ' +
                      'the only one who can edit the events, and will have ' +
                      'sole ownership of the events.\n\nCustom events will ' +
                      'not be used in the game until they have been claimed.');
            }, 1000);
          }
          if (game.loading) {
            self.common.reply(
                msg, 'Still loading', 'A previous command is still loading. ' +
                    'Please wait for it to complete.');
            return;
          }
          game.channel = msg.channel.id;
          game.author = msg.author.id;
          let text = msg.text.trim().toLocaleLowerCase();
          if (text.length > 0) {
            if (game.includedNPCs) {
              game.includedNPCs.sort(
                  (a, b) => b.username.length - a.username.length);
              game.includedNPCs.forEach((el) => {
                if (text.indexOf(el.username.toLocaleLowerCase()) > -1) {
                  // text = text.replace(el.username.toLocaleLowerCase(), '');
                  msg.softMentions.users.set(el.id, el);
                } else if (text.indexOf(el.id.toLocaleLowerCase()) > -1) {
                  text = text.replace(el.id.toLocaleLowerCase(), '');
                  msg.softMentions.users.set(el.id, el);
                }
              });
            }
            if (game.excludedNPCs) {
              game.excludedNPCs.sort(
                  (a, b) => b.username.length - a.username.length);
              game.excludedNPCs.forEach((el) => {
                if (text.indexOf(el.username.toLocaleLowerCase()) > -1) {
                  // text = text.replace(el.username.toLocaleLowerCase(), '');
                  msg.softMentions.users.set(el.id, el);
                } else if (text.indexOf(el.id.toLocaleLowerCase()) > -1) {
                  text = text.replace(el.id.toLocaleLowerCase(), '');
                  msg.softMentions.users.set(el.id, el);
                }
              });
            }
          }
        }
        cb(msg, id /* , game*/);
      });
    };
  }

  /**
   * Tell a user their chances of winning have not increased.
   *
   * @private
   * @type {commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens Command#hg makemelose
   */
  function commandMakeMeWin(msg) {
    self.common.reply(msg, 'Everyone\'s probability of winning has increased!');
  }

  /**
   * Tell a user their chances of losing have not increased.
   *
   * @private
   * @type {commandHandler}
   * @param {Discord~Message} msg Message that triggered command.
   * @listens Command#hg makemelose
   */
  function commandMakeMeLose(msg) {
    self.common.reply(
        msg, `Your probability of losing has increased by ${nothing()}!`);
  }

  /**
   * Handler for a Hungry Games command.
   *
   * @callback HungryGames~hgCommandHandler
   * @param {Discord~Message} msg The message sent in Discord that triggered
   * this command.
   * @param {string} id The id of the guild this command was run on for
   * convenience.
   */

  /**
   * @description A player object representing a non-player. It makes sense I
   * promise. This represents a Player in the game, that is not attached to a
   * real account. Serializable.
   * @inner
   * @augments HungryGames~Player
   */
  class NPC extends HungryGames.Player {
    /**
     * @description Create a non-player character.
     * @param {string} username The username to show for this npc.
     * @param {string} avatarURL The url (or fake url) of the image to use as
     * the player's avatar.
     * @param {string} [id] Id to assign, if a valid id is not provided, a
     * random id will be generated.
     */
    constructor(username, avatarURL, id) {
      if (typeof id !== 'string' || !NPC.checkID(id)) {
        id = NPC.createID();
      }
      super(id, username, avatarURL);
      /**
       * Always true.
       *
       * @public
       * @default
       * @constant
       * @type {boolean}
       */
      this.isNPC = true;
      /**
       * Equivalent to `this.name` for compatibility.
       *
       * @public
       * @type {string}
       */
      this.username = this.name;
    }
  }
  /**
   * Create an NPC from an Object. Similar to copy-constructor.
   *
   * @public
   * @param {object} data NPC like Object.
   * @returns {HungryGames~NPC} Copied NPC.
   */
  NPC.from = function(data) {
    const npc = new NPC(data.username, data.avatarURL, data.id);
    Object.assign(npc, HungryGames.Player.from(data));
    return npc;
  };
  /**
   * Generate a userID for an NPC.
   *
   * @public
   * @returns {string} Generated ID.
   */
  NPC.createID = function() {
    let id;
    do {
      id = `NPC${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    } while (fs.existsSync(`${self.common.userSaveDir}avatars/${id}`));
    return id;
  };
  /**
   * Check if the given ID is a valid NPC ID.
   *
   * @public
   * @param {string} id The ID to validate.
   * @returns {boolean} True if ID is a valid ID for an NPC.
   */
  NPC.checkID = function(id) {
    return typeof id === 'string' &&
        (id.match(/^NPC[A-F0-9]+$/) && true || false);
  };
  /**
   * Save an image for an NPC. Does NOT limit download sizes.
   *
   * @public
   * @param {string|Jimp|Buffer} avatar Any image, URL or file path to fetch the
   * avatar from. Anything supported by Jimp.
   * @param {string} id The NPC id to save the avatar to.
   * @returns {?Promise} Promise if successful will have the public URL where
   * the avatar is available. Null if error.
   */
  NPC.saveAvatar = function(avatar, id) {
    if (!NPC.checkID(id)) return null;
    return self.readImage(avatar).then((image) => {
      if (!image) throw new Error('Failed to fetch NPC avatar.');
      const dir = self.common.userSaveDir + 'avatars/' + id + '/';
      const imgName = Date.now() + '.png';
      const filename = dir + imgName;
      const url = self.common.avatarURL +
          (self.common.isRelease ? 'avatars/' : 'dev/avatars/') + id + '/' +
          imgName;
      const fetchSize = HungryGames.UserIconUrl.fetchSize;
      image.resize(fetchSize, fetchSize);
      image.getBuffer(Jimp.MIME_PNG, (err, buffer) => {
        if (err) {
          self.error(`Failed to convert image into buffer: ${avatar}`);
          console.error(err);
          return;
        }
        self.common.mkAndWrite(filename, dir, buffer, (err) => {
          if (!err) return;
          self.error(`Failed to cache NPC avatar: ${filename}`);
          console.error(err);
        });
      });
      return url;
    });
  };
  /**
   * @inheritdoc
   * @public
   */
  this.NPC = NPC;

  /**
   * @description Returns an object storing all of the default events for the
   * games.
   *
   * @public
   * @returns {HungryGames~EventContainer} Object storing default events.
   */
  this.getDefaultEvents = function() {
    return defaultEvents;
  };
  /**
   * @description Returns the object storing all default
   * {@link HungryGames~Battle}s parsed from file.
   *
   * @public
   * @returns {HungryGames~Battle[]} Array of all default battle events.
   */
  this.getDefaultBattles = function() {
    return battles;
  };
  /**
   * @description Returns the object storing all default
   * {@link HungryGames~Weapon}s parsed from file.
   *
   * @public
   * @returns {HungryGames~Weapon[]} Array of all default weapons.
   */
  this.getDefaultWeapons = function() {
    return defaultEvents.getArray('weapon');
  };

  // Create //
  /**
   * Create a Hungry Games for a guild.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {?Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {boolean} [silent=false] Should we suppress replies to message.
   * @param {Function} [cb] Callback that fires once loading is complete. Only
   * parameter is created {@link HungryGames~GuildGame} or null if failed.
   */
  function createGame(msg, id, silent, cb) {
    if (!msg) {
      silent = true;
      msg = {
        guild: self.client.guilds.resolve(id),
      };
    }
    const g = hg.getGame(id);
    /**
     * @description Fires once game creation is done, and we are ready to
     * continue.
     * @private
     * @param {?HungryGames~GuildGame} game Created GuildGame if successful.
     */
    const done = function(game) {
      if (!game) {
        self.warn('Failed to create/refresh game');
        cb(null);
        return;
      }
      game.formTeams();
      fetchPatreonSettings(game.currentGame.includedUsers, null, null, () => {
        if (typeof cb === 'function') cb(game);
      });
    };
    if (g && g.currentGame && g.currentGame.inProgress) {
      if (!silent) {
        self.common.reply(
            msg,
            'This server already has a Hungry Games in progress. If you wish ' +
                'to create a new one, you must end the current one first ' +
                'with "' + msg.prefix + self.postPrefix + 'end".');
      }
      if (typeof cb === 'function') cb(null);
    } else if (g) {
      if (!silent) self.common.reply(msg, 'Refreshing current game.');
      g.includedUsers = g.includedUsers.filter((u) => {
        const m = msg.guild.members.resolve(u);
        if (m && m.partial) m.fetch();
        return m && !m.deleted;
      });
      if (msg.guild.memberCount >= HungryGames.largeServerCount) {
        g.excludedUsers = [];
      } else {
        g.excludedUsers = g.excludedUsers.filter((u) => {
          const m = msg.guild.members.resolve(u);
          if (m && m.partial) m.fetch();
          return m && !m.deleted;
        });
      }
      hg.refresh(msg.guild, done);
    } else {
      hg.create(msg.guild, (game) => {
        if (!silent) {
          self.common.reply(
              msg,
              'Created a Hungry Games with default settings and all members ' +
                  'included.');
        }
        done(game);
      });
    }
  }
  /**
   * Create a Hungry Games for a guild.
   *
   * @public
   * @param {string} id The id of the guild to create the game in.
   * @param {Function} [cb] Callback that fires once loading is complete. Only
   * parameter is created {@link HungryGames~GuildGame} or null if failed.
   */
  this.createGame = function(id, cb) {
    createGame(null, id, true, cb);
  };

  /**
   * Given an array of players, lookup the settings for each and update their
   * data. This is asynchronous.
   *
   * @private
   *
   * @param {HungryGames~Player[]} players The players to lookup and update.
   * @param {?string|number} cId The channel ID to fetch the settings for.
   * @param {?string|number} gId The guild ID to fetch the settings for.
   * @param {Function} [cb] Calls this callback on completion. No parameters.
   */
  function fetchPatreonSettings(players, cId, gId, cb) {
    if (!self.bot.patreon || players.length == 0) {
      if (cb) cb();
      return;
    }
    let permResponses = 0;
    let settingRequests = 0;
    let settingResponses = 0;

    /**
     * After retrieving whether the player is an actual patron (ignores
     * overrides), then fetch permissions from them (uses overrides).
     *
     * @private
     *
     * @param {?string} err Error string or null.
     * @param {?{status: string[], message: string}} info Permission
     * information.
     * @param {number} p Player object to update.
     */
    function onCheckPatron(err, info, p) {
      if (!err) {
        if (info.status) {
          p.settings['isPatron'] = true;
        }
      }
      self.bot.patreon.getAllPerms(
          p.id, cId, gId, (err, info) => onPermResponse(err, info, p));
    }
    /**
     * After retrieving a player's permissions, fetch their settings for each.
     *
     * @private
     * @param {?string} err Error string or null.
     * @param {?{status: string[], message: string}} info Permission
     * information.
     * @param {number} p Player object to update.
     */
    function onPermResponse(err, info, p) {
      permResponses++;
      if (err) {
        if (permResponses === players.length &&
            settingRequests === settingResponses && cb) {
          cb();
        }
        return;
      }
      const values = info.status;
      for (let i = 0; i < values.length; i++) {
        if (!patreonSettingKeys.includes(values[i])) continue;
        settingRequests++;
        self.bot.patreon.getSettingValue(
            p.id, cId, gId, values[i],
            ((p, v) => (err, info) => onSettingResponse(err, info, p, v))(
                p, values[i]));
      }
      if (permResponses === players.length &&
          settingRequests === settingResponses && cb) {
        cb();
      }
    }

    /**
     * After retrieving a player's settings, update their data with the relevant
     * values.
     *
     * @private
     * @param {?string} err Error string or null.
     * @param {?{status: *, message: string}} info Permission information.
     * @param {number} p Player object to update.
     * @param {string} setting The setting name to update.
     */
    function onSettingResponse(err, info, p, setting) {
      settingResponses++;
      if (err) {
        self.error(err);
      } else {
        if (setting == 'hg:bar_color') {
          let color;
          if (info.status.match(/^0x[0-9A-Fa-f]{8}$/)) {
            color = info.status * 1;
          } else if (info.status.match(/^0x[0-9A-Fa-f]{6}$/)) {
            // Color requires alpha value, but given is just rgb. Shift rgb,
            // then set alpha.
            color = ((info.status * 1) << 8) | 0xFF;
          } else {
            if (p.settings.isPatron) {
              color = patreonColor;
            } else {
              color = 0x0;
            }
          }
          p.settings[setting] = color >>> 0;
        } else {
          p.settings[setting] = info.status;
        }
      }
      if (permResponses === players.length &&
          settingRequests === settingResponses && cb) {
        cb();
      }
    }

    for (let i = 0; i < players.length; i++) {
      self.bot.patreon.checkPerm(
          players[i].id, null,
          ((p) => (err, info) => onCheckPatron(err, info, p))(players[i]));
    }
  }

  /**
   * Reset data that the user specifies.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function resetGame(msg, id) {
    const command = msg.text.trim().split(' ')[0];
    self.common.reply(msg, 'Reset HG', hg.resetGame(id, command));
  }
  /**
   * Send all of the game data about the current server to the chat.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function showGameInfo(msg, id) {
    let finalId = id;
    if (self.common.trustedIds.includes(msg.author.id)) {
      if (msg.text.trim().split(' ')[0]) {
        finalId = msg.text.trim().split(' ')[0];
      }
    }
    const game = hg.getGame(finalId);
    if (game) {
      const file = new self.Discord.MessageAttachment();
      file.setFile(Buffer.from(JSON.stringify(game.serializable, null, 2)));
      file.setName(`HG-${finalId}.json`);
      msg.channel.send(`HG Data for guild ${finalId}`, file);
    } else {
      self.common.reply(msg, 'No game created', finalId);
    }
  }

  // Time Control //
  /**
   * Start the games in the channel this was called from.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function startGame(msg, id) {
    const game = hg.getGame(id);
    if (game && game.currentGame && game.currentGame.inProgress) {
      self.common.reply(
          msg, 'A game is already in progress! ("' + msg.prefix +
              self.postPrefix + 'next" for next day, or "' + msg.prefix +
              self.postPrefix + 'end" to abort)');
      return;
    }
    const myPerms = msg.channel.permissionsFor(self.client.user.id);
    if (!myPerms || !myPerms.has(self.Discord.Permissions.FLAGS.ATTACH_FILES)) {
      self.common.reply(
          msg, 'Sorry, but I need permission to send images ' +
              'in this channel before I can start the games.\nPlease ensure' +
              ' I have the "Attach Files" permission in this channel.',
          myPerms ? null :
                    'This is probably an error, this should be fixed soon.');
      if (!myPerms) {
        self.error(
            'Failed to fetch perms for myself. ' + (msg.guild.me && true));
      }
      return;
    } else if (!myPerms.has(self.Discord.Permissions.FLAGS.EMBED_LINKS)) {
      self.common.reply(
          msg, 'Sorry, but I need permission to embed messages ' +
              'in this channel before I can start the games.\nPlease ensure' +
              ' I have the "Embed Links" permission in this channel.');
      return;
    } else if (!myPerms.has(self.Discord.Permissions.FLAGS.SEND_MESSAGES)) {
      return;
    }
    if (game && game.reactMessage) {
      self.endReactJoinMessage(id, (err) => {
        if (err) {
          self.error(`${err}: ${id}`);
          self.common.reply(msg, 'React Join Failed', err);
        }
        startGame(msg, id);
      });
      return;
    }
    if (game) game.loading = true;
    /**
     * Once the game has finished loading all necessary data, start it if
     * autoplay is enabled.
     *
     * @private
     */
    function loadingComplete() {
      self.client.setTimeout(() => {
        self._fire('gameStarted', id);
        const game = hg.getGame(id);
        HungryGames.ActionManager.gameStart(hg, game);
        if (game.autoPlay) nextDay(msg, id);
      });
      if (game) game.loading = false;
    }

    createGame(msg, id, true, (g) => {
      if (!g) {
        if (game) {
          game.loading = false;
          if (game.currentGame) game.currentGame.inProgress = false;
        }
        self.warn('Failed to create game to start game');
        self.common.reply(msg, 'Failed to create game for unknown reason.');
        return;
      }

      g.currentGame.inProgress = true;
      const finalMessage = makePlayerListEmbed(g);
      finalMessage.setTitle(hg.messages.get('gameStart'));

      if (!g.autoPlay) {
        finalMessage.setFooter(
            `"${msg.prefix}${self.postPrefix}next" for next day.`);
      }

      let mentions = self.common.mention(msg);
      if (g.options.mentionEveryoneAtStart) {
        mentions += '@everyone';
      }

      msg.channel.send(mentions, finalMessage).catch((err) => {
        self.common.reply(
            msg, 'Game started!',
            'Discord rejected my normal message for some reason...');
        self.error(
            'Failed to send start game message: ' + msg.channel.id + ' (Num: ' +
            g.currentGame.includedUsers.length + ')');
        console.error(err);
      });
      loadingComplete();
    });
    if (game && game.currentGame) game.currentGame.inProgress = true;
  }
  /**
   * Start the games in the given channel and guild by the given user.
   *
   * @public
   * @param {string} uId The id of the user who trigged the games to start.
   * @param {string} gId The id of the guild to run the games in.
   * @param {string} cId The id of the channel to run the games in.
   */
  this.startGame = function(uId, gId, cId) {
    startGame(makeMessage(uId, gId, cId), gId);
  };
  /**
   * Start autoplay in the given channel and guild by the given user.
   *
   * @public
   * @param {string} uId The id of the user who trigged autoplay to start.
   * @param {string} gId The id of the guild to run autoplay in.
   * @param {string} cId The id of the channel to run autoplay in.
   */
  this.startAutoplay = function(uId, gId, cId) {
    startAutoplay(makeMessage(uId, gId, cId), gId);
  };
  /**
   * End the games in the given guild as the given user.
   *
   * @public
   * @param {string|Discord~Message} uId The id of the user who trigged the
   * games to end, or a Discord message sent by the user who triggered this.
   * @param {string} gId The id of the guild to end the games in.
   */
  this.endGame = function(uId, gId) {
    if (uId != null && typeof uId === 'object') {
      endGame(uId, gId);
    } else {
      endGame(makeMessage(uId, gId, null), gId, true);
    }
  };
  /**
   * Pause autoplay in the given guild as the given user.
   *
   * @public
   * @param {string} uId The id of the user who trigged autoplay to end.
   * @param {string} gId The id of the guild to end autoplay.
   */
  this.pauseAutoplay = function(uId, gId) {
    pauseAutoplay(makeMessage(uId, gId, null), gId);
  };
  /**
   * Forms a Discord~Message similar object from given IDs.
   *
   * @private
   * @param {string} uId The id of the user who wrote this message.
   * @param {string} gId The id of the guild this message is in.
   * @param {?string} cId The id of the channel this message was 'sent' in.
   * @param {?string} msg The message content.
   * @returns {MessageMaker} The created message-like object.
   */
  function makeMessage(uId, gId, cId, msg) {
    if (!cId && hg.getGame(gId)) cId = hg.getGame(gId).channel;
    return new MessageMaker(self, uId, gId, cId, msg);
  }
  /**
   * Stop autoplaying.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function pauseAutoplay(msg, id) {
    if (!hg.getGame(id)) {
      self.common.reply(
          msg, 'Not autoplaying. If you wish to autoplay, type "' + msg.prefix +
              self.postPrefix + 'autoplay".');
      return;
    }
    if (hg.getGame(id).autoPlay) {
      if (msg && msg.channel) {
        msg.channel.send(
            '<@' + msg.author.id +
            '> `Autoplay will stop at the end of the current day.`');
      }
      hg.getGame(id).autoPlay = false;
    } else {
      if (msg && msg.channel) {
        self.common.reply(
            msg, 'Not autoplaying. If you wish to autoplay, type "' +
                msg.prefix + self.postPrefix + 'autoplay".');
      }
    }
  }
  /**
   * Start autoplaying.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] The game object to start autoplay on.
   */
  function startAutoplay(msg, id, game) {
    if (!game) game = hg.getGame(id);
    if (!game || !game.currentGame) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        startAutoplay(msg, id, game);
      });
      return;
    }
    if (game.autoPlay && game.currentGame.inProgress) {
      if (game.currentGame.isPaused) {
        self.common.reply(
            msg, 'Autoplay is already enabled.', 'To resume the game, use `' +
                msg.prefix + self.postPrefix + 'resume`.');
      } else {
        pauseAutoplay(msg, id);
      }
    } else {
      game.autoPlay = true;
      if (game.currentGame.inProgress && game.currentGame.day.state === 0) {
        if (self.command.validate(msg.prefix + 'hg next', msg)) {
          self.common.reply(
              msg,
              'Sorry, but you don\'t have permission to start the next day ' +
                  'in the games.');
          return;
        }
        msg.channel.send(
            '<@' + msg.author.id +
            '> `Enabling Autoplay! Starting the next day!`');
        game.currentGame.isPaused = false;
        nextDay(msg, id);
      } else if (!game.currentGame.inProgress) {
        if (self.command.validate(msg.prefix + 'hg start', msg)) {
          self.common.reply(
              msg, 'Sorry, but you don\'t have permission to start the games.',
              'hg start');
          return;
        }
        msg.channel.send(
            '<@' + msg.author.id +
            '> `Autoplay is enabled. Starting the games!`');
        startGame(msg, id);
      } else if (game.currentGame.isPaused) {
        self.common.reply(
            msg, 'Enabling Autoplay',
            'Resume game with `' + msg.prefix + self.postPrefix + 'resume`.');
      } else {
        msg.channel.send('<@' + msg.author.id + '> `Enabling autoplay!`');
      }
    }
  }

  /**
   * Pause the game in by clearing the current interval.
   *
   * @public
   * @param {string} id The id of the guild to pause in.
   * @returns {string} User information of the outcome of this command.
   */
  this.pauseGame = function(id) {
    if (!hg.getGame(id) || !hg.getGame(id).currentGame ||
        !hg.getGame(id).currentGame.inProgress) {
      return 'Failed: There isn\'t currently a game in progress.';
    }
    if (hg.getGame(id).currentGame.isPaused) {
      return 'Failed: Game is already paused.';
    }
    hg.getGame(id).clearIntervals();
    hg.getGame(id).currentGame.isPaused = true;
    return 'Success';
  };

  /**
   * Stop the game in the middle of the day until resumed. Just clears the
   * interval for the game.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function pauseGame(msg, id) {
    self.common.reply(msg, 'Game Pausing', self.pauseGame(id));
  }

  /**
   * Start the next day of the game in the given channel and guild by the given
   * user.
   *
   * @public
   * @param {string} uId The id of the user who trigged autoplay to start.
   * @param {string} gId The id of the guild to run autoplay in.
   * @param {string} cId The id of the channel to run autoplay in.
   */
  this.nextDay = function(uId, gId, cId) {
    nextDay(makeMessage(uId, gId, cId), gId);
  };
  /**
   * Simulate a single day then show events to users.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {boolean} [autoStep=true] Value to pass for autoStep.
   */
  function nextDay(msg, id, autoStep = true) {
    if (!msg.channel) {
      self.error('Failed to start next day because channel is unknown: ' + id);
      return;
    }
    const game = hg.getGame(id);
    if (!game || !game.currentGame ||
        !game.currentGame.inProgress) {
      self.common
          .reply(
              msg, 'You must start a game first! Use "' + msg.prefix +
                  self.postPrefix + 'start" to start a game!')
          .catch((err) => {
            self.error('Failed to tell user to start game: ' + err.message);
            if (err.message != 'No Perms') console.error(err);
          });
      if (game) game.clearIntervals();
      return;
    }
    if (game.currentGame.day.state !== 0) {
      if (game._autoStep) {
        self.common.reply(msg, 'Already simulating day.');
      } else if (game.currentGame.day.state == 1) {
        self.common
            .reply(
                msg,
                'I think I\'m already simulating... if this isn\'t true this ' +
                    'game has crashed and you must end the game.')
            .catch((err) => {
              self.error(
                  'Failed to tell user day is already in progress: ' +
                  err.message);
              if (err.message != 'No Perms') console.error(err);
            });
      } else if (autoStep) {
        game.createInterval(dayStateModified);
      } else {
        game.setStateUpdateCallback(dayStateModified);
        game.step();
      }
      return;
    }
    const myPerms = msg.channel.permissionsFor(self.client.user.id);
    if (!myPerms ||
        (!myPerms.has(self.Discord.Permissions.FLAGS.ATTACH_FILES) &&
         !myPerms.has(self.Discord.Permissions.FLAGS.ADMINISTRATOR))) {
      self.common.reply(
          msg, 'Sorry, but I need permission to send images ' +
              'in this channel before I can start the games.\nPlease ensure' +
              ' I have the "Attach Files" permission in this channel.',
          myPerms ? null :
                    'This is probably a bug, this should be fixed soon.');
      if (!myPerms) {
        self.error(
            'Failed to fetch perms for myself. ' + (msg.guild.me && true));
      }
      return;
    } else if (
      !myPerms.has(self.Discord.Permissions.FLAGS.EMBED_LINKS) &&
        !myPerms.has(self.Discord.Permissions.FLAGS.ADMINISTRATOR)) {
      self.common.reply(
          msg, 'Sorry, but I need permission to embed messages ' +
              'in this channel before I can start the games.\nPlease ensure' +
              ' I have the "Embed Links" permission in this channel.');
      return;
    }
    const sim = new HungryGames.Simulator(game, hg, msg);
    const iTime = Date.now();
    sim.go(() => {
      game.outputChannel = msg.channel.id;

      // Signal ready to display events.
      self._fire('dayStateChange', id);
      HungryGames.ActionManager.dayStart(hg, game);
      if (!game._dayEventInterval && !game._autoPlayTimeout) {
        game._autoPlayTimeout = setTimeout(() => {
          game.setStateUpdateCallback(dayStateModified);
          if (!game._dayEventInterval && autoStep) game.createInterval();
        }, game.options.disableOutput ? 0 : game.options.delayEvents);
      }
    });
    const now = Date.now();
    if (now - iTime > 10) {
      self.warn(`Simulator.go ${now - iTime}`);
    }
    /**
     * @description Callback for every time the game state is modified.
     * @fires HG#dayStateChange
     * @private
     * @type {HungryGames~GuildGame~StateUpdateCB}
     * @param {boolean} dayComplete Has the day ended.
     * @param {boolean} doSim If next day should be simulated and started.
     */
    function dayStateModified(dayComplete, doSim) {
      self._fire('dayStateChange', id);
      if (doSim) {
        nextDay(msg, id, !game.currentGame.isPaused);
      } else if (dayComplete) {
        endDayCheck(msg, id);
      } else {
        HungryGames.ActionManager.stepped(hg, game);
      }
    }
  }

  /**
   * Trigger the end of a day.
   *
   * @private
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function endDayCheck(msg, id) {
    let numAlive = 0;
    let numTeams = 0;
    const game = hg.getGame(id);
    const current = game.currentGame;
    current.includedUsers.forEach((el) => el.living && numAlive++);
    if (game.options.teamSize > 0) {
      current.teams.forEach((team) => team.numAlive > 0 && numTeams++);
    }

    if (current.numAlive != numAlive) {
      self.warn(
          'Realtime alive count is incorrect! ' + current.numAlive + ' vs ' +
          numAlive);
      current.numAlive = numAlive;
    }

    const collab = game.options.teammatesCollaborate == 'always' ||
        (game.options.teammatesCollaborate == 'untilend' &&
         numTeams > 1);
    if ((collab && numTeams === 1) || numAlive <= 1) {
      current.inProgress = false;
      current.ended = true;
      game.autoPlay = false;
      HungryGames.ActionManager.gameEnd(hg, game);
    } else {
      HungryGames.ActionManager.dayEnd(hg, game);
    }
  }
  /**
   * Show only the next event in a day.
   *
   * @public
   * @param {string} uId The id of the user who trigged this step.
   * @param {string} gId The id of the guild to step the game in.
   * @param {string} cId The id of the channel the request was sent from.
   */
  this.gameStep = function(uId, gId, cId) {
    commandStep(makeMessage(uId, gId, cId), gId);
  };
  /**
   * Show only the next event in a day.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function commandStep(msg, id) {
    if (!msg.channel) {
      self.error('Failed to start next day because channel is unknown: ' + id);
      return;
    }
    const game = hg.getGame(id);
    if (game && game.currentGame && !game.currentGame.isPaused) {
      pauseGame(msg, id);
    } else if (
      !game || !game.currentGame || !game.currentGame.inProgress ||
        !game.currentGame.day.state < 2 || !game._stateUpdateCallback) {
      nextDay(msg, id, false);
    } else {
      game.currentGame.isPaused = true;
      game.step();
    }
  }
  /**
   * End a game early.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {boolean} [silent=false] Prevent sending messages.
   */
  function endGame(msg, id, silent = false) {
    const game = hg.getGame(id);
    if (!game || !game.currentGame.inProgress) {
      if (!silent && msg) {
        self.common.reply(msg, 'There isn\'t a game in progress.');
      }
    } else if (
      game.loading || (game.currentGame && game.currentGame.day.state == 1)) {
      if (!silent && msg) {
        self.common.reply(
            msg, 'Game is currently loading. Please wait, then try again.');
      }
    } else {
      game.end();
      HungryGames.ActionManager.gameAbort(hg, game);
      if (!silent && msg) self.common.reply(msg, 'The game has ended!');
    }
  }

  // User Management //
  /**
   * Remove a user from users to be in next game.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] Game object to exclude user from.
   */
  function excludeUser(msg, id, game) {
    if (!game) game = hg.getGame(id);
    if (!game || !game.currentGame) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        excludeUser(msg, id, game);
      });
      return;
    }
    let firstWord = msg.text.trim().split(' ')[0];
    if (firstWord) firstWord = firstWord.toLowerCase();
    const specialWords = {
      everyone: ['everyone', '@everyone', 'all'],
      online: ['online', 'here'],
      offline: ['offline'],
      idle: ['idle', 'away', 'snooze', 'snoozed'],
      dnd: ['dnd', 'busy'],
      bots: ['bot', 'bots'],
      npcs: ['npc', 'npcs', 'ai', 'ais'],
    };
    let resPrefix = '';
    let resPostfix = ' have been removed from the games.';
    const done = function(response) {
      self.common.reply(msg, resPrefix + resPostfix, response.substr(0, 2048));
    };
    if (game.currentGame.inProgress) {
      resPostfix = ' will be removed from the next game.';
    }
    if (specialWords.everyone.includes(firstWord)) {
      resPrefix = 'All users';
      self.excludeUsers('everyone', id, done);
    } else if (specialWords.online.includes(firstWord)) {
      resPrefix = 'All online users';
      self.excludeUsers('online', id, done);
    } else if (specialWords.offline.includes(firstWord)) {
      resPrefix = 'All offline users';
      self.excludeUsers('offline', id, done);
    } else if (specialWords.idle.includes(firstWord)) {
      resPrefix = 'All idle users';
      self.excludeUsers('idle', id, done);
    } else if (specialWords.dnd.includes(firstWord)) {
      resPrefix = 'All DND users';
      self.excludeUsers('dnd', id, done);
    } else if (specialWords.npcs.includes(firstWord)) {
      resPrefix = 'All NPCs';
      self.excludeUsers(game.includedNPCs.slice(0), id, done);
    } else if (specialWords.bots.includes(firstWord)) {
      resPrefix = 'Bots';
      resPostfix = ' are now blocked from the games.';
      done(self.setOption(id, 'includeBots', false));
    } else if (
      msg.mentions.users.size + msg.softMentions.users.size +
            msg.mentions.roles.size + msg.softMentions.roles.size ==
        0) {
      self.common.reply(
          msg,
          'You must specify who you wish for me to exclude from the next ' +
              'game.');
    } else {
      self.excludeUsers(parseMentions(msg), id, (res) => {
        self.common.reply(msg, res);
      });
    }
  }

  /**
   * Removes users from a games of a given guild.
   *
   * @fires HG#refresh
   * @public
   * @param {string|string[]|Discord~User[]|HungryGames~NPC[]} users The users
   * to exclude, or
   * 'everyone' to exclude everyone.
   * @param {string} id The guild id to remove the users from.
   * @param {Function} cb Callback for when long running operations complete.
   * Single argument with a string with the outcomes of each user. May have
   * multiple lines for a single user.
   */
  this.excludeUsers = function(users, id, cb) {
    const game = hg.getGame(id);
    if (!game) {
      cb('No game');
      return;
    }
    if (game.loading) {
      cb('A previous command is still loading.\n' +
         'Please wait for it to complete.');
      return;
    }
    if (!game.excludedNPCs) game.excludedNPCs = [];
    if (!game.includedNPCs) game.includedNPCs = [];
    const iTime = Date.now();
    const tmp = [];
    let npcs = [];
    const large = self.client.guilds.resolve(id).memberCount >=
        HungryGames.largeServerCount;
    switch (users) {
      case 'everyone':
        users = game.includedUsers;
        npcs = game.includedNPCs;
        break;
      case 'online':
      case 'offline':
      case 'idle':
      case 'dnd':
        game.includedUsers.forEach((u) => {
          const user = self.client.users.resolve(u);
          if (user && user.presence.status === users) tmp.push(user);
        });
        users = tmp;
        break;
      default:
        if (typeof users === 'string') {
          cb('Invalid users');
          return;
        }
        break;
    }
    if (!Array.isArray(users)) {
      users = users.array();
    }
    const num = users.length + npcs.length;
    const numUsers = users.length;
    if (num > 10000) {
      self.warn(`Excluding ${num} users.`);
    }
    const iTime2 = Date.now();
    const onlyError = num > 2;
    const response = [];
    let fetchWait = 0;
    const chunk = function(i = -1) {
      if (i < 0) i = num - 1;
      // Touch the game so it doesn't get purged from memory.
      const game = hg.getGame(id);
      game.loading = true;

      const start = Date.now();
      for (i; i >= 0 && Date.now() - start < hg.maxDelta; i--) {
        if (i < numUsers) {
          if (typeof users[i] === 'string' && !users[i].startsWith('NPC') &&
              !self.client.users.resolve(users[i])) {
            fetchWait++;
            self.client.users.fetch(users[i]).then(fetched).catch((err) => {
              response.push(err.message);
              fetched();
            });
          } else {
            response.push(excludeIterate(game, users[i], onlyError, large));
          }
        } else {
          response.push(
              excludeIterate(game, npcs[i - numUsers], onlyError, large));
        }
      }
      if (i >= 0) {
        setTimeout(() => {
          chunk(i);
        });
      } else if (fetchWait === 0) {
        done();
      }
    };
    const done = function() {
      game.loading = false;
      const now = Date.now();
      const begin = iTime2 - iTime;
      const loop = now - iTime2;
      if (begin > 10 || loop > 10) {
        self.debug(`Excluding ${num} ${begin} ${loop}`);
      }
      const finalRes = (response.length > 0 &&
                        response.filter((el) => el !== '\n').join('').trim()) ||
          `Succeeded without errors (${num} excluded)`;
      cb(finalRes);
      self._fire('refresh', id);
    };

    const fetched = function(user) {
      fetchWait--;
      if (user) response.push(excludeIterate(game, user, onlyError, large));
      if (fetchWait === 0) done();
    };

    setTimeout(chunk);
  };

  /**
   * @description Exclude a single user from the game as a single iteration step
   * of the exclude command.
   * @private
   * @param {HungryGames~GuildGame} game The game to manipulate.
   * @param {string|HungryGames~Player|HungryGames~NPC} obj Player for this
   * iteration.
   * @param {boolean} [onlyError=false] Only add error messages to response.
   * @param {boolean} [large=false] Is this a large game where excluded users
   * are not tracked.
   * @returns {string} Response text for the user performing the operation.
   */
  function excludeIterate(game, obj, onlyError = false, large = false) {
    if (!obj || obj === 'undefined') return '';
    const response = [];
    if (typeof obj === 'string') {
      if (obj.startsWith('NPC')) {
        obj = game.includedNPCs.find((el) => el.id == obj);
        if (!obj && game.excludedNPCs.find((el) => el.id == obj)) {
          response.push(`${obj.name} is already excluded.`);
          return `${response.join('\n')}\n`;
        }
      } else {
        obj = self.client.users.resolve(obj);
      }
      if (!obj) {
        response.push(`${obj} is not a valid id.`);
        return `${response.join('\n')}\n`;
      }
    } else if (obj.id.startsWith('NPC') && !(obj instanceof NPC)) {
      const objId = obj.id;
      obj = game.includedNPCs.find((el) => el.id == obj.id);
      if (!obj) {
        response.push(`${objId} unable to be found (already excluded?).`);
        self.error(`Unable to find NPC matching NPC-like data: ${game.id}`);
        return `${response.join('\n')}\n`;
      }
    }
    if ((!large && game.excludedUsers.includes(obj.id)) ||
        (large && !game.includedUsers.includes(obj.id))) {
      if (!onlyError) {
        response.push(`${obj.username} is already excluded.`);
      }
    } else {
      if (obj.isNPC) {
        game.excludedNPCs.push(obj);
        if (!onlyError) {
          response.push(`${obj.username} added to blacklist.*`);
        }
        const includeIndex =
            game.includedNPCs.findIndex((el) => el.id == obj.id);
        if (includeIndex >= 0) {
          /* if (!onlyError) {
            response += obj.username + ' removed from whitelist.\n';
          } */
          game.includedNPCs.splice(includeIndex, 1);
        }
      } else {
        if (!large) game.excludedUsers.push(obj.id);
        if (!onlyError) {
          response.push(`${obj.username} added to blacklist.`);
        }
        if (!game.includedUsers) game.includedUsers = [];
        const includeIndex = game.includedUsers.indexOf(obj.id);
        if (includeIndex >= 0) {
          /* if (!onlyError) {
            response += obj.username + ' removed from whitelist.\n';
          } */
          game.includedUsers.splice(includeIndex, 1);
        }
      }
      if (!game.currentGame.inProgress) {
        const index =
            game.currentGame.includedUsers.findIndex((el) => el.id == obj.id);
        if (index >= 0) {
          game.currentGame.includedUsers.splice(index, 1);
          /* if (!onlyError) {
            response += obj.username + ' removed from included players.\n';
          } */
          game.formTeams(game.id);
        } else if (!game.options.includeBots && obj.bot) {
          // Bots are already excluded.
        } else {
          response.push(
              `Failed to remove ${obj.username} for an unknown reason.`);
          self.error(`Failed to remove player from included list. (${obj.id})`);
        }
      }
    }
    return `${response.join('\n')}\n`;
  }

  /**
   * Add a user back into the next game.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] The game object to modify.
   */
  function includeUser(msg, id, game) {
    if (!game) game = hg.getGame(id);
    if (!game || !game.currentGame) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        includeUser(msg, id, game);
      });
      return;
    }
    let firstWord = msg.text.trim().split(' ')[0];
    if (firstWord) firstWord = firstWord.toLowerCase();
    const specialWords = {
      everyone: ['everyone', '@everyone', 'all'],
      online: ['online', 'here', '@here'],
      offline: ['offline'],
      idle: ['idle', 'away', 'snooze', 'snoozed'],
      dnd: ['dnd', 'busy'],
      bots: ['bot', 'bots'],
      npcs: ['npc', 'npcs', 'ai', 'ais'],
    };
    let resPrefix = '';
    let resPostfix = ' have been added to the games.';
    const done = function(response) {
      self.common.reply(msg, resPrefix + resPostfix, response.substr(0, 2048));
    };
    if (game.currentGame.inProgress) {
      resPostfix = ' will be added into the next game.';
    }
    if (specialWords.everyone.includes(firstWord)) {
      resPrefix = 'All users';
      self.includeUsers('everyone', id, done);
    } else if (specialWords.online.includes(firstWord)) {
      resPrefix = 'All online users';
      self.includeUsers('online', id, done);
    } else if (specialWords.offline.includes(firstWord)) {
      resPrefix = 'All offline users';
      self.includeUsers('offline', id, done);
    } else if (specialWords.idle.includes(firstWord)) {
      resPrefix = 'All idle users';
      self.includeUsers('idle', id, done);
    } else if (specialWords.dnd.includes(firstWord)) {
      resPrefix = 'All DND users';
      self.includeUsers('dnd', id, done);
    } else if (specialWords.npcs.includes(firstWord)) {
      resPrefix = 'All NCPs';
      self.includeUsers(game.excludedNPCs.slice(0), id, done);
    } else if (specialWords.bots.includes(firstWord)) {
      resPrefix = 'Bots';
      resPostfix = ' can now be added to the games.';
      done(self.setOption(id, 'includeBots', true));
    } else if (
      msg.mentions.users.size + msg.softMentions.users.size +
            msg.mentions.roles.size + msg.softMentions.roles.size ==
        0) {
      self.common.reply(
          msg,
          'You must specify who you wish for me to include in the next game.');
    } else {
      self.includeUsers(parseMentions(msg), id, (response) => {
        self.common.reply(msg, response);
      });
    }
  }

  /**
   * Adds a user back into the next game.
   *
   * @fires HG#refresh
   * @public
   * @param {string|string[]|Discord~User[]|HungryGames~NPC[]} users The users
   * to include, 'everyone' to include all users, 'online' to include online
   * users, 'offline', 'idle', or 'dnd' for respective users.
   * @param {string} id The guild id to add the users to.
   * @param {Function} cb Callback for when long running operations complete.
   * Single argument with a string with the outcomes of each user. May have
   * multiple lines for a single user.
   */
  this.includeUsers = function(users, id, cb) {
    const game = hg.getGame(id);
    if (!game) {
      cb('No game');
      return;
    }
    if (game.loading) {
      cb('A previous command is still loading.\n' +
         'Please wait for it to complete.');
      return;
    }
    if (!game.excludedNPCs) game.excludedNPCs = [];
    if (!game.includedNPCs) game.includedNPCs = [];
    const iTime = Date.now();
    const tmp = [];
    let npcs = [];
    const large = self.client.guilds.resolve(id).memberCount >=
        HungryGames.largeServerCount;
    if (large && typeof users === 'string') {
      cb('Too many members');
      return;
    }
    switch (users) {
      case 'everyone':
        users = game.excludedUsers;
        npcs = game.excludedNPCs;
        break;
      case 'online':
      case 'offline':
      case 'idle':
      case 'dnd':
        game.excludedUsers.forEach((u) => {
          const user = self.client.users.resolve(u);
          if (user && user.presence.status === users) tmp.push(user);
        });
        users = tmp;
        break;
      default:
        if (typeof users === 'string') {
          cb('Invalid users');
          return;
        }
        break;
    }
    if (!Array.isArray(users)) {
      users = users.array();
    }
    const num = users.length + npcs.length;
    const numUsers = users.length;
    if (num > 10000) {
      self.warn(`Including ${num} users.`);
    }
    const iTime2 = Date.now();
    const onlyError = num > 2;
    const response = [];
    let fetchWait = 0;
    const chunk = function(i = -1) {
      if (i < 0) i = num - 1;
      // Touch the game so it doesn't get purged from memory.
      const game = hg.getGame(id);
      game.loading = true;

      const start = Date.now();
      for (i; i >= 0 && Date.now() - start < hg.maxDelta; i--) {
        if (i < numUsers) {
          if (typeof users[i] === 'string' && !users[i].startsWith('NPC') &&
              !self.client.users.resolve(users[i])) {
            fetchWait++;
            self.client.users.fetch(users[i]).then(fetched).catch((err) => {
              response.push(err.message);
              fetched();
            });
          } else {
            response.push(includeIterate(game, users[i], onlyError));
          }
        } else {
          response.push(includeIterate(game, npcs[i - numUsers], onlyError));
        }
      }
      if (i >= 0) {
        setTimeout(() => {
          chunk(i);
        });
      } else if (fetchWait === 0) {
        done();
      }
    };
    const done = function() {
      game.loading = false;
      const now = Date.now();
      const begin = iTime2 - iTime;
      const loop = now - iTime2;
      if (begin > 10 || loop > 10) {
        self.debug(`Including ${num} ${begin} ${loop}`);
      }
      const finalRes = (response.length > 0 &&
                        response.filter((el) => el !== '\n').join('').trim()) ||
          `Succeeded without errors (${num} included)`;
      cb(finalRes);
      self._fire('refresh', id);
    };

    const fetched = function(user) {
      fetchWait--;
      if (user) response.push(includeIterate(game, user, onlyError));
      if (fetchWait === 0) done();
    };

    setTimeout(chunk);
  };

  /**
   * @description Include a single user from the game as a single iteration step
   * of the include command.
   * @private
   * @param {HungryGames~GuildGame} game The game to manipulate.
   * @param {string|HungryGames~Player|HungryGames~NPC} obj Player for this
   * iteration.
   * @param {boolean} [onlyError=false] Only add error messages to response.
   * @returns {string} Response text for the user performing the operation.
   */
  function includeIterate(game, obj, onlyError = false) {
    if (!obj || obj === 'undefined') return '';
    const response = [];
    if (typeof obj === 'string') {
      if (obj.startsWith('NPC')) {
        obj = game.excludedNPCs.find((el) => el.id == obj);
        if (!obj && game.includedNPCs.find((el) => el.id == obj)) {
          response.push(`${obj.username} is already included.`);
          return `${response.join('\n')}\n`;
        }
      } else {
        obj = self.client.users.resolve(obj);
      }
      if (!obj) {
        response.push(`${obj} is not a valid id.`);
        return `${response.join('\n')}\n`;
      }
    } else if (obj.id.startsWith('NPC') && !(obj instanceof NPC)) {
      const objId = obj.id;
      obj = game.excludedNPCs.find((el) => el.id == obj.id);
      if (!obj) {
        response.push(`${objId} unable to be found (already included?).`);
        self.error(`Unable to find NPC matching NPC-like data: ${game.id}`);
        return `${response.join('\n')}\n`;
      }
    }
    if (!game.options.includeBots && obj.bot) {
      response.push(`${obj.username} is a bot, but bots are disabled.`);
      return `${response.join('\n')}\n`;
    }
    if (obj.isNPC) {
      const excludeIndex = game.excludedNPCs.findIndex((el) => el.id == obj.id);
      if (excludeIndex >= 0) {
        /* if (!onlyError) {
          response += obj.username + ' removed from blacklist.\n';
        } */
        game.excludedNPCs.splice(excludeIndex, 1);
      }
      if (!game.includedNPCs.find((el) => el.id == obj.id)) {
        game.includedNPCs.push(obj);
        if (!onlyError) {
          response.push(`${obj.username} added to whitelist.*`);
        }
      }
    } else {
      const excludeIndex = game.excludedUsers.indexOf(obj.id);
      if (excludeIndex >= 0) {
        /* if (!onlyError) {
          response += obj.username + ' removed from blacklist.\n';
        } */
        game.excludedUsers.splice(excludeIndex, 1);
      }
      if (!game.includedUsers.includes(obj.id)) {
        game.includedUsers.push(obj.id);
        if (!onlyError) {
          response.push(`${obj.username} added to whitelist.`);
        }
      }
    }
    if (game.currentGame.inProgress) {
      if (!onlyError) {
        response.push(`${obj.username} skipped.`);
      }
    } else if (!game.currentGame.includedUsers.find((u) => u.id === obj.id)) {
      if (obj.isNPC) {
        game.currentGame.includedUsers.push(
            new NPC(obj.name, obj.avatarURL, obj.id));
      } else {
        game.currentGame.includedUsers.push(
            new HungryGames.Player(
                obj.id, obj.username, (obj.displayAvatarURL &&
                                       obj.displayAvatarURL({format: 'png'})) ||
                    obj.avatarURL,
                obj.nickname));
      }
      /* if (!onlyError) {
        response += obj.username + ' added to included players.\n';
      } */
      game.formTeams();
    } else {
      if (!onlyError) {
        response.push(`${obj.username} is already included.`);
      }
    }
    return `${response.join('\n')}\n`;
  }

  /**
   * Show a formatted message of all users and teams in current server.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function listPlayers(msg, id) {
    const game = hg.getGame(id);
    if (!game) {
      self.common.reply(msg, 'A game has not been created yet.');
      return;
    }
    const finalMessage = makePlayerListEmbed(game);
    finalMessage.setDescription(
        `To refresh: ${msg.prefix}${self.postPrefix}create`);
    msg.channel.send(self.common.mention(msg), finalMessage).catch((err) => {
      self.common.reply(
          msg, 'Oops, Discord rejected my message for some reason...');
      self.error('Failed to send list of players message: ' + msg.channel.id);
      console.error(err);
    });
  }

  /**
   * @description Create a {@link external:Discord~MessageEmbed} that lists all
   * included and excluded players in the game.
   * @private
   * @param {HungryGames~GuildGame} game The game to format.
   * @param {external:Discord~MessageEmbed} [finalMessage] Optional existing
   * embed to modify instead of creating a new one.
   * @returns {external:Discord~MessageEmbed} The created message embed.
   */
  function makePlayerListEmbed(game, finalMessage) {
    if (!finalMessage) {
      finalMessage = new self.Discord.MessageEmbed();
      finalMessage.setTitle('List of players');
      finalMessage.setColor(defaultColor);
    }
    if (!game || !game.currentGame || !game.currentGame.includedUsers) {
      finalMessage.addField(
          'No Players', 'No game created or no players in the game.');
      return finalMessage;
    }
    const numUsers = game.currentGame.includedUsers.length;
    if (numUsers > 200) {
      finalMessage.addField(
          `Included (${numUsers})`, `Excluded (${game.excludedUsers.length})`,
          true);
      return finalMessage;
    }
    if (game.options.teamSize > 0) self.sortTeams(game);
    const splitEmbeds =
        game.currentGame.teams.length < 25 && game.options.teamSize > 0;
    let prevTeam = null;
    const statusList = game.currentGame.includedUsers.map((obj) => {
      let myTeam = null;
      if (game.options.teamSize > 0) {
        myTeam = game.currentGame.teams.find(
            (team) => team.players.find((player) => player == obj.id));
        /* if (!myTeam) {
          self.error(
              'Failed to find team for player: ' + obj.id + ' in ' + game.id);
          console.error(game.currentGame.teams);
        } */
      }

      let shortName;
      if (obj.nickname && game.options.useNicknames) {
        shortName = obj.nickname.substring(0, 16);
        if (shortName != obj.nickname) {
          shortName = `${shortName.substring(0, 13)}...`;
        }
      } else {
        shortName = obj.name.substring(0, 16);
        if (shortName != obj.name) {
          shortName = `${shortName.substring(0, 13)}...`;
        }
      }
      if (splitEmbeds) return shortName;

      let prefix = '';
      if (myTeam && myTeam !== prevTeam) {
        prevTeam = myTeam;
        prefix = `__${myTeam.name}__\n`;
      }

      return `${prefix}\`${shortName}\``;
    });
    if (game.options.teamSize == 0) {
      statusList.sort((a, b) => {
        a = a.toLocaleLowerCase();
        b = b.toLocaleLowerCase();
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });
    }

    if (splitEmbeds) {
      game.currentGame.teams.reverse().forEach((el) => {
        finalMessage.addField(
            el.name || el.id,
            statusList.splice(0, el.players.length).join('\n').slice(0, 1023),
            true);
      });
    } else {
      const numCols =
          self.calcColNum(statusList.length > 10 ? 3 : 2, statusList);
      if (statusList.length >= 5) {
        const quarterLength = Math.ceil(statusList.length / numCols);
        for (let i = 0; i < numCols - 1; i++) {
          const thisMessage =
              statusList.splice(0, quarterLength).join('\n').substring(0, 1024);
          finalMessage.addField(
              'Included (' + (i * quarterLength + 1) + '-' +
                  ((i + 1) * quarterLength) + ')',
              thisMessage, true);
        }
        finalMessage.addField(
            `Included (${(numCols - 1) * quarterLength + 1}-${numUsers})`,
            statusList.join('\n'), true);
      } else {
        finalMessage.addField(
            `Included (${numUsers})`, statusList.join('\n') || 'Nobody', false);
      }
    }
    if (game.excludedUsers.length > 0) {
      let excludedList = '\u200B';
      if (game.excludedUsers.length < 20) {
        const guild = self.client.guilds.resolve(game.id);
        excludedList =
            game.excludedUsers.map((obj) => getName(guild, obj)).join(', ');
        const trimmedList = excludedList.substr(0, 512);
        if (excludedList != trimmedList) {
          excludedList = `${trimmedList.substr(0, 509)}...`;
        } else {
          excludedList = trimmedList;
        }
      }
      finalMessage.addField(
          `Excluded (${game.excludedUsers.length})`, excludedList, false);
    }
    return finalMessage;
  }

  /**
   * Get the username of a user id if available, or their id if they couldn't be
   * found.
   *
   * @private
   * @param {Discord~Guild} guild The guild to look for the user in.
   * @param {string} user The id of the user to find the name of.
   * @returns {string} The user's name or id if name was unable to be found.
   */
  function getName(guild, user) {
    let name = '';
    if (typeof user === 'object' && user.username) {
      name = user.username;
    } else if (guild.members.resolve(user)) {
      name = guild.members.resolve(user).user.username;
    } else {
      name = user;
    }
    return name;
  }

  /**
   * Change an option to a value that the user specifies.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function toggleOpt(msg, id) {
    msg.text = msg.text.trim();
    const option = msg.text.split(' ')[0];
    const value = msg.text.split(' ')[1];
    const output = self.setOption(id, option, value, msg.text);
    if (!output) {
      if (!hg.getGame(id).options) {
        self.common.reply(
            msg, 'No options have been set.', 'Please create a game first. `' +
                msg.prefix + self.postPrefix + 'create`');
      } else {
        showOpts(msg, hg.getGame(id).options);
      }
    } else {
      self.common.reply(msg, output);
    }
  }
  /**
   * Change an option to a value for the given guild.
   *
   * @public
   * @param {string} id The guild id to change the option in.
   * @param {?string} option The option key to change.
   * @param {?string|boolean|number} value The value to change the option to.
   * @param {string} [text=''] The original message sent without the command
   * prefix in the case we are changing the value of an object and require all
   * user inputted data.
   * @returns {string} A message saying what happened, or null if we should show
   * the user the list of options instead.
   */
  this.setOption = function(id, option, value, text = '') {
    if (!hg.getGame(id) || !hg.getGame(id).currentGame) {
      return 'A game has not been created yet.';
    }
    if (typeof option === 'undefined' || option.length == 0) {
      return null;
    } else if (
      option[0] === '_' || typeof defaultOptions[option] === 'undefined') {
      const searchedOption = defaultOptSearcher.search(option);
      if (typeof defaultOptions[searchedOption] === 'undefined') {
        return 'That is not a valid option to change! (' + option + ')\nUse `' +
            self.bot.getPrefix(id) + self.postPrefix +
            'options` to see all changeable options.';
      }
      option = searchedOption;
    }
    return changeObjectValue(
        hg.getGame(id).options, defaultOptions, option, value, text.split(' '),
        id);
  };

  /**
   * Recurse through an object to change a certain child value based off a given
   * array of words.
   *
   * @fires HG#toggleOption
   * @private
   * @param {HungryGames~GuildGame.options} obj The object with the values to
   * change.
   * @param {HungryGames~defaultOptions} defaultObj The default template object
   * to base changes off of.
   * @param {string} option The first value to check.
   * @param {number|boolean|string} value The value to change to, or the next
   * option key to check if we have not found an end to a branch yet.
   * @param {Array.<string|boolean|number>} values All keys leading to the final
   * value, as well as the final value.
   * @param {string} id The id of the guild this was triggered for.
   * @param {{min: number, max: number}} [range] Allowable range for values that
   * are numbers.
   * @param {string[]} [keys=[]] List of previous option keys.
   * @returns {string} Message saying what happened. Can be an error message.
   */
  function changeObjectValue(
      obj, defaultObj, option, value, values, id, range, keys) {
    if (!keys || !Array.isArray(keys)) keys = [];
    keys.push(option);
    let type = typeof defaultObj[option];
    if (type !== 'undefined' &&
        typeof defaultObj[option].value !== 'undefined') {
      type = typeof defaultObj[option].value;
      range = range || defaultObj[option].range;
    }
    if (hg.getGame(id).currentGame && hg.getGame(id).currentGame.inProgress) {
      if (option == 'teamSize' || option == 'includeBots') {
        return 'Teams and included players cannot be modified during a game.' +
            '\nYou must end the current game first to do this.';
      }
    }
    if (type === 'number') {
      value = Number(value);
      if (typeof value !== 'number' || isNaN(value)) {
        return 'That is not a valid value for ' + option +
            ', which requires a number. (Currently ' + obj[option] + ')';
      } else {
        if (range) {
          if (value < range.min) value = range.min;
          if (value > range.max) value = range.max;
        }
        /* if ((option == 'delayDays' || option == 'delayEvents') && value <
        500) {
          value = 1000;
        } */

        const old = obj[option];
        obj[option] = value;
        self._fire('toggleOption', id, ...keys, value);
        if (option == 'teamSize' && value != 0) {
          return 'Set ' + option + ' to ' + obj[option] + ' from ' + old +
              '\nTo reset teams to the correct size, type "' +
              self.bot.getPrefix() + self.postPrefix +
              'teams reset".\nThis will delete all teams, and create ' +
              'new ones.';
        } else {
          return 'Set ' + option + ' to ' + obj[option] + ' from ' + old;
        }
      }
    } else if (type === 'boolean') {
      if (typeof value === 'string') value = value.toLowerCase();
      if (value === 'true' || value === 'false') value = value === 'true';
      if (typeof value !== 'boolean') {
        return 'That is not a valid value for ' + option +
            ', which requires true or false. (Currently ' + obj[option] + ')';
      } else {
        if (option == 'excludeNewUsers' &&
            self.client.guilds.resolve(id).memberCount >=
                HungryGames.largeServerCount) {
          obj[option] = true;
          return 'Due to performance issues, large servers must exclude new ' +
              'users by default.';
        }
        const old = obj[option];
        obj[option] = value;
        if (option == 'includeBots') {
          createGame(null, id, true);
        }
        self._fire('toggleOption', id, ...keys, value);
        return `Set ${option} to ${obj[option]} from ${old}`;
      }
    } else if (type === 'string') {
      value = (value || '').toLowerCase();
      if (defaultObj[option].values.lastIndexOf(value) < 0) {
        return 'That is not a valid value for ' + option +
            ', which requires one of the following: ' +
            JSON.stringify(defaultObj[option].values) + '. (Currently ' +
            obj[option] + ')';
      } else {
        const old = obj[option];
        obj[option] = value;
        self._fire('toggleOption', id, ...keys, value);
        return 'Set ' + option + ' to ' + obj[option] + ' from ' + old;
      }
    } else if (type === 'object') {
      if (typeof defaultObj[option].value[value] === 'undefined') {
        return '`' + value + '` is not a valid option to change!' +
            JSON.stringify(obj[option], null, 1);
      } else {
        return changeObjectValue(
            obj[option], defaultObj[option].value || defaultObj[option],
            values[1], values[2], values.slice(3), id, range, keys);
      }
    } else {
      return 'Changing the value of this option does not work yet. (' + option +
          ': ' + type + ')\n' + JSON.stringify(defaultObj) + '(' + value + ')' +
          JSON.stringify(values);
    }
  }

  /**
   * Format the options for the games and show them to the user.
   *
   * @private
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {object} options The options to format.
   */
  function showOpts(msg, options) {
    const entries = Object.entries(options);

    const bodyList = entries.map(function(obj) {
      const key = obj[0];
      const val = obj[1];

      return key + ': ' + JSON.stringify(val) + ' (default: ' +
          JSON.stringify(defaultOptions[key].value) + ')\n' +
          '/* ' + defaultOptions[key].comment + ' */';
    });

    let totalLength = 0;
    const bodyFields = [[]];
    let fieldIndex = 0;
    for (let i = 0; i < bodyList.length; i++) {
      if (bodyList[i].length + totalLength > 1500) {
        fieldIndex++;
        totalLength = 0;
        bodyFields.push([]);
      }
      totalLength += bodyList[i].length;
      bodyFields[fieldIndex].push(bodyList[i]);
    }

    let page = 0;
    if (msg.optId) page = msg.optId;
    if (page < 0) page = 0;
    if (page >= bodyFields.length) page = bodyFields.length - 1;

    const embed = new self.Discord.MessageEmbed();
    embed.setTitle('Current Options');
    embed.setFooter('Page ' + (page + 1) + ' of ' + (bodyFields.length));
    embed.setDescription('```js\n' + bodyFields[page].join('\n\n') + '```');
    embed.addField(
        'Simple Example',
        msg.prefix + self.postPrefix + 'options includeBots true', true);
    embed.addField(
        'Change Object Example',
        msg.prefix + self.postPrefix + 'options playerOutcomeProbs kill 23',
        true);

    if (optionMessages[msg.id]) {
      msg.edit(embed).then(() => {
        optChangeListener(msg, options, page);
      });
    } else {
      msg.channel.send(embed).then((msg_) => {
        msg_.origAuth = msg.author.id;
        msg_.prefix = self.bot.getPrefix(msg.guild);
        optChangeListener(msg_, options, page);
      });
    }
  }

  /**
   * The callback for when the user chooses to change page of the options.
   *
   * @private
   * @param {Discord~Message} msg_ The message we sent showing the options.
   * @param {object} options The options to show in the message.
   * @param {number} index The page index to show.
   */
  function optChangeListener(msg_, options, index) {
    msg_.optId = index;
    optionMessages[msg_.id] = msg_;
    msg_.react(emoji.arrowLeft).then(() => {
      msg_.react(emoji.arrowRight);
    });
    newReact(maxReactAwaitTime);
    msg_.awaitReactions(function(reaction, user) {
      if (user.id != self.client.user.id) {
        reaction.users.remove(user).catch(() => {});
      }
      return (reaction.emoji.name == emoji.arrowRight ||
                  reaction.emoji.name == emoji.arrowLeft) &&
              user.id != self.client.user.id;
    }, {max: 1, time: maxReactAwaitTime}).then(function(reactions) {
      if (reactions.size == 0) {
        msg_.reactions.removeAll().catch(() => {});
        delete optionMessages[msg_.id];
        return;
      }
      const name = reactions.first().emoji.name;
      if (name == emoji.arrowRight) {
        msg_.optId++;
      } else if (name == emoji.arrowLeft) {
        msg_.optId--;
      }
      showOpts(msg_, options);
    });
  }

  // Team Management //
  /**
   * Entry for all team commands.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {boolean} [silent=false] Should we disable replying to the given
   * message?
   * @returns {?string} Error message or null if no error.
   */
  function editTeam(msg, id, silent) {
    const split = msg.text.trim().split(' ');
    if (!hg.getGame(id) || !hg.getGame(id).currentGame) {
      const message = 'There isn\'t currently any game to edit.' +
          ' Please create one first.';
      if (!silent) {
        msg.channel.send(self.common.mention(msg) + ' `' + message + '`');
      }
      return message;
    }
    if (hg.getGame(id).currentGame.inProgress) {
      switch (split[0]) {
        case 'rename':
          break;
        default: {
          const message = 'You must end the current game before editing teams.';
          if (!silent) {
            msg.channel.send(self.common.mention(msg) + ' `' + message + '`');
          }
          return message;
        }
      }
    }
    if (hg.getGame(id).options.teamSize == 0) {
      const message =
          'There are no teams to edit. If you wish to have teams, you can ' +
          'set teamSize to the size of teams you wish to have.';
      if (!silent) {
        self.common.reply(
            msg, message, msg.prefix + self.postPrefix + 'opt teamSize 2');
      }
      return message;
    }
    switch (split[0]) {
      case 'swap':
        swapTeamUsers(msg, id);
        break;
      case 'move':
        moveTeamUser(msg, id);
        break;
      case 'rename':
        renameTeam(msg, id, silent);
        break;
      case 'reset':
        if (!silent) self.common.reply(msg, 'Resetting ALL teams!');
        hg.getGame(id).currentGame.teams = [];
        hg.getGame(id).formTeams(id);
        break;
      case 'randomize':
      case 'shuffle':
        randomizeTeams(msg, id, silent);
        break;
      default:
        listPlayers(msg, id);
        break;
    }
  }
  /**
   * @description Allows editing teams. Entry for all team actions.
   *
   * @public
   * @param {string} uId The id of the user is running the action.
   * @param {string} gId The id of the guild to run this in.
   * @param {string} cmd The command to run on the teams.
   * @param {string} one The id of the user to swap, or the new name of the team
   * if we're renaming a team.
   * @param {string} two The id of the user to swap, or the team id if we're
   * moving a player to a team.
   * @returns {?string} Error message or null if no error.
   */
  this.editTeam = function(uId, gId, cmd, one, two) {
    if (!hg.getGame(gId) || !hg.getGame(gId).currentGame) {
      return 'No game has been created yet.';
    }
    if (hg.getGame(gId).currentGame.inProgress) {
      switch (cmd) {
        case 'swap':
        case 'move':
          return;
      }
    }
    switch (cmd) {
      case 'swap': {
        let p1 = -1;
        const team1 = hg.getGame(gId).currentGame.teams.find((t) => {
          return t.players.find((p, i) => {
            if (p == one) {
              p1 = i;
              return true;
            }
            return false;
          });
        });
        let p2 = -1;
        const team2 = hg.getGame(gId).currentGame.teams.find((t) => {
          return t.players.find((p, i) => {
            if (p == two) {
              p2 = i;
              return true;
            }
            return false;
          });
        });
        if (!team1 || !team2) break;
        const tmp = team1.players.splice(p1, 1)[0];
        team1.players.push(team2.players.splice(p2, 1)[0]);
        team2.players.push(tmp);
        break;
      }
      case 'move': {
        let pId = -1;
        let tId = -1;
        const teamS = hg.getGame(gId).currentGame.teams.find((t, i) => {
          if (t.players.find((p, j) => {
            if (p == one) {
              pId = j;
              return true;
            }
            return false;
          })) {
            tId = i;
            return true;
          }
          return false;
        });
        let teamD = hg.getGame(gId).currentGame.teams.find((t) => {
          return t.id == two;
        });
        if (!teamS) break;
        if (!teamD) {
          const current = hg.getGame(gId).currentGame;
          teamD =
              current.teams[current.teams.push(
                  new HungryGames.Team(
                      current.teams.length,
                      'Team ' + (current.teams.length + 1), [])) -
                            1];
        }
        teamD.players.push(teamS.players.splice(pId, 1)[0]);
        if (teamS.players.length === 0) {
          hg.getGame(gId).currentGame.teams.splice(tId, 1);
        }
        break;
      }
      default:
        return editTeam(
            makeMessage(
                uId, gId, null, cmd + ' ' + (one || '') + ' ' + (two || '')),
            gId, true);
    }
  };
  /**
   * Swap two users from one team to the other.
   *
   * @private
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] The game object to modify.
   */
  function swapTeamUsers(msg, id, game) {
    const mentions = msg.mentions.users.concat(msg.softMentions.users);
    if (mentions.size != 2) {
      self.common.reply(
          msg, 'Swapping requires mentioning 2 users to swap teams with ' +
              'eachother.');
      return;
    }
    if (!game) game = hg.getGame(id);
    if (!game || !game.currentGame) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        swapTeamUsers(msg, id, game);
      });
      return;
    }
    const user1 = mentions.first().id;
    const user2 = mentions.first(2)[1].id;
    let teamId1 = 0;
    let playerId1 = 0;
    let teamId2 = 0;
    let playerId2 = 0;
    teamId1 = game.currentGame.teams.findIndex(function(team) {
      const index = team.players.findIndex(function(player) {
        return player == user1;
      });
      if (index > -1) playerId1 = index;
      return index > -1;
    });
    teamId2 = game.currentGame.teams.findIndex(function(team) {
      const index = team.players.findIndex(function(player) {
        return player == user2;
      });
      if (index > -1) playerId2 = index;
      return index > -1;
    });
    if (teamId1 < 0 || teamId2 < 0) {
      self.common.reply(msg, 'Please ensure both users are on a team.');
      return;
    }
    const intVal = game.currentGame.teams[teamId1].players[playerId1];
    game.currentGame.teams[teamId1].players[playerId1] =
        game.currentGame.teams[teamId2].players[playerId2];

    game.currentGame.teams[teamId2].players[playerId2] = intVal;

    self.common.reply(msg, 'Swapped players!');
  }
  /**
   * Move a single user to another team.
   *
   * @private
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] The game object to modify.
   */
  function moveTeamUser(msg, id, game) {
    const mentions = msg.mentions.users.concat(msg.softMentions.users);
    if (mentions.size < 1) {
      self.common.reply(msg, 'You must at least mention one user to move.');
      return;
    }
    if (!game) game = hg.getGame(id);
    if (!game || !game.currentGame) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        moveTeamUser(msg, id, game);
      });
      return;
    }
    let user1 = mentions.first().id;
    let teamId1 = 0;
    let playerId1 = 0;

    let user2 = 0;
    if (mentions.size >= 2) {
      user2 = mentions.first(2)[1].id;

      if (msg.text.indexOf(user2) < msg.text.indexOf(user1)) {
        const intVal = user1;
        user1 = user2;
        user2 = intVal;
      }
    }

    let teamId2 = 0;
    teamId1 = game.currentGame.teams.findIndex((team) => {
      const index = team.players.findIndex((player) => {
        return player == user1;
      });
      if (index > -1) playerId1 = index;
      return index > -1;
    });
    if (user2 > 0) {
      teamId2 = game.currentGame.teams.findIndex((team) => {
        return team.players.findIndex((player) => {
          return player == user2;
        }) > -1;
      });
    } else {
      teamId2 = msg.text.trim().split(' ')[1] - 1;
      teamId2 = game.currentGame.teams.findIndex((team) => team.id == teamId2);
    }
    if (teamId1 < 0 || teamId2 < 0 || isNaN(teamId2)) {
      let extra = null;
      if (user2 > 0 && teamId2 < 0) {
        extra =
            'Is ' + self.client.users.resolve(user2).username + ' on a team?';
      } else if (user1 > 0 && teamId1 < 0) {
        extra =
            'Is ' + self.client.users.resolve(user1).username + ' on a team?';
      }
      self.common.reply(
          msg, 'Please ensure the first option is the user, and the second ' +
              'is the destination (either a mention or a team id).',
          extra);
      return;
    }
    if (teamId2 >= game.currentGame.teams.length) {
      game.currentGame.teams.push(
          new HungryGames.Team(
              game.currentGame.teams.length,
              'Team ' + (game.currentGame.teams.length + 1), []));
      teamId2 = game.currentGame.teams.length - 1;
    }
    const user1Final = self.client.users.resolve(user1);
    self.common.reply(
        msg, 'Moving `' + (user1Final && user1Final.username || user1) +
            '` from ' + game.currentGame.teams[teamId1].name + ' to ' +
            game.currentGame.teams[teamId2].name);

    game.currentGame.teams[teamId2].players.push(
        game.currentGame.teams[teamId1].players.splice(playerId1, 1)[0]);

    if (game.currentGame.teams[teamId1].players.length == 0) {
      game.currentGame.teams.splice(teamId1, 1);
    }
  }
  /**
   * Rename a team.
   *
   * @private
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {boolean} [silent=false] Disable replying to message.
   */
  function renameTeam(msg, id, silent) {
    const split = msg.text.trim().split(' ').slice(1);
    let message = split.slice(1).join(' ');
    const search = Number(split[0]);
    const mentions = msg.mentions.users.concat(msg.softMentions.users);
    if (isNaN(search) && (mentions.size == 0)) {
      if (!silent) {
        self.common.reply(
            msg, 'Please specify a team id, or mention someone on a team, in ' +
                'order to rename their team.');
      }
      return;
    }
    let teamId = search - 1;
    if (!hg.getGame(id) || !hg.getGame(id).currentGame) {
      if (!silent) {
        self.common.reply(msg, 'A game has not been created yet.');
      }
      return;
    }
    if (isNaN(search)) {
      teamId = hg.getGame(id).currentGame.teams.findIndex(function(team) {
        return team.players.findIndex(function(player) {
          return player == mentions.first().id;
        }) > -1;
      });
    } else {
      teamId = hg.getGame(id).currentGame.teams.findIndex(
          (team) => team.id == teamId);
    }
    if (teamId < 0) {
      if (!silent) {
        self.common.reply(
            msg, 'Please specify a valid team id. (1 - ' +
                hg.getGame(id).currentGame.teams.length + ')');
      }
      return;
    }
    message = message.slice(0, 101);
    if (!silent) {
      self.common.reply(
          msg, 'Renaming "' + hg.getGame(id).currentGame.teams[teamId].name +
              '" to "' + message + '"');
    }
    hg.getGame(id).currentGame.teams[teamId].name = message;
  }

  /**
   * Swap random users between teams.
   *
   * @private
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {boolean} [silent=false] If true, this will not attempt to send
   * messages to the channel where the msg was sent..
   */
  function randomizeTeams(msg, id, silent) {
    if (!hg.getGame(id) || !hg.getGame(id).currentGame) {
      if (!silent) {
        self.common.reply(msg, 'A game has not been created yet.');
      }
      return;
    }
    if (hg.getGame(id).currentGame.inProgress) {
      if (!silent) {
        self.common.reply(msg, 'Please end the current game to modify teams.');
      }
      return;
    }
    const current = hg.getGame(id).currentGame;
    if (current.teams.length == 0) {
      if (!silent) self.common.reply(msg, 'There are no teams to randomize.');
      return;
    }
    for (let i = 0; i < current.includedUsers.length; i++) {
      const teamId1 = Math.floor(Math.random() * current.teams.length);
      const playerId1 =
          Math.floor(Math.random() * current.teams[teamId1].players.length);
      const teamId2 = Math.floor(Math.random() * current.teams.length);
      const playerId2 =
          Math.floor(Math.random() * current.teams[teamId2].players.length);

      const intVal = current.teams[teamId1].players[playerId1];
      current.teams[teamId1].players[playerId1] =
          current.teams[teamId2].players[playerId2];
      current.teams[teamId2].players[playerId2] = intVal;
    }
    if (!silent) self.common.reply(msg, 'Teams have been randomized!');
  }

  /**
   * Enable or disable an event without deleting it completely.
   *
   * @fires HG#eventToggled
   *
   * @public
   * @param {number|string} id The guild id that the event shall be toggled in.
   * @param {string} type The type of event. 'bloodbath', 'player', 'weapon', or
   * 'arena'.
   * @param {string} evtId The event ID of which to toggle in the category.
   * @param {boolean} [value] Set enabled to a value instead of toggling.
   * @returns {?string} Error message or null if no error.
   */
  this.toggleEvent = function(id, type, evtId, value) {
    if (!['bloodbath', 'arena', 'player', 'weapon'].includes(type)) {
      return 'Invalid Type';
    }
    if (!hg.getGame(id)) return 'Invalid ID or no game';

    const allDisabled = hg.getGame(id).disabledEventIds[type];
    const dIndex = allDisabled.findIndex((el) => el === evtId);
    if (typeof value !== 'boolean') value = dIndex > -1;

    if ((dIndex > -1) !== value) {
      return `Already ${value?'Enabled':'Disabled'}`;
    } else if (value) {
      allDisabled.splice(dIndex, 1);
      self._fire('eventToggled', id, type, evtId, value);
      return null;
    }

    allDisabled.push(evtId);
    self._fire('eventToggled', id, type, evtId, value);
    return null;
  };

  /**
   * Tell users to use the website to manage custom events.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function useWebsiteForCustom(msg, id) {
    self.common.reply(
        msg, 'This command is no longer available.',
        'Please use https://www.spikeybot.com/hg/#?guild=' + id +
            ' to manage custom events.');
  }

  /**
   * Update all legacy custom events to the newer ID based system.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function commandClaimLegacyEvents(msg, id) {
    const game = hg.getGame(id);
    if (!game || !game.legacyEvents) {
      self.common.reply(
          msg, 'No legacy events.',
          'Unable to find any legacy events, and thus there is no operation ' +
              'to perform.');
      return;
    }

    self.claimLegacy(game, msg.author.id, (err, res, stringified) => {
      if (err) {
        self.common.reply(msg, 'No Events Claimed', err);
      } else {
        self.common.reply(msg, 'Events claimed', res);
        const perms = msg.channel.permissionsFor(self.client.user);
        if (perms.has(self.Discord.Permissions.FLAGS.SEND_MESSAGES) &&
            perms.has(self.Discord.Permissions.FLAGS.ATTACH_FILES)) {
          msg.channel.send(
              'Backup of the saved legacy event data.',
              new self.Discord.MessageAttachment(
                  Buffer.from(stringified), 'HGLegacyEventBackup.json'));
        }
      }
    });
  }

  /**
   * @description Claim legacy events to the given owner's account.
   * @public
   * @param {HungryGames~GuildGame} game The game storing legacy events.
   * @param {string} owner The ID of ther user to attach the events to.
   * @param {Function} cb Callback once completed. First argument is optional
   * error string, second is otherwise success information string, third will
   * always be the stringified legacy events.
   */
  this.claimLegacy = function(game, owner, cb) {
    const custom = game.legacyEvents;

    if (!custom) {
      cb('No legacy events to claim.');
      return;
    }

    const dir = self.common.guildSaveDir + game.id;
    const stringified = JSON.stringify(custom, null, 2);
    let total = 0;
    let done = 0;
    let deleted = false;
    let errored = false;

    const checkDone = function() {
      done++;
      if (done < total) return;

      const additional =
          (deleted ?
               'Events that give weapons were reset.\n\nYou can edit events ' +
                   'on the website to give the weapons again.' :
               'No deleted weapon info.') +
          (errored ?
               '\nSome events failed to be converted due to unknown errors.' :
               '\nNo errors.');

      cb(null, additional, stringified);

      const filename = `${dir}/HGLegacyEventBackup.json`;
      self.common.mkAndWrite(filename, dir, stringified, (err) => {
        if (err) {
          self.error('Failed to save HG Legacy event backup file.');
          console.error(err);
          return;
        }
        if (!errored) delete game.legacyEvents;
      });
    };

    const iterate = function(type, type2) {
      return function(evt, i) {
        total++;
        if ((evt.victim && evt.victim.weapon) ||
            (evt.attacker && evt.attacker.weapon)) {
          deleted = true;
          delete evt.victim.weapon;
          delete evt.attacker.weapon;
        }
        if (evt.outcomes) {
          evt.outcomes.forEach((el) => {
            el.creator = owner;
            el.type = 'normal';
            if ((el.victim && el.victim.weapon) ||
                (el.attacker && el.attacker.weapon)) {
              deleted = true;
              delete el.victim.weapon;
              delete el.attacker.weapon;
            }
          });
        }
        evt.type = type2;
        evt.creator = owner;
        hg.createEvent(evt, (err, out) => {
          if (err) {
            self.error(
                'Failed to update legacy event: ' + type + ' ' + type2 + ' ' +
                i + ' ' + game.id);
            console.error(err);
            errored = true;
            checkDone();
            return;
          }
          game.customEventStore.fetch(out.id, type, (err) => {
            if (err) {
              self.error(
                  'Failed to fetch claimed event: ' + out.id + ' ' + type +
                  ' ' + type2 + ' ' + i + ' ' + game.id);
              console.error(err);
              errored = true;
              checkDone();
              return;
            }
            checkDone();
          });
        });
      };
    };

    custom.bloodbath.forEach(iterate('bloodbath', 'normal'));
    custom.player.forEach(iterate('player', 'normal'));
    custom.arena.forEach(iterate('arena', 'arena'));

    const wepIterate = iterate('weapon', 'weapon');
    Object.entries(custom.weapon).forEach((el, i) => {
      const evt = Object.assign({}, el[1]);
      evt.name = el[0];
      wepIterate(evt, i);
    });

    if (total === 0) {
      cb('No legacy events found to update.');
    }
  };

  /**
   * List all currently created NPCs.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function listNPCs(msg, id) {
    let specific =
        msg.softMentions.users.find((el) => el.id.startsWith('NPC'));
    /**
     * Function to pass into Array.map to format NPCs into strings for this
     * list.
     *
     * @private
     * @param {NPC} obj NPC object to format as a string.
     * @returns {string} Name as a string.
     */
    function mapFunc(obj) {
      let shortName;
      shortName = obj.name.substring(0, 16);
      if (shortName != obj.name) {
        shortName = shortName.substring(0, 13) + '...';
      }
      return '`' + shortName + '`';
    }

    if (!hg.getGame(id)) {
      self.common.reply(msg, 'A game has not been created yet.');
      return;
    }

    const iNPCs = hg.getGame(id).includedNPCs || [];
    const eNPCs = hg.getGame(id).excludedNPCs || [];
    if (specific) {
      specific = iNPCs.concat(eNPCs).find((el) => el.id == specific.id);
      const embed = new self.Discord.MessageEmbed();
      embed.setTitle('NPC Info');
      embed.setDescription(specific.name);
      embed.setFooter(specific.id);
      embed.setThumbnail(specific.avatarURL);
      msg.channel.send(self.common.mention(msg), embed).catch((err) => {
        self.error('Failed to send NPC info message: ' + msg.channel.id);
        console.error(err);
      });
    } else if (msg.text && !['show', 'list'].includes(msg.text.trim())) {
      self.common.reply(
          msg, 'I\'m not sure which NPC that is.', msg.text + '\nUse `' +
              msg.prefix + self.postPrefix +
              'npc list` to show all current NPCs.');
    } else {
      const finalMessage = new self.Discord.MessageEmbed();
      finalMessage.setTitle('List of NPCs');
      finalMessage.setColor(defaultColor);
      let iList = [];
      let eList = [];
      if (iNPCs.length > 0) iList = iNPCs.map(mapFunc).sort();
      if (eNPCs.length > 0) eList = eNPCs.map(mapFunc).sort();

      const numINPCs = iList.length;
      const numENPCs = eList.length;
      if (iList.length >= 5) {
        const numCols = self.calcColNum(iList.length > 10 ? 3 : 2, iList);

        const quarterLength = Math.ceil(iList.length / numCols);
        for (let i = 0; i < numCols - 1; i++) {
          const thisMessage =
              iList.splice(0, quarterLength).join('\n').substr(0, 1024);
          finalMessage.addField(
              'Included (' + (i * quarterLength + 1) + '-' +
                  ((i + 1) * quarterLength) + ')',
              thisMessage, true);
        }
        finalMessage.addField(
            'Included (' + ((numCols - 1) * quarterLength + 1) + '-' +
                numINPCs + ')',
            iList.join('\n').substr(0, 1024), true);
      } else {
        finalMessage.addField(
            'Included (' + numINPCs + ')', iList.join('\n') || 'None.', false);
      }
      if (eList.length >= 5) {
        const numCols = self.calcColNum(eList.length > 10 ? 3 : 2, eList);

        const quarterLength = Math.ceil(eList.length / numCols);
        for (let i = 0; i < numCols - 1; i++) {
          const thisMessage =
              eList.splice(0, quarterLength).join('\n').substr(0, 1024);
          finalMessage.addField(
              'Excluded (' + (i * quarterLength + 1) + '-' +
                  ((i + 1) * quarterLength) + ')',
              thisMessage, true);
        }
        finalMessage.addField(
            'Excluded (' + ((numCols - 1) * quarterLength + 1) + '-' +
                numENPCs + ')',
            eList.join('\n').substr(0, 1024), true);
      } else {
        finalMessage.addField(
            'Excluded (' + numENPCs + ')', eList.join('\n') || 'None.', false);
      }
      msg.channel.send(self.common.mention(msg), finalMessage).catch((err) => {
        self.common.reply(
            msg, 'Oops, Discord rejected my message for some reason...',
            'This is possibly because there are too many NPCs in the games ' +
                'to show in this list.');
        self.error('Failed to send list of NPCs message: ' + msg.channel.id);
        console.error(err);
      });
    }
  }

  /**
   * Create a new NPC.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function createNPC(msg, id) {
    let username;
    fetchAvatar();
    /**
     * @description Fetch the avatar the user has requested. Prioritizes
     * attachments, then URLs, otherwise returns.
     *
     * @private
     */
    function fetchAvatar() {
      let url;
      if (msg.attachments.size == 1) {
        const a = msg.attachments.first();
        url = a.proxyURL || a.url;
      } else if (msg.attachments.size == 0) {
        url = msg.text.match(urlRegex);
        if (url) url = url[0];
      }
      if (typeof url !== 'string' || url.length == 0) {
        self.common.reply(
            msg, 'Hmm, you didn\'t give me an image to use as an avatar.');
      } else {
        username = formatUsername(msg.text, url);
        if (username.length < 2) {
          self.common.reply(msg, 'Please specify a valid username.', username);
          return;
        }

        let request = https.request;
        if (url.startsWith('http://')) request = http.request;

        const opt = {headers: {'User-Agent': self.common.ua}};

        let req;
        try {
          req = request(url, opt, onIncoming);
        } catch (err) {
          self.warn('Failed to request npc avatar: ' + url);
          // console.error(err);
          self.common.reply(msg, err.message);
          return;
        }
        req.on('error', (err) => {
          self.error('Failed to fetch image: ' + url);
          console.error(err);
        });
        req.end();

        msg.channel.startTyping();
      }
    }
    /**
     * Fired on the 'response' http revent.
     *
     * @private
     *
     * @param {http.IncomingMessage} incoming Response object.
     */
    function onIncoming(incoming) {
      if (incoming.statusCode != 200 ) {
        incoming.destroy();
        if (incoming.statusCode == 415) {
          self.common.reply(
              msg,
              'Hmm, that link does not appear to be a supported media type.',
              'HTTP status code: ' + incoming.statusCode);
        } else {
          self.common.reply(
              msg, 'Hmm, that link doesn\'t appear to work.',
              'HTTP status code: ' + incoming.statusCode);
        }
        msg.channel.stopTyping();
        return;
      }
      const cl = incoming.headers['content-length'];
      const type = incoming.headers['content-type'];
      const supported =
          ['image/jpeg', 'image/png', 'image/bmp', 'image/tiff', 'image/gif'];
      self.debug('MIME: ' + type + ', CL: ' + cl);
      if (!supported.includes(type)) {
        incoming.destroy();
        self.common.reply(
            msg, 'The provided filetype is not supported.',
            type || 'unknown filetype');
        msg.channel.stopTyping();
        return;
      } else if (!cl) {
        incoming.destroy();
        self.common.reply(
            msg, 'Please ensure the image is not larger than ' +
                (self.maxBytes / 1000 / 1000) + 'MB.',
            'Unable to determine download size.');
        msg.channel.stopTyping();
        return;
      } else if (cl > self.maxBytes) {
        incoming.destroy();
        self.common.reply(
            msg, 'Please ensure the image is not larger than ' +
                (self.maxBytes / 1000 / 1000) + 'MB.',
            Math.round(cl / 1000 / 100) / 10 + 'MB');
        msg.channel.stopTyping();
        return;
      }
      const data = [];
      let reqBytes = 0;
      incoming.on('data', (chunk) => {
        data.push(chunk);
        reqBytes += chunk.length;
        if (reqBytes > self.maxBytes) {
          incoming.destroy();
          self.common.reply(
              msg, 'Please ensure the image is not larger than ' +
                  (self.maxBytes / 1000 / 1000) + 'MB.',
              '>' + (Math.round(reqBytes / 1000 / 100) / 10) + 'MB');
          msg.channel.stopTyping();
        }
      });
      incoming.on('end', () => onGetAvatar(Buffer.concat(data)));
    }
    /**
     * Once image has been received, convert to Jimp.
     *
     * @private
     *
     * @param {Buffer} buffer The image as a Buffer.
     */
    function onGetAvatar(buffer) {
      Jimp.read(buffer)
          .then((image) => {
            if (!image) throw new Error('Invalid Data');
            let size = 128;
            if (hg.getGame(id) && hg.getGame(id).options &&
                hg.getGame(id).options.eventAvatarSizes) {
              size = hg.getGame(id).options.eventAvatarSizes.avatar;
            }
            const copy = new Jimp(image);
            copy.resize(size, size);
            copy.getBuffer(Jimp.MIME_PNG, (err, out) => {
              if (err) throw err;
              sendConfirmation(image, out);
            });
          })
          .catch((err) => {
            self.common.reply(
                msg, 'I wasn\'t able to convert that file into an image.',
                err.message);
            msg.channel.stopTyping();
            self.error('Failed to convert buffer to image.');
            console.error(err);
          });
    }
    /**
     * Show a confirmation message to the user with the username and avatar.
     *
     * @private
     *
     * @param {Jimp} image The Jimp image for internal use.
     * @param {Buffer} buffer The Buffer the image buffer for showing.
     */
    function sendConfirmation(image, buffer) {
      msg.channel.stopTyping();
      const embed = new self.Discord.MessageEmbed();
      embed.setTitle('Confirm NPC Creation');
      embed.setAuthor(username);
      embed.setDescription(
          'Click the ' + emoji.whiteCheckMark + ' reaction to confirm, ' +
          emoji.x + ' to cancel.');
      embed.attachFiles(
          [new self.Discord.MessageAttachment(buffer, username + '.png')]);
      msg.channel.send(embed)
          .then((msg_) => {
            msg_.react(emoji.whiteCheckMark).then(() => msg_.react(emoji.x));
            newReact(maxReactAwaitTime);
            msg_.awaitReactions((reaction, user) => {
              return user.id == msg.author.id &&
                      (reaction.emoji.name == emoji.whiteCheckMark ||
                       reaction.emoji.name == emoji.x);
            }, {max: 1, time: maxReactAwaitTime}).then((reactions) => {
              embed.setDescription('');
              if (reactions.size == 0) {
                msg_.reactions.removeAll().catch(() => {});
                embed.setFooter('Timed out');
                msg_.edit(embed);
              } else if (
                reactions.first().emoji.name == emoji.whiteCheckMark) {
                msg_.reactions.removeAll().catch(() => {});
                embed.setFooter('Confirmed');
                msg_.edit(embed);
                onConfirm(image);
              } else {
                msg_.reactions.removeAll().catch(() => {});
                embed.setFooter('Cancelled');
                msg_.edit(embed);
              }
            });
          })
          .catch((err) => {
            self.error('Failed to send NPC confirmation: ' + msg.channel.id);
            console.error(err);
          });
    }
    /**
     * Once user has confirmed adding NPC.
     *
     * @private
     *
     * @param {Jimp} image The image to save to file for this NPC.
     */
    function onConfirm(image) {
      const id = NPC.createID();
      const p = NPC.saveAvatar(image, id);
      if (!p) {
        self.common.reply(
            msg, 'Oops, something went wrong while creating that NPC...',
            'This should not happen D:');
        return;
      } else {
        p.then((url) => {
          const error = self.createNPC(msg.guild.id, username, url, id);
          if (error) {
            self.common.reply(msg, 'Failed to create NPC', error);
          } else {
            self.common.reply(msg, 'Created NPC: ' + username, id);
          }
        }).catch((err) => {
          self.error('Failed to create NPC.');
          console.log(err);
        });
      }
    }
  }

  /**
   * @description Create an npc in a guild.
   *
   * @public
   * @param {string|number} gId The guild id to add the npc to.
   * @param {string} username The name of the npc.
   * @param {string} avatar The url path to the avatar. Must be valid url to
   * this server. (ex:
   * https://www.spikeybot.com/avatars/NPCBBBADEF031F83638/avatar1.png).
   * @param {string} id The npc id of this npc. Must match the id in the avatar
   * url.
   * @returns {?string} Error message or null if no error.
   */
  this.createNPC = function(gId, username, avatar, id) {
    if (typeof avatar !== 'string') return 'Invalid Avatar URL.';
    const splitURL = avatar.match(/\/avatars\/(NPC[A-F0-9]+)\/\w+\.png/);
    if (!splitURL) return 'Invalid Avatar URL.';
    const urlID = splitURL[1];

    if (!NPC.checkID(id)) {
      return 'Invalid NPC ID.';
    } else if (urlID !== id) {
      return 'ID does not match avatar ID.';
    }

    const npc = new NPC(formatUsername(username), avatar, id);

    const pushNPC = function(game) {
      if (!game.includedNPCs) hg.getGame(gId).includedNPCs = [];
      game.includedNPCs.push(npc);

      if (!game.currentGame || !game.currentGame.inProgress) {
        self.createGame(gId);
      }
      self._fire('memberAdd', gId, npc.id);
    };
    hg.fetchGame(gId, (game) => {
      if (!game) {
        self.createGame(gId, pushNPC);
      } else {
        pushNPC(game);
      }
    });
    return null;
  };

  /**
   * Clean up username, and format to rules similar to Discord.
   *
   * @private
   *
   * @param {string} u The username.
   * @param {string|RegExp} [remove] A substring or RegExp to remove.
   * @returns {string} Formatted username.
   */
  function formatUsername(u, remove) {
    if (!remove) remove = /a^/;  // Match nothing by default.
    return u.replace(remove, '')
        .replace(/^\s+|\s+$|@|#|:|```/g, '')
        .replace(/\s{2,}/g, ' ')
        .substring(0, 32);
  }
  /**
   * @inheritdoc
   * @public
   */
  this.formatUsername = formatUsername;

  /**
   * Rename an NPC.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function renameNPC(msg, id) {
    const mentions =
        msg.softMentions.users.filter((el) => el.id.startsWith('NPC'));
    if (mentions.size == 0) {
      if (msg.text && msg.text.length > 1) {
        self.common.reply(msg, 'I wasn\'t able to find that NPC.');
      } else {
        self.common.reply(msg, 'Please specify an NPC to rename.');
      }
      return;
    }
    const toRename = mentions.first();

    const oldName = toRename.username;
    const trimmed = (msg.text.indexOf(toRename.id) > -1 ?
                         msg.text.replace(toRename.id, '') :
                         msg.text.replace(oldName, '')).trim();
    const newName = formatUsername(trimmed);
    const success = self.renameNPC(id, toRename.id, newName);
    if (success) {
      self.common.reply(msg, 'Failed to rename NPC', success);
    } else {
      self.common.reply(
          msg, 'Renamed NPC', '`' + oldName + '` to `' + newName + '`');
    }
  }

  /**
   * @description Rename an npc in a guild.
   *
   * @public
   * @param {string|number} gId The guild ID context.
   * @param {string} npcId The ID of the NPC to rename.
   * @param {string} username The new name of the npc.
   * @returns {?string} Error message or null if no error.
   */
  this.renameNPC = function(gId, npcId, username) {
    const npc = hg.getGame(gId).includedNPCs.find((el) => el.id == npcId) ||
        hg.getGame(gId).excludedNPCs.find((el) => el.id == npcId);
    if (!npc) return 'INVALID_NPC';

    username = formatUsername(username);
    if (username.length < 2) return 'INVALID_USERNAME';
    npc.username = username;
    npc.name = username;

    return null;
  };

  /**
   * Delete an NPC.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function removeNPC(msg, id) {
    const mentions =
        msg.softMentions.users.filter((el) => el.id.startsWith('NPC'));
    if (mentions.size == 0) {
      if (msg.text && msg.text.length > 1) {
        self.common.reply(msg, 'I wasn\'t able to find that NPC.');
      } else {
        self.common.reply(msg, 'Please specify an NPC to delete.');
      }
      return;
    }
    const toDelete = mentions.first();
    const success = self.removeNPC(id, toDelete.id);
    if (typeof success === 'string') {
      self.common.reply(msg, success);
    } else {
      msg.channel.send(success).catch(
          () => self.common.reply(msg, 'NPC Deleted', toDelete.id));
    }
  }
  /**
   * Delete an NPC from a guild.
   *
   * @public
   *
   * @param {string} gId Guild id of which to remove npc.
   * @param {string} npc ID of npc to delete.
   * @returns {string|Discord~MessageEmbed} String if error, MessageEmbed to
   * send if success.
   */
  this.removeNPC = function(gId, npc) {
    const incIndex =
        hg.getGame(gId).includedNPCs.findIndex((el) => el.id == npc);
    const excIndex =
        hg.getGame(gId).excludedNPCs.findIndex((el) => el.id == npc);

    let toDelete;
    if (incIndex > -1) {
      toDelete = hg.getGame(gId).includedNPCs.splice(incIndex, 1)[0];
      self._fire('memberRemove', gId, npc);
    } else if (excIndex > -1) {
      toDelete = hg.getGame(gId).excludedNPCs.splice(excIndex, 1)[0];
      self._fire('memberRemove', gId, npc);
    } else {
      self.error('NPC HALF DISCOVERED :O ' + npc);
      return 'Oops, I was only half able to find that NPC. ' +
          'Something is broken...';
    }

    if (!hg.getGame(gId).currentGame.inProgress) self.createGame(gId);

    const embed = new self.Discord.MessageEmbed();
    embed.setTitle('Deleted NPC');
    embed.setDescription(toDelete.name);
    embed.setFooter(toDelete.id);
    embed.setThumbnail(toDelete.avatarURL);
    return embed;
  };

  /**
   * @description Include an NPC in the game.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function includeNPC(msg, id) {
    includeUser(msg, id);
  }

  /**
   * @description Exclude an NPC from the game.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   */
  function excludeNPC(msg, id) {
    excludeUser(msg, id);
  }

  /**
   * @description Send help message to DM and reply to server.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   */
  function help(msg) {
    msg.author.send(self.helpMessage)
        .then(() => {
          if (msg.guild != null) {
            self.common.reply(msg, helpmessagereply, ':wink:').catch((err) => {
              self.error(
                  'Failed to send HG help message reply in channel: ' +
                  msg.channel.id);
              console.error(err);
            });
          }
        })
        .catch(() => {
          self.common.reply(msg, blockedmessage).catch(() => {});
        });
  }

  /**
   * @description Responds with stats about a player in the games.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id Guild ID this command was called from.
   */
  function commandStats(msg, id) {
    const game = hg.getGame(id);
    if (!game) {
      self.common.reply(
          msg, 'No Stats', 'You haven\'t started a game before. ' +
              'Stats will be available after a game is started.');
      return;
    }
    const numTotal = game.statGroup ? 3 : 2;
    const user = msg.softMentions.users.first() || msg.author;
    let numDone = 0;
    const embed = new self.Discord.MessageEmbed();
    embed.setTitle(`${user.tag}'s HG Stats`);
    embed.setColor([255, 0, 255]);

    const checkDone = function() {
      numDone++;
      if (numDone === numTotal) {
        msg.channel.send(self.common.mention(msg), embed);
      }
    };

    const groupDone = function(err, group) {
      if (!group) {
        checkDone();
        return;
      }
      group.fetchUser(user.id, (err, data) => {
        if (err) {
          self.error(
              'Failed to fetch HG User stats: ' + id + '@' + user.id + '/' +
              group.id);
          console.error(err);
        } else {
          const list = data.keys.map(
              (el) => `${self.common.camelToSpaces(el)}: ${data.get(el)}`);
          if (group.id === 'global') {
            embed.addField('Lifetime', list.join('\n'), true);
            checkDone();
            return;
          } else if (group.id === 'previous') {
            embed.addField('Previous Game', list.join('\n'), true);
            checkDone();
            return;
          }
          group.fetchMetadata((err, meta) => {
            if (err) {
              self.error(
                  'Failed to fetch metadata for group ' + id + '/' + group.id);
              console.error(err);
            }
            if (meta && meta.name) {
              embed.addField(meta.name, list.join('\n'), true);
            } else {
              embed.addField(group.id, list.join('\n'), true);
            }
            checkDone();
          });
        }
      });
    };

    if (game.statGroup) game._stats.fetchGroup(game.statGroup, groupDone);
    game._stats.fetchGroup('global', groupDone);
    game._stats.fetchGroup('previous', groupDone);
  }

  /**
   * @description Responds with list of all stat group names and IDs.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id Guild ID this command was called from.
   */
  function commandGroups(msg, id) {
    const game = hg.getGame(id);
    if (!game) {
      self.common.reply(
          msg, 'There is no group data yet.', 'Please create a group first.');
      return;
    }
    let total = 0;
    let done = 0;
    const list = [];
    const checkDone = function() {
      done++;
      if (done >= total) {
        self.common.reply(
            msg, 'Stat Groups',
            list.join('\n') || 'I wasn\'t able to find that group.');
      }
    };
    const groupDone = function(err, group) {
      if (err) {
        checkDone();
        return;
      }
      group.fetchMetadata((err, meta) => {
        const flag = game.statGroup === group.id ? '*' : ' ';
        if (err) {
          list.push(`${group.id}${flag}`);
          checkDone();
          self.error(
              'Failed to fetch metadata for stat group: ' + id + '/' +
              group.id);
        } else {
          list.push(`${group.id}${flag}: ${meta.name}`);
          checkDone();
        }
      });
    };
    const groupID = msg.text.match(/\b([a-fA-F0-9]{4})\b/);
    if (groupID) {
      total = 1;
      game._stats.fetchGroup(groupID[1].toUpperCase(), groupDone);
    } else {
      game._stats.fetchGroupList((err, list) => {
        if (err) {
          if (err.code === 'ENOENT') {
            list = [];
          } else {
            self.error('Failed to get list of stat groups.');
            console.error(err);
            self.common.reply(
                msg, 'Failed to get list of groups.', 'Something broke...');
            return;
          }
        }
        list = list.filter((el) => !['global', 'previous'].includes(el));
        total = list.length;
        list.forEach((el) => game._stats.fetchGroup(el, groupDone));
        if (list.length === 0) {
          self.common.reply(msg, 'There are no created groups.');
        }
      });
    }
  }

  /**
   * @description Creates a new stat group.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id Guild ID this command was called from.
   * @param {HungryGames~GuildGame} [game] The game object to modify.
   */
  function commandNewGroup(msg, id, game) {
    if (!game) game = hg.getGame(id);
    if (!game) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        commandNewGroup(msg, id, game);
      });
      return;
    }
    const name = msg.text.trim().slice(0, 24);
    game._stats.createGroup({name: name}, (group) => {
      let res = group.id;
      if (name) res = `${res}: ${name}`;
      game.statGroup = group.id;
      self.common.reply(msg, 'Created and selected new stat group', res);
    });
  }

  /**
   * @description Selects an existing stat group.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id Guild ID this command was called from.
   */
  function commandSelectGroup(msg, id) {
    const game = hg.getGame(id);
    if (!game) {
      self.common.reply(
          msg, 'There is no group data yet.', 'Please create a group first.');
      return;
    }
    let groupID = msg.text.match(/\b([a-fA-F0-9]{4})\b/);
    if (!groupID) {
      self.common.reply(msg, 'Disabled stat group');
      game.statGroup = null;
      return;
    }
    groupID = groupID[1].toUpperCase();
    game._stats.fetchGroup(groupID, (err, group) => {
      if (err) {
        self.common.reply(
            msg, 'I wasn\'t able to find that group.', 'List groups with `' +
                msg.prefix + self.postPrefix + 'groups`');
        return;
      }
      game.statGroup = groupID;
      let name;
      if (group.name) {
        name = `${group.name} (${group.id})`;
      } else {
        name = `${group.id}`;
      }
      self.common.reply(msg, 'Selected group', name);
    });
  }

  /**
   * @description Renames an existing stat group.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id Guild ID this command was called from.
   */
  function commandRenameGroup(msg, id) {
    const game = hg.getGame(id);
    if (!game) {
      self.common.reply(
          msg, 'There is no group data yet.', 'Please create a group first.');
      return;
    }
    const regex = /\b([a-fA-F0-9]{4})\b/;
    let groupID = msg.text.match(regex);
    if (!groupID) {
      self.common.reply(
          msg, 'Please specify a valid group ID to rename.',
          'List groups with `' + msg.prefix + self.postPrefix + 'groups`');
      return;
    }
    groupID = groupID[1].toUpperCase();
    const newName = msg.text.replace(regex, '').trim().slice(0, 24);
    game._stats.fetchGroup(groupID, (err, group) => {
      if (err) {
        self.common.reply(
            msg, 'I wasn\'t able to find that group.', 'List groups with `' +
                msg.prefix + self.postPrefix + 'groups`');
        return;
      }
      group.setMetaName(newName);
      let name;
      if (newName) {
        name = `${group.id}: (${newName})`;
      } else {
        name = `${group.id}`;
      }
      self.common.reply(msg, 'Renamed group', name);
    });
  }

  /**
   * @description Deletes an existing stat group.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id Guild ID this command was called from.
   */
  function commandDeleteGroup(msg, id) {
    const game = hg.getGame(id);
    if (!game) {
      self.common.reply(
          msg, 'There is no group data yet.', 'Please create a group first.');
      return;
    }
    let groupID = msg.text.match(/\b([a-fA-F0-9]{4})\b/);
    if (!groupID) {
      self.common.reply(
          msg, 'Please specify a valid group ID to rename.',
          'List groups with `' + msg.prefix + self.postPrefix + 'groups`');
      return;
    }
    groupID = groupID[1].toUpperCase();
    game._stats.fetchGroup(groupID, (err, group) => {
      if (err) {
        self.common.reply(
            msg, 'I wasn\'t able to find that group.', 'List groups with `' +
                msg.prefix + self.postPrefix + 'groups`');
        return;
      }
      let additional = null;
      if (game.statGroup === group.id) {
        additional = 'Disabled stat group';
        game.statGroup = null;
      }
      group.reset();
      self.common.reply(msg, `Deleted group ${group.id}`, additional);
    });
  }

  /**
   * @description Ranks players by stat.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id Guild ID this command was called from.
   */
  function commandLeaderboard(msg, id) {
    const game = hg.getGame(id);
    if (!game) {
      self.common.reply(
          msg, 'There is no game data to show stats for.',
          'Try again after you have completed a game.');
      return;
    }
    const regex = /\b([a-fA-F0-9]{4})\b/;
    let groupID = msg.text.match(regex);
    if (!groupID) {
      const prevList = ['last', 'previous', 'recent'];
      if (prevList.find((el) => msg.text.indexOf(el) > -1)) {
        groupID = 'previous';
      } else {
        groupID = 'global';
      }
    } else {
      groupID = groupID[1].toUpperCase();
    }
    const text = msg.text.toLocaleLowerCase();
    const col =
        HungryGames.Stats.keys.find(
            (el) => text.indexOf(el.toLocaleLowerCase()) > -1 ||
                text.indexOf(
                    self.common.camelToSpaces(el).toLocaleLowerCase()) > -1) ||
        'wins';
    game._stats.fetchGroup(groupID, (err, group) => {
      if (err) {
        if (groupID === 'previous' || groupID === 'global') {
          self.common.reply(
              msg, 'It doesn\'t look like you\'ve finished a game yet.',
              'Check back after a game to see your stats!');
        } else {
          self.common.reply(
              msg, 'I wasn\'t able to find that group.', 'List groups with `' +
                  msg.prefix + self.postPrefix +
                  'groups`, or say "lifetime" or "previous".');
        }
        return;
      }
      const opts = {};
      opts.sort = col;
      const num = msg.text.replace(regex, '').match(/\d+/);
      if (num && num[0] * 1 > 0) opts.limit = num[0] * 1;
      group.fetchUsers(opts, (err, rows) => {
        if (err) {
          self.error('Failed to fetch leaderboard: ' + id + '/' + groupID);
          console.error(err);
          self.common.reply(
              msg,
              'Oops! Something went wrong while fetching the leaderboard...');
          return;
        }
        if (!rows || rows.length === 0) {
          self.common.reply(
              msg, 'It doesn\'t look like this group has any game data yet.',
              'Check back after a game to see your stats!');
          return;
        }
        const list = rows.map((el, i) => {
          let name;
          if (el.id.startsWith('NPC')) {
            const npc = game.includedNPCs.find((n) => n.id === el.id) ||
                game.excludedNPCs.find((n) => n.id === el.id);
            name = npc ? npc.name : el.id;
          } else {
            const iU =
                game.currentGame.includedUsers.find((u) => u.id === el.id);
            if (iU) {
              name = (game.options.useNicknames && iU.nickname) || iU.name;
            } else {
              const m = msg.guild.members.resolve(el.id);
              name = m ?
                  (game.options.useNicknames && m.nickname) || m.user.username :
                  el.id;
            }
          }
          return `${i+1}) ${name}: ${el.get(col)}`;
        });

        const embed = new self.Discord.MessageEmbed();
        embed.setTitle(`Rank by ${col}`);
        const groupName = groupID === 'global' ? 'lifetime' : groupID;
        embed.setDescription(groupName);
        embed.setColor([255, 0, 255]);

        const numCols = self.calcColNum(1, list);
        const numTotal = list.length;
        const quarterLength = Math.ceil(numTotal / numCols);

        for (let i = 0; i < numCols - 1; i++) {
          const thisMessage =
              list.splice(0, quarterLength).join('\n').slice(0, 1024);
          embed.addField(
              `${i * quarterLength + 1}-${(i + 1) * quarterLength}`,
              thisMessage, true);
        }
        embed.addField(
            `${(numCols - 1) * quarterLength + 1}-${numTotal}`,
            list.join('\n').slice(0, 1024) || '.', true);

        msg.channel.send(self.common.mention(msg), embed).catch((err) => {
          self.error(
              'Failed to send leaderboard in channel: ' + msg.channel.id);
          console.error(err);
          self.common.reply(
              msg, 'Oops! I wasn\'t able to send the leaderboard here for an ' +
                  'unknown reason.',
              err.code);
        });
      });
    });
  }

  /**
   * @description Replies to the user with stats about all the currently loaded
   * games in this shard.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   */
  function commandNums(msg) {
    if (self.client.shard) {
      self.client.shard.broadcastEval('this.getHGStats(true)').then((res) => {
        const embed = new self.Discord.MessageEmbed();
        embed.setTitle('Stats Across Shards');
        res.forEach((el, i) => embed.addField(`#${i}`, el, true));
        msg.channel.send(embed);
      }).catch((err) => {
        self.common.reply(
            msg, 'Oops, something went wrong while fetching stats.');
        self.error(err);
      });
    } else {
      self.common.reply(msg, getStatsString());
    }
  }

  /**
   * @description Get this shard's stats and format it into a human readable
   * string.
   * @private
   * @param {boolean} [short=false] Provide a short version.
   * @returns {string} The formatted string.
   */
  function getStatsString(short = false) {
    const listenerBlockDuration = listenersEndTime - Date.now();
    let message;
    if (short) {
      message = `${self.getNumSimulating()}/${Object.keys(hg._games).length}`;
    } else {
      message = 'There are ' + self.getNumSimulating() +
          ' games currently simulating of ' + Object.keys(hg._games).length +
          ' currently loaded.';
    }
    if (!short && listenerBlockDuration > 0) {
      message += '\nThe last listener will end in ' +
          (Math.round(listenerBlockDuration / 100 / 60) / 10) + ' minutes.';
    }
    const web = !self.common.isSlave && self.bot.getSubmodule(webSM);
    if (web) {
      const numClients = web.getNumClients();
      if (short) {
        message += ` (${numClients} web)`;
      } else {
        message += '\n' + numClients + ' web client' +
            (numClients == 1 ? '' : 's') + ' connected.';
      }
    }
    return message;
  }

  /**
   * @description Replies to the user with an image saying "rigged". That is
   * all.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   */
  function commandRig(msg) {
    const embed = new self.Discord.MessageEmbed();
    embed.setThumbnail('https://discordemoji.com/assets/emoji/rigged.png');
    embed.setColor([187, 26, 52]);
    msg.channel.send(self.common.mention(msg), embed);
  }

  /**
   * @description Fetch an array of user IDs that are in the current game and
   * have been referenced in any way due to the given message from the user.
   * @private
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {HungryGames~GuildGame} game The game this is for.
   * @returns {string[]} Array of user IDs that are in the current game that
   * were mentioned.
   */
  function parseGamePlayers(msg, game) {
    const mentions = parseMentions(msg);

    let firstWord = msg.text.trim().split(' ')[0];
    if (firstWord) firstWord = firstWord.toLowerCase();
    const specialWords = {
      everyone: ['everyone', '@everyone', 'all'],
      online: ['online', 'here', '@here'],
      offline: ['offline'],
      idle: ['idle', 'away', 'snooze', 'snoozed'],
      dnd: ['dnd', 'busy'],
      bots: ['bot', 'bots'],
      npcs: ['npc', 'npcs', 'ai', 'ais'],
    };

    let players = [];
    const incU = game.currentGame.includedUsers;
    if (specialWords.everyone.includes(firstWord)) {
      players = game.currentGame.includedUsers.map((el) => el.id);
    } else if (specialWords.online.includes(firstWord)) {
      players = incU.filter((el) => {
        const member = msg.guild.members.resolve(el.id);
        if (!member) return false;
        return member.user.presence.status === 'online';
      }).map((el) => el.id);
    } else if (specialWords.offline.includes(firstWord)) {
      players = incU.filter((el) => {
        const member = msg.guild.members.resolve(el.id);
        if (!member) return false;
        return member.user.presence.status === 'offline';
      }).map((el) => el.id);
    } else if (specialWords.idle.includes(firstWord)) {
      players = incU.filter((el) => {
        const member = msg.guild.members.resolve(el.id);
        if (!member) return false;
        return member.user.presence.status === 'idle';
      }).map((el) => el.id);
    } else if (specialWords.dnd.includes(firstWord)) {
      players = incU.filter((el) => {
        const member = msg.guild.members.resolve(el.id);
        if (!member) return false;
        return member.user.presence.status === 'dnd';
      }).map((el) => el.id);
    } else if (specialWords.npcs.includes(firstWord)) {
      players = incU.filter((el) => el.isNPC).map((el) => el.id);
    } else if (specialWords.bots.includes(firstWord)) {
      players = incU.filter((el) => {
        const member = msg.guild.members.resolve(el.id);
        if (!member) return false;
        return member.user.bot;
      }).map((el) => el.id);
    }

    return players.concat(
        mentions
            .filter((u) => {
              if (!u || players.includes(u.id)) return false;
              return game.currentGame.includedUsers.find((p) => p.id == u.id);
            })
            .map((el) => el.id));
  }

  /**
   * @description Allows the game creator to kill a player in the game.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] The game object to modify.
   */
  function commandKill(msg, id, game) {
    if (!game) game = hg.getGame(id);
    if (!game) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        commandKill(msg, id, game);
      });
      return;
    }
    const players = parseGamePlayers(msg, game);

    if (!players || players.length == 0) {
      self.common.reply(msg, 'Please specify a player in the games to kill.');
      return;
    }
    HungryGames.GuildGame.forcePlayerState(
        hg.getGame(id), players, 'dead', hg.messages,
        hg._defaultEventStore.getArray('player'), (res) => {
          self.common.reply(msg, res);
        });
  }

  /**
   * @description Allows the game creator to heal or revive a player in the
   * game.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] The game object to modify.
   */
  function commandHeal(msg, id, game) {
    if (!game) game = hg.getGame(id);
    if (!game) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        commandHeal(msg, id, game);
      });
      return;
    }
    const players = parseGamePlayers(msg, game);

    if (!players || players.length == 0) {
      self.common.reply(msg, 'Please specify a player in the games to heal.');
      return;
    }
    HungryGames.GuildGame.forcePlayerState(
        hg.getGame(id), players, 'thriving', hg.messages,
        hg._defaultEventStore.getArray('player'), (res) => {
          self.common.reply(msg, res);
        });
  }

  /**
   * @description Allows the game creator to wound a player in the game.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] The game object to modify.
   */
  function commandWound(msg, id, game) {
    if (!game) game = hg.getGame(id);
    if (!game) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        commandWound(msg, id, game);
      });
      return;
    }
    const players = parseGamePlayers(msg, game);

    if (!players || players.length == 0) {
      self.common.reply(msg, 'Please specify a player in the games to wound.');
      return;
    }
    HungryGames.GuildGame.forcePlayerState(
        hg.getGame(id), players, 'wounded', hg.messages,
        hg._defaultEventStore.getArray('player'), (res) => {
          self.common.reply(msg, res);
        });
  }

  /**
   * @description Rename the guild's game to the given custom name.
   *
   * @public
   * @param {string|number} id The guild id of which to change the game's name.
   * @param {string} name The custom name to change to. Must be 100 characters
   * or fewer.
   * @returns {boolean} True if successful, false if failed. Failure is probably
   * due to a game not existing or the name being longer than 100 characters.
   */
  this.renameGame = function(id, name) {
    if (!hg.getGame(id) || !hg.getGame(id).currentGame) return false;
    if (name.length > 100) return false;
    hg.getGame(id).currentGame.customName = name;
    hg.getGame(id).currentGame.name =
        name || (self.client.guilds.resolve(id).name + '\'s Hungry Games');
    return true;
  };

  /**
   * @description Rename a guild's game to a custom name.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] The game object to modify.
   */
  function commandRename(msg, id, game) {
    if (!game) game = hg.getGame(id);
    if (!game || !game.currentGame) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        commandRename(msg, id, game);
      });
      return;
    }
    if (self.renameGame(id, msg.text.trim())) {
      self.common.reply(
          msg, 'Renamed game to',
          msg.text.trim() || self.client.guilds.resolve(id).name);
    } else {
      self.common.reply(
          msg, 'Oops! I couldn\'t change the name to that. Please ensure ' +
              'it is fewer than 100 characters long.');
    }
  }

  /**
   * @description Give a certain amount of a weapon to a player.
   *
   * @see {@link HG~commandModifyWeapon}
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @listens Command#hg give
   */
  function commandGiveWeapon(msg, id) {
    commandModifyWeapon(msg, id, false);
  }
  /**
   * @description Take a certain amount of a weapon from a player.
   *
   * @see {@link HG~commandModifyWeapon}
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @listens Command#hg take
   */
  function commandTakeWeapon(msg, id) {
    commandModifyWeapon(msg, id, true);
  }

  /**
   * @description Actually does the parsing for {@link HG~commandGiveWeapon} and
   * {@link HG~commandTakeWeapon}.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {boolean} [flip=false] Should the parsed number value be multiplied
   * by -1.
   */
  function commandModifyWeapon(msg, id, flip = false) {
    const game = hg.getGame(id);
    if (!game || !game.currentGame || !game.currentGame.includedUsers ||
        !game.currentGame.inProgress) {
      self.common.reply(msg, 'Please start a game first.');
      return;
    }
    let users = msg.softMentions.users;
    if (users.size === 0) {
      self.common.reply(msg, 'Please specify a player to modify.');
      return;
    }
    users = users.filter(
        (el) => game.currentGame.includedUsers.find((u) => u.id == el.id));
    if (users.size === 0) {
      self.common.reply(msg, 'Please specify a player that is in the game.');
      return;
    }
    let num = 0;
    let final = null;
    const list = [];
    const text = msg.text.toLocaleLowerCase().replace(/\d{17,19}/g, '');
    const weapons = game.customEventStore.getArray('weapon');
    defaultEvents.getArray('weapon').forEach((w) => {
      list.push(w.name);
      if (text.indexOf(w.name.toLocaleLowerCase()) > -1) {
        num++;
        final = w.id;
      }
    });
    weapons.forEach((w) => {
      if (!list.includes(w.name) &&
          text.indexOf(w.name.toLocaleLowerCase()) > -1) {
        num++;
        final = w.id;
      }
    });
    if (num == 0) {
      self.common.reply(msg, 'Please specify a valid weapon name.');
      return;
    } else if (num > 1) {
      self.common.reply(
          msg, 'I\'m not sure which weapon you wanted, I found more than one.');
      return;
    }
    let count = text.match(/\b(-?\d+)\b/);
    if (!count) {
      count = flip ? -1 : 1;
    } else {
      count = (flip ? -1 : 1) * count[1];
    }

    game.modifyPlayerWeapon(
        users.first().id, final, hg, count, false,
        (res) => self.common.reply(msg, res));
  }
  /**
   * @description Start or stop allowing users to enter in to a game by clicking
   * on a reaction to a message.
   *
   * @private
   * @type {HungryGames~hgCommandHandler}
   * @param {Discord~Message} msg The message that lead to this being called.
   * @param {string} id The id of the guild this was triggered from.
   * @param {HungryGames~GuildGame} [game] The game object to modify.
   */
  function commandReactJoin(msg, id, game) {
    if (!game) game = hg.getGame(id);
    if (!game || !game.currentGame) {
      createGame(msg, id, false, (game) => {
        if (!game) {
          self.common.reply(msg, 'Failed to create game for unknown reason.');
          return;
        }
        commandReactJoin(msg, id, game);
      });
      return;
    }
    if (game.reactMessage) {
      self.endReactJoinMessage(id, (err, info) => {
        if (err) {
          self.error(err);
          self.common.reply(msg, 'Reaction Join Failed', err);
        } else {
          self.common.reply(msg, 'Reaction Join', info);
        }
      });
    } else {
      self.createReactJoinMessage(msg.channel);
    }
  }

  /**
   * @description Send a message with a reaction for users to click on. Records
   * message id and channel id in game data.
   *
   * @public
   * @param {Discord~TextChannel|string} channel The channel in the guild to
   * send the message, or the ID of the channel.
   */
  this.createReactJoinMessage = function(channel) {
    if (typeof channel === 'string') {
      channel = self.client.channels.resolve(channel);
    }
    if (!channel || !channel.guild || !channel.guild.id ||
        !hg.getGame(channel.guild.id)) {
      return;
    }
    const embed = new self.Discord.MessageEmbed();
    embed.setColor(defaultColor);
    embed.setTitle(`React with any emoji to join!`);
    embed.setDescription(
        'If you have reacted, you will be included in the next `' +
        hg.getGame(channel.guild.id).currentGame.name + '`');
    channel.send(embed).then((msg) => {
      hg.getGame(channel.guild.id).reactMessage = {
        id: msg.id,
        channel: msg.channel.id,
      };
      msg.react(emoji.crossedSwords).catch(() => {});
    });
  };

  /**
   * @description End the reaction join and update the included users to only
   * include those who reacted to the message.
   *
   * @public
   * @param {string} id The guild id of which to end the react join.
   * @param {Function} [cb] Callback once this is complete. First parameter is a
   * string if error, null otherwise, the second is a string with info if
   * success or null otherwise.
   */
  this.endReactJoinMessage = function(id, cb) {
    if (typeof cb !== 'function') cb = function() {};
    if (!hg.getGame(id) || !hg.getGame(id).reactMessage ||
        !hg.getGame(id).reactMessage.id ||
        !hg.getGame(id).reactMessage.channel) {
      hg.getGame(id).reactMessage = null;
      cb('Unable to find message with reactions. ' +
         'Was a join via react started?');
      return;
    }

    let numTotal = 0;
    let numDone = 0;
    let msg;
    const channel = self.client.guilds.resolve(id).channels.resolve(
        hg.getGame(id).reactMessage.channel);
    if (!channel) {
      hg.getGame(id).reactMessage = null;
      cb('Unable to find message with reactions. Was the channel deleted?');
      return;
    }
    channel.messages.fetch(hg.getGame(id).reactMessage.id)
        .then((m) => {
          msg = m;
          if (!msg.reactions || msg.reactions.size == 0) {
            usersFetched();
          } else {
            msg.reactions.cache.forEach((el) => {
              numTotal++;
              el.users.fetch().then(usersFetched).catch((err) => {
                self.error('Failed to fetch user reactions: ' + msg.channel.id);
                console.error(err);
                usersFetched();
              });
            });
          }
        })
        .catch((err) => {
          console.error(err);
          hg.getGame(id).reactMessage = null;
          cb('Unable to find message with reactions. Was it deleted?');
        });
    let list = new self.Discord.Collection();
    /**
     * @description Adds fetched user reactions to buffer until all are
     * received, then ends react join.
     *
     * @private
     * @param {Discord.Collection.<User>|Discord.User[]} reactionUsers Array of
     * users for a single reaction.
     */
    function usersFetched(reactionUsers) {
      numDone++;
      if (reactionUsers &&
          (reactionUsers.length > 0 || reactionUsers.size > 0)) {
        list = list.concat(
            reactionUsers.filter((el) => el.id != self.client.user.id));
      }
      if (numTotal > numDone) return;
      self.excludeUsers('everyone', id, () => {
        hg.getGame(id).reactMessage = null;
        msg.edit('`Ended`').catch(() => {});
        if (list.size == 0) {
          cb(null, 'No users reacted.');
        } else {
          self.includeUsers(list, id, (res) => cb(null, res));
        }
      });
    }
  };

  /**
   * @description Sort the includedUsers and teams for the given game.
   * @public
   * @param {HungryGames~GuildGame} game The game to sort.
   */
  this.sortTeams = function(game) {
    game.currentGame.teams.sort((a, b) => b.id - a.id);
    game.currentGame.includedUsers.sort((a, b) => {
      const aTeam = game.currentGame.teams.find((team) => {
        return team.players.findIndex((player) => {
          return player == a.id;
        }) > -1;
      });
      const bTeam = game.currentGame.teams.find((team) => {
        return team.players.findIndex((player) => {
          return player == b.id;
        }) > -1;
      });
      if (!aTeam || !bTeam || aTeam.id == bTeam.id) {
        const aN = ((game.options.useNicknames && a.nickname) || a.name)
            .toLocaleLowerCase();
        const bN = ((game.options.useNicknames && b.nickname) || b.name)
            .toLocaleLowerCase();
        if (aN < bN) return -1;
        if (aN > bN) return 1;
        return 0;
      } else {
        return aTeam.id - bTeam.id;
      }
    });
  };

  /**
   * @description Returns the number of games that are currently being shown to
   * users.
   *
   * @public
   * @returns {number} Number of games simulating.
   */
  this.getNumSimulating = function() {
    const loadedEntries = Object.entries(hg._games);
    const inProgress = loadedEntries.filter((game) => {
      return game[1].currentGame && game[1].currentGame.inProgress &&
          game[1].currentGame.day.state > 1 && !game[1].currentGame.isPaused;
    });
    return inProgress.length;
  };

  /**
   * @description Get a random word that means "nothing".
   *
   * @private
   * @returns {string} A word meaning "nothing".
   */
  function nothing() {
    const nothings = [
      'nix',
      'naught',
      'nothing',
      'zilch',
      'void',
      'zero',
      'zip',
      'zippo',
      'diddly',
      emoji.x,
    ];
    return nothings[Math.floor(Math.random() * nothings.length)];
  }

  /**
   * Calculates the number of columns for the given player list. Assumes maximum
   * character count of 1024 per section. The number of columns also becomes
   * limited to 5, because we will run into the embed total character limit of
   * 6000 if we add any more.
   * [Discord API Docs](
   * https://discordapp.com/developers/docs/resources/channel#embed-limits).
   *
   * @public
   *
   * @param {number} numCols Minimum number of columns.
   * @param {string[]} statusList List of text to check.
   * @returns {number} Number of columns the data shall be formatted as.
   */
  this.calcColNum = function(numCols, statusList) {
    if (numCols === statusList.length) return numCols;
    // if (numCols > 25) return 25;
    if (numCols > 5) return 5;
    const quarterLength = Math.ceil(statusList.length / numCols);
    for (let i = 0; i < numCols; i++) {
      if (statusList.slice(quarterLength * i, quarterLength * (i + 1))
          .join('\n')
          .length > 1024) {
        return self.calcColNum(numCols + 1, statusList);
      }
    }
    return numCols;
  };

  /**
   * Update {@link HungryGames~listenersEndTime} because a new listener was
   * registered with the given duration.
   *
   * @private
   * @param {number} duration The length of time the listener will be active.
   */
  function newReact(duration) {
    if (Date.now() + duration > listenersEndTime) {
      listenersEndTime = Date.now() + duration;
    }
  }

  /**
   * @description Parse all mentioned users from all softMentions and Discord
   * mentions, including roles.
   * @private
   * @param {Discord~Message} msg The message containing mention data.
   * @returns {Discord~Collection<Discord~User>} Collection of all users
   * mentioned.
   */
  function parseMentions(msg) {
    const mentionedRoleUsers = new self.Discord.Collection(
        ...msg.mentions.roles.map((r) => r.members.map((m) => [m.id, m.user])));
    const softRoleUsers = new self.Discord.Collection(
        ...msg.softMentions.roles.map(
            (r) => r.members.map((m) => [m.id, m.user])));
    return msg.mentions.users.concat(msg.softMentions.users)
        .concat(mentionedRoleUsers.concat(softRoleUsers));
  }

  /**
   * Attempt to fetch an image from a URL. Checks if the file has been cached to
   * the filesystem first.
   *
   * @public
   *
   * @param {string|Jimp|Buffer} url The url to fetch the image from, or
   * anything Jimp supports.
   * @returns {Promise} Promise from JIMP with image data.
   */
  this.readImage = function(url) {
    let fromCache = false;
    let filename;
    let dir;
    if (typeof url === 'string') {
      const splitURL = url.match(/\/(avatars)\/(\w+)\/([^?&/]+)/);
      if (splitURL && splitURL[1] == 'avatars') {
        dir = `${self.common.userSaveDir}avatars/${splitURL[2]}/`;
        filename = `${dir}${splitURL[3]}`;
      }
      if (filename && fs.existsSync(filename)) {
        fromCache = true;
        return toJimp(filename);
      }
    }
    return toJimp(url).then((image) => {
      if (fromCache) return image;
      if (filename && image) {
        image.getBuffer(Jimp.MIME_PNG, (err, buffer) => {
          if (err) {
            self.error(
                `Failed to convert image into buffer: ${filename || url}`);
            console.error(err);
            return;
          }
          self.common.mkAndWrite(filename, dir, buffer, (err) => {
            if (err) {
              self.error(`Failed to cache avatar: ${filename}`);
              console.error(err);
            }
          });
        });
      }
      return image;
    });
    /**
     * Send the request to Jimp to handle.
     *
     * @private
     *
     * @param {string} path Or path that Jimp can handle.
     * @returns {Promise} Promise from Jimp with image data.
     */
    function toJimp(path) {
      if (typeof path === 'string' && path.startsWith('http')) {
        path = {
          url: path,
          headers: {'User-Agent': self.common.ua},
        };
      }
      return Jimp.read(path).catch((err) => {
        if (fromCache) {
          self.error(`Failed to read from cache: ${path}`);
          console.error(err);
          fromCache = false;
          return toJimp(url);
        }
      });
    }
  };

  // Util //
  /**
   * Save all game data to file.
   *
   * @override
   * @param {string} [opt='sync'] Can be 'async', otherwise defaults to
   * synchronous.
   * @param {boolean} [wait=false] If requested before subModule is
   * initialized, keep trying until it is initialized.
   */
  this.save = function(opt, wait) {
    if (!self.initialized) {
      if (wait) {
        setTimeout(function() {
          self.save(opt, wait);
        });
      }
      return;
    }
    hg.save(opt);
  };

  /**
   * @description Register an event listener. Handlers are called in order they
   * are registered. Earlier events can modify event data.
   *
   * @public
   * @param {string} evt The name of the event to listen for.
   * @param {Function} handler The function to call when the event is fired.
   */
  this.on = function(evt, handler) {
    if (!eventHandlers[evt]) eventHandlers[evt] = [];
    eventHandlers[evt].push(handler);
  };

  /**
   * Remove an event listener;.
   *
   * @public
   * @param {string} evt The name of the event that was being listened for.
   * @param {Function} handler The currently registered handler.
   */
  this.removeListener = function(evt, handler) {
    if (!eventHandlers[evt]) return;
    const i = eventHandlers[evt].findIndex((el) => el === handler);
    if (i > -1) eventHandlers[evt].splice(i, 1);
  };

  /**
   * Fire an event on all listeners.
   *
   * @private
   * @param {string} evt The event to fire.
   * @param {...*} args Arguments for the event.
   */
  this._fire = function(evt, ...args) {
    if (!eventHandlers[evt]) return;
    eventHandlers[evt].forEach((el) => {
      try {
        el(self, ...args);
      } catch (err) {
        self.error('Caught error during event firing: ' + evt);
        console.error(err);
      }
    });
  };
}

module.exports = new HG();
