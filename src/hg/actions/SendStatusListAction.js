// Copyright 2019 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)
const ChannelAction = require('./ChannelAction.js');

/**
 * @description Sends message announcing the status of the players in the game.
 *
 * @memberof HungryGames~Action
 * @inner
 * @augments HungryGames~Action~ChannelAction
 */
class SendStatusListAction extends ChannelAction {
  /**
   * @description Create an action that will send a message to the game channel
   * saying the status of the players in the game.
   */
  constructor() {
    super((hg, game, channel) => {
      if (game.options.teamSize > 0) hg._parent.sortTeams(game);
      const current = game.currentGame;
      let prevTeam = -1;
      let playersToShow = current.includedUsers;
      if (game.options.numDaysShowDeath >= 0 ||
          !game.options.showLivingPlayers) {
        playersToShow = playersToShow.filter((el) => {
          if (!game.options.showLivingPlayers && el.living) return false;
          return el.living || el.state == 'wounded' ||
              (game.options.numDaysShowDeath >= 0 &&
               current.day.num - el.dayOfDeath < game.options.numDaysShowDeath);
        });
      }
      const showDead = playersToShow.find((el) => !el.living);
      const showWounded = playersToShow.find((el) => el.state == 'wounded');

      const emoji = {
        heart: '❤',
        redHeart: '❤️',
        yellowHeart: '💛',
        skull: '💀',
      };

      const finalMessage = new hg._parent.Discord.MessageEmbed();
      finalMessage.setColor([255, 0, 255]);
      finalMessage.setAuthor(
          emoji.redHeart + 'Alive' +
          (showWounded ? (`, ${emoji.yellowHeart}Wounded`) : '') +
          (showDead ? (`, ${emoji.skull}Dead`) : ''));
      let showKills = false;
      const statusList = playersToShow.map(function(obj) {
        let myTeam = -1;
        if (game.options.teamSize > 0) {
          myTeam = current.teams.findIndex((team) => {
            return team.players.findIndex((player) => {
              return player == obj.id;
            }) > -1;
          });
        }
        let symbol = emoji.heart;
        if (!obj.living) {
          symbol = emoji.skull;
        } else if (obj.state == 'wounded') {
          symbol = emoji.yellowHeart;
          /* } else if (obj.state == 'zombie') {
            symbol = emoji.brokenHeart; */
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

        let prefix = '';
        if (myTeam != prevTeam) {
          prevTeam = myTeam;
          prefix = `__${current.teams[myTeam].name}__\n`;
        }

        showKills = showKills || obj.kills > 0;

        return prefix + symbol + '`' + shortName + '`' +
            (obj.kills > 0 ? '(' + obj.kills + ')' : '');
      });
      finalMessage.setTitle(`Status update!${showKills ? ' (kills)' : ''}`);
      if (game.options.teamSize == 0) {
        statusList.sort((a, b) => {
          if (a.startsWith(emoji.skull)) {
            if (!b.startsWith(emoji.skull)) {
              return 1;
            }
          } else if (b.startsWith(emoji.skull)) {
            if (!a.startsWith(emoji.skull)) {
              return -1;
            }
          }
          if (a < b) return -1;
          if (a > b) return 1;
          return 0;
        });
      }
      if (statusList.length >= 5) {
        const numCols =
            hg._parent.calcColNum(statusList.length > 10 ? 3 : 2, statusList);

        const numTotal = statusList.length;
        const quarterLength = Math.ceil(numTotal / numCols);
        for (let i = 0; i < numCols - 1; i++) {
          const thisMessage =
              statusList.splice(0, quarterLength).join('\n').slice(0, 1024);
          finalMessage.addField(
              `${i * quarterLength + 1}-${(i + 1) * quarterLength}`,
              thisMessage, true);
        }
        finalMessage.addField(
            `${(numCols - 1) * quarterLength + 1}-${numTotal}`,
            statusList.join('\n').slice(0, 1024), true);
      } else {
        finalMessage.setDescription(statusList.join('\n') || '...');
      }

      let numWholeTeams = 0;
      let lastWholeTeam = null;
      if (game.options.teamSize > 0) {
        current.teams.forEach((team) => {
          if (team.numAlive > 1 && team.numAlive == team.players.length) {
            numWholeTeams++;
            lastWholeTeam = team;
          }
        });
      }
      if (numWholeTeams == 1) {
        const teamName = lastWholeTeam.name;
        finalMessage.setFooter(
            hg.messages.get('teamRemaining').replace(/\{\}/g, teamName));
      }
      if (game.options.disableOutput) return;
      channel.send(finalMessage).catch((err) => {
        hg._parent.error('Failed to send status list: ' + channel.id);
        console.error(err);
      });
    }, 1000);
  }

  /**
   * @description Create action from save data.
   * @public
   * @static
   * @override
   * @returns {HungryGames~SendStatusListAction} The created action.
   */
  static create() {
    return new SendStatusListAction();
  }
}

module.exports = SendStatusListAction;