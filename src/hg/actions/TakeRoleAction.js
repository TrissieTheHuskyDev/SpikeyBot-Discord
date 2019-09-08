// Copyright 2019 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)
const MemberAction = require('./MemberAction.js');

/**
 * @description Take a role from a member.
 *
 * @memberof HungryGames~Action
 * @inner
 * @augments HungryGames~Action~MemberAction
 */
class TakeRoleAction extends MemberAction {
  /**
   * @description Create an action that will remove a Discord role from a
   * member.
   * @param {external:Discord~Role} role The role to take.
   */
  constructor(role) {
    super((hg, game, member) => {
      if (!member.guild.me.hasPermission('MANAGE_ROLES')) return;
      member.roles.remove(this._role, 'HG Automation').catch(console.error);
    });
    this._role = role;
    this._saveData = {role: role.id};
  }
  /**
   * @description Get role ID of current configured role.
   * @public
   * @returns {string} The current role ID.
   */
  get role() {
    return this._role.id;
  }
  /**
   * @description Update the role with a new value.
   * @public
   * @param {string} rId The ID of the role to set.
   * @returns {?external:Discord~GuildRole} Found role, or null if unable to
   * find role. If unable to find, it will not update the value.
   */
  set role(rId) {
    const newRole = this._role.guild.roles.get(rId);
    if (!newRole) return null;
    this._role = newRole;
    this._saveData.role = newRole.id;
    return newRole;
  }
  /**
   * @description Create action from save data.
   * @public
   * @static
   * @override
   * @param {external:Discord~Client} client Bot client context to get object
   * references.
   * @param {string} id Guild ID this action is for.
   * @param {object} obj The parsed data from file.
   * @returns {?HungryGames~TakeRoleAction} The created action, null if unable
   * to find the given role.
   */
  static create(client, id, obj) {
    const role = client.guilds.get(id).roles.get(obj.role);
    if (!role) return null;
    return new TakeRoleAction(role);
  }
}

module.exports = TakeRoleAction;
