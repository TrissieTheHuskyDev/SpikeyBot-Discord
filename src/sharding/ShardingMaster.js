// Copyright 2019-2020 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (web@campbellcrowley.com)
const http = require('http');
const socketIo = require('socket.io');
const Discord = require('discord.js');
const crypto = require('crypto');
const common = require('../common.js');
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;

const usersFile = path.resolve(__dirname + '/../../save/knownShards.json');
const configFile =
    path.resolve(__dirname + '/../../config/shardMasterConfig.js');
const authFile = path.resolve(__dirname + '/../../auth.js');
const shardDir = path.resolve(__dirname + '/../../save/shards/');
const privKeyFile = `${shardDir}/shardMaster.priv`;
const pubKeyFile = `${shardDir}/shardMaster.pub`;

const signAlgorithm = 'RSA-SHA256';
const keyType = 'rsa';
const keyOptions = {
  modulusLength: 4096,
  publicKeyEncoding: {type: 'spki', format: 'pem'},
  privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
};

// TODO: Implement update command which will pull the latest version from github
// across all shards, even if they are not currently in use.

/**
 * @description The master that manages the shards below it. This is what
 * specifies how many shards may start, which shard has which ID, as well as
 * manages inter-shard communication. Shutdown, start, reboot, and update
 * commands may be issued to individual shards with updated information on how
 * they are expected to be configured. Shards are expected to communicate with
 * this master via websockets once they are ready to receive their role.
 * @class
 */
class ShardingMaster {
  /**
   * @description Start the webserver.
   * @param {number} [port=8024] Port to listen for shard connections.
   * @param {string} [address='127.0.0.1'] Address to listen for shard
   * connections.
   * @param {string} [path='/socket.io/'] Path prefix to watch for socket
   * connections.
   */
  constructor(port = 8024, address = '127.0.0.1', path = '/socket.io/') {
    common.begin(false, true);
    common.connectSQL();

    this._serverError = this._serverError.bind(this);
    this._socketConnection = this._socketConnection.bind(this);
    /**
     * @description The string representation of the private key used for
     * signing initial handshake to shard.
     * @see {@link ShardingMaster~_loadMasterKeys}
     * @private
     * @type {?string}
     * @default
     */
    this._privKey = null;
    /**
     * @description The string representation of the public key used for signing
     * initial handshake to shard.
     * @see {@link ShardingMaster~_loadMasterKeys}
     * @private
     * @type {?string}
     * @default
     */
    this._pubKey = null;

    /**
     * @description The timestamp the last time the recommended shard count was
     * requested.
     * @private
     * @type {number}
     * @default
     */
    this._shardNumTimestamp = 0;
    /**
     * @description The number of shards recommended by Discord from our last
     * request.
     * @private
     * @type {number}
     * @default
     */
    this._detectedNumShards = -1;

    /**
     * @description The currently known shards mapped by their name, containing
     * some information about them including their public key.
     * @private
     * @type {?object.<ShardInfo>}
     */
    this._knownUsers = null;
    this._updateUsers();
    fs.watchFile(usersFile, {persistent: false}, (curr, prev) => {
      if (prev.mtime < curr.mtime) this._updateUsers();
    });
    /**
     * @description The current config for sharding.
     * @private
     * @type {?ShardMasterConfig}
     */
    this._config = null;
    this._updateConfig();
    fs.watchFile(configFile, {persistent: false}, (curr, prev) => {
      if (prev.mtime < curr.mtime) this._updateConfig();
    });
    /**
     * @description The current authentication information.
     * @private
     * @type {?object}
     */
    this._auth = null;
    this._updateAuth();
    fs.watchFile(authFile, {persistent: false}, (curr, prev) => {
      if (prev.mtime < curr.mtime) this._updateAuth();
    });

    this._loadMasterKeys();

    /**
     * @description The timestamp at which the next heartbeat event is to fire.
     * @private
     * @type {number}
     * @default
     */
    this._nextHeartbeatTime = Date.now();
    /**
     * @description The timestamp at which the heartbeat interval loop was most
     * recently started. This is used when
     * {@link ShardingMaster.ShardMasterConfig.HeartbeatConfig~disperse} is
     * being used in order to only update one shard for each heartbeat event.
     * @private
     * @type {number}
     * @default
     */
    this._heartbeatLoopStartTime = Date.now();

    /**
     * @description Timeout for heartbeat interval loop.
     * @private
     * @type {?number}
     * @default
     */
    this._hbTimeout = null;

    /**
     * @description History of recent connections ordered by oldest to latest.
     * Each index contains an array of length 2, storing the IP address and the
     * timestamp of a connection attempt. This is used to start ignoring an IP
     * address if too many connection attempts are made within a short time.
     * @private
     * @type {Array.<Array.<string, number>>}
     * @default
     */
    this._ipConnectHistory = [];

    /**
     * Map of all currently connected sockets mapped by socket.id.
     *
     * @private
     * @type {object.<Socket>}
     */
    this._sockets = {};
    /**
     * Map of the currently connected sockets for each shard, mapped by the
     * shard names.
     *
     * @private
     * @type {object.<Socket>}
     */
    this._shardSockets = {};
    /**
     * The socket that the master shard is currently connected on, or null if
     * disconnected.
     *
     * @private
     * @type {?Socket}
     */
    this._masterShardSocket = null;

    /**
     * Webserver instance.
     *
     * @private
     * @type {http.Server}
     */
    this._app = http.createServer(this._handler);
    this._app.on('error', this._serverError);
    /**
     * Socket.io instance.
     *
     * @private
     * @type {socketIo.Server}
     */
    this._io = socketIo(this._app, {path: path});

    this._app.listen(port, address);
    this._io.on('connection', this._socketConnection);
  }

  /**
   * @description Check if key-pair exists for this master. If not, they will be
   * generated, and the newly generated keys will be used.
   * @private
   */
  _loadMasterKeys() {
    fs.readFile(privKeyFile, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          common.log('No keys have been generated yet. Generating some now.');
          ShardingMaster.generateKeyPair((err, pub, priv) => {
            if (err) {
              common.error('Failed to generate keys.');
              console.error(err);
              return;
            }
            this._pubKey = pub.toString();
            this._privKey = priv.toString();
            common.mkAndWrite(
                pubKeyFile, path.dirname(pubKeyFile), pub, (err) => {
                  if (!err) {
                    common.logDebug('Public key created successfully.');
                  } else {
                    common.error('Failed to write public key to file!');
                    console.error(err);
                  }
                });
            common.mkAndWrite(
                privKeyFile, path.dirname(privKeyFile), priv, (err) => {
                  if (err) {
                    common.error('Failed to write private key to file!');
                    console.error(err);
                    return;
                  }
                  fs.chmod(privKeyFile, 0o600, (err) => {
                    if (err) {
                      common.logWarning(
                          'Private key created, but unable to prevent others' +
                          ' from reading the file. Please ensure only the ' +
                          'current user may read and write to: ' + privKeyFile);
                      console.error(err);
                    } else {
                      common.logDebug('Private key created.');
                    }
                  });
                });
          });
        } else {
          common.error('Failed to read private key: ' + privKeyFile);
          console.error(err);
        }
        return;
      }
      if (!data || data.toString().indexOf('PRIVATE KEY') < 0) {
        common.error(
            'Private key appears to be invalid, or does not conform to ' +
            'expected configuration.');
        return;
      }
      this._privKey = data.toString();
    });
    fs.readFile(pubKeyFile, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          common.logWarning(
              'Public key appears to be missing. If you wish to reset the ' +
              'signing keys, remove the private key as well: ' + privKeyFile);
        } else {
          common.error('Failed to read public key: ' + pubKeyFile);
          console.error(err);
        }
        return;
      }
      if (!data || data.toString().indexOf('PUBLIC KEY') < 0) {
        common.error(
            'Public key appears to be invalid, or does not conform to ' +
            'expected configuration.');
        return;
      }
      this._pubKey = data.toString();
    });
  }

  /**
   * @description Update known list of users and their associated keys.
   * @private
   */
  _updateUsers() {
    const file = usersFile;
    fs.readFile(file, (err, data) => {
      if (err) {
        if (err.code !== 'ENOENT') {
          common.error(`Failed to read ${file}`);
          console.error(err);
        } else {
          this._knownUsers = {};
          common.logDebug(`No users to load ${file}`);
          this._refreshShardStatus();
        }
        return;
      }
      try {
        const users = JSON.parse(data);
        this._knownUsers = {};
        const ids = [];
        for (const u in users) {
          if (!u || !users[u]) continue;
          ids.push(u);
          this._knownUsers[u] = ShardingMaster.ShardInfo.from(users[u]);
        }
        common.logDebug(`Updated known users from file: ${ids.join(', ')}`);
        this._refreshShardStatus();
      } catch (err) {
        common.error(`Failed to parse ${file}`);
        console.error(err);
      }
    });
  }
  /**
   * @description Write updated known list of users to disk.
   * @private
   */
  _saveUsers() {
    const file = usersFile;
    const dir = path.dirname(file);
    const serializable = {};
    for (const prop in this._knownUsers) {
      if (!this._knownUsers[prop]) continue;
      serializable[prop] = this._knownUsers[prop].serializable;
    }
    let str;
    try {
      str = JSON.stringify(serializable);
    } catch (err) {
      common.error(`Failed to stringify known users file: ${file}`);
      console.error(err);
      return;
    }
    common.mkAndWrite(file, dir, str, (err) => {
      if (!err) return;
      common.error(`Failed to save known users to file: ${file}`);
      console.error(err);
    });
  }

  /**
   * @description Update the configuration from file.
   * @private
   */
  _updateConfig() {
    const file = configFile;
    delete require.cache[require.resolve(file)];
    try {
      const ShardMasterConfig = require(file);
      this._config = new ShardMasterConfig();
      common.logDebug(`Loaded ${file}`);
      this._refreshShardStatus();
    } catch (err) {
      common.error(`Failed to parse ${file}`);
      console.error(err);
    }
  }

  /**
   * @description Update the authentication tokens from file.
   * @private
   */
  _updateAuth() {
    const file = authFile;
    delete require.cache[require.resolve(file)];
    try {
      this._auth = require(file);
      common.logDebug(`Loaded ${file}`);
      this._refreshShardStatus();
    } catch (err) {
      common.error(`Failed to parse ${file}`);
      console.error(err);
    }
  }

  /**
   * @description The config was changed or may differ from the current setup,
   * attempt to make changes to match the current setup the requested
   * configuration.
   * @private
   */
  _refreshShardStatus() {
    this._setHBTimeout();
    if (!this._knownUsers) return;
    // Total running shards.
    const goal = this.getGoalShardCount();
    if (goal < 0) {
      clearTimeout(this._hbTimeout);
      this._hbTimeout = setTimeout(() => this._refreshShardStatus(), 5000);
      common.logDebug('Attempting to fetch shard count again in 5 seconds.');
      return;
    }
    // Currently available shards we can control.
    const current = this.getCurrentShardCount();
    // Total number of shards that should become available.
    const known = this.getKnownShardCount();
    // Array of references to ShardInfo running with same goal count.
    const correct = this._getCurrentConfigured(goal);
    // Array of references to ShardInfo for each shard not configured correctly.
    const incorrect = this._getCurrentUnconfigured(goal);
    // The missing shard IDs that need to exist.
    const newIds = this._getCurrentUnboundIds(goal);

    const master = this._getMasterUser();

    // Array of shards transitioning from "incorrect" to "correct".
    const configuring = [];

    if (goal > known) {
      this.generateShardConfig();
    }
    if (!master) {
      this.generateShardConfig(true);
    }
    if (goal > current) {
      common.logWarning(
          `${goal} shards are queued to startup but only ${current}` +
          ' shards are available!');
    }

    // const corList =
    //     correct.map((el) =>
    //     `${el.id}(${el.goalShardId}/${el.goalShardCount})`)
    //         .join(', ');
    // common.logDebug(`Correct: ${corList}`);
    // const incorList =
    //     incorrect
    //         .map((el) => `${el.id}(${el.goalShardId}/${el.goalShardCount})`)
    //         .join(', ');
    // common.logDebug(`Incorrect: ${incorList}`);
    // const unboundList = newIds.join(', ');
    // common.logDebug(`Unbound: ${unboundList}`);

    const hbConf = this._config.heartbeat;
    const now = Date.now();

    const foundIds = [];
    correct.sort((a, b) => b.bootTime - a.bootTime);
    for (let i = 0; i < correct.length; ++i) {
      const el = correct[i];

      if (now - el.lastHeartbeat > hbConf.requestRebootAfter &&
          now - el.lastHeartbeat < hbConf.expectRebootAfter) {
        common.logWarning(
            'Shard has not responded for too long, enqueuing shutdown: ' +
            el.id + ' ' + el.goalShardId);
        const s = correct.splice(i, 1)[0];
        i--;
        configuring.push(s);
        s.stopTime = now;
        s.goalShardId = -1;
        s.goalShardCount = -1;
        continue;
      }

      const match = foundIds.find(
          (f) => f.shardId === el.goalShardId && f.count === el.goalShardCount);
      if (match) {
        common.logWarning(
            'Found multiple shards configured the same way! ' +
            'Enqueuing shutdown request: ' + el.id + ' ' + el.goalShardId);
        const s = correct.splice(i, 1)[0];
        i--;
        configuring.push(s);
        s.stopTime = now;
        s.goalShardId = -1;
        s.goalShardCount = -1;
      } else {
        foundIds.push({
          shardId: el.goalShardId,
          count: el.goalShardCount,
        });
        if (el.goalShardId != el.currentShardId ||
            el.goalShardCount != el.currentShardCount) {
          configuring.push(el);
        }
      }
    }

    newIds.forEach((el) => {
      if (incorrect.length <= 0) return;

      const s = incorrect.splice(0, 1)[0];
      configuring.push(s);
      s.bootTime = now;
      s.goalShardId = el;
      s.goalShardCount = goal;
    });

    if (master && master.goalShardId < 0) {
      configuring.push(master);
      master.goalShardId = 1000; // I think this is big enough for a while.
      master.goalShardCount = goal;
    }

    if (now >= this._nextHeartbeatTime) {
      // Send all shutdown requests asap, as they do not have their own
      // timeslot.
      for (let i = 0; i < configuring.length; ++i) {
        if (configuring[i].goalShardId >= 0) continue;
        this._sendHeartbeatRequest(configuring[i]);
        configuring.splice(i, 1);
        i--;
      }

      if (now - hbConf.interval > this._heartbeatLoopStartTime) {
        this._heartbeatLoopStartTime += hbConf.interval;
      }

      if (hbConf.updateStyle === 'pull') {
        if (hbConf.disperse) {
          const updateId = Math.floor(
              ((now - this._heartbeatLoopStartTime) / hbConf.interval) *
              (goal + 1));

          const delta = Math.floor(hbConf.interval / (goal + 1));
          this._nextHeartbeatTime += delta;

          if (updateId >= goal) {
            this._sendHeartbeatRequest(master);
          } else {
            this._sendHeartbeatRequest(updateId);
          }
        } else {
          this._nextHeartbeatTime += hbConf.interval;

          Object.keys(this._knownUsers).forEach((el) => {
            if (el.goalShardId < 0) return;
            this._sendHeartbeatRequest(el);
          });
          this._sendHeartbeatRequest(this._getMasterUser());
        }
      } else {
        this._nextHeartbeatTime += hbConf.interval;
      }

      this._setHBTimeout();
    }
  }
  /**
   * @description Reset the heartbeat timeout interval for refreshing shard
   * statuses.
   * @private
   */
  _setHBTimeout() {
    if (this._hbTimeout) clearTimeout(this._hbTimeout);
    let delta = Date.now() - this._nextHeartbeatTime;
    if (delta < -1000) delta = 5000;
    this._hbTimeout = setTimeout(() => this._refreshShardStatus(), delta);
  }
  /**
   * @description Fetch the current goal number of shards we are attempting to
   * keep alive. Returns -1 if goal has not been set yet, or is otherwise
   * unavailable.
   * @public
   * @returns {number} The number of shards we are attempting to create, -1 if
   * the value is otherwise unknown.
   */
  getGoalShardCount() {
    const now = Date.now();

    if (this._config.autoDetectNumShards) {
      this._config.numShards = this._detectedNumShards;

      if (now - this._config.autoDetectInterval > this._shardNumTimestamp) {
        if (!this._auth) return this._config.numShards;
        const token = this._auth[this._config.botName];

        if (!token) {
          if (this._auth) {
            common.logWarning(
                'Unable to fetch shard count due to no bot token. "' +
                this._config.botName + '"');
          }
          return this._config.numShards;
        }

        this._shardNumTimestamp = now;
        Discord.Util.fetchRecommendedShards(token)
            .then((num) => {
              const updated = this._detectedNumShards !== num;
              if (updated) {
                common.logDebug(
                    'Shard count changed from ' + this._detectedNumShards +
                    ' to ' + num);
                this._detectedNumShards = num;
                this._refreshShardStatus();
              }
            })
            .catch((err) => {
              common.error(
                  'Unable to fetch shard count due to failed request.');
              console.error(err);
            });
      }
    }
    return this._config.numShards;
  }

  /**
   * @description Fetches the current number of shards connected to us that we
   * are controlling.
   * @public
   * @returns {number} The current number of shards we are controlling.
   */
  getCurrentShardCount() {
    if (!this._shardSockets) return 0;
    return Object.keys(this._shardSockets).length;
  }

  /**
   * @description Fetches the current number of shards that we know about and
   * may talk to us.
   * @public
   * @returns {number} The number of shards allowed to startup.
   */
  getKnownShardCount() {
    if (!this._knownUsers) return 0;
    return Object.values(this._knownUsers).filter((el) => !el.isMaster).length;
  }

  /**
   * @description Fetches the current number of shards that are configured for
   * the goal number of shards.
   * @public
   * @param {number} [goal] The goal number of shards. If not specified, {@link
   * getGoalShardCount} will be used.
   * @returns {number} The number of shards configured.
   */
  getCurrentConfiguredCount(goal) {
    return this._getCurrentConfigured(goal).length;
  }

  /**
   * @description Get references to all shards currently configured for the
   * given goal number of shards, and are connected and controllable.
   * @private
   * @param {number} [goal] The goal number of shards. If not specified, {@link
   * getGoalShardCount} will be used.
   * @returns {ShardInfo[]} Array of the shards that are configured correctly
   * and don't need updating.
   */
  _getCurrentConfigured(goal) {
    if (!this._knownUsers) return [];
    if (typeof goal !== 'number' || goal < 0) {
      goal = this.getGoalShardCount();
    }
    const now = Date.now();
    return Object.values(this._knownUsers)
        .filter(
            (el) => !el.isMaster && el.goalShardCount === goal &&
                el.lastHeartbeat >
                    now - this._config.heartbeat.assumeDeadAfter);
  }
  /**
   * @description Get references to all shards currently NOT configured for the
   * given goal number of shards, but ARE connected and controllable.
   * @private
   * @param {number} [goal] The goal number of shards. If not specified, {@link
   * getGoalShardCount} will be used.
   * @returns {ShardInfo[]} Array of the shards that are NOT configured
   * correctly and DO need updating.
   */
  _getCurrentUnconfigured(goal) {
    if (!this._knownUsers) return [];
    if (typeof goal !== 'number' || goal < 0) {
      goal = this.getGoalShardCount();
    }
    const now = Date.now();
    return Object.values(this._knownUsers)
        .filter(
            (el) => !el.isMaster && el.goalShardCount !== goal &&
                el.lastSeen > now - this._config.heartbeat.assumeDeadAfter);
  }
  /**
   * @description Get list of IDs for shards that do not exist, but need to.
   * @private
   * @param {number} [goal] The goal number of shards. If not specified, {@link
   * getGoalShardCount} will be used.
   * @returns {number[]} Array of the shard IDs that need to be configured.
   */
  _getCurrentUnboundIds(goal) {
    if (!this._knownUsers) return [];
    if (typeof goal !== 'number' || goal < 0) {
      goal = this.getGoalShardCount();
    }
    if (goal < 0) return [];
    const ids = [...Array(goal).keys()];
    Object.values(this._knownUsers).forEach((el) => {
      if (el.isMaster) return;
      if (el.goalShardCount === goal) {
        const index = ids.indexOf(el.goalShardId);
        if (index >= 0) {
          ids.splice(index, 1);
        } else {
          common.error(
              'Failed to remove shard ID from list. Are multiple shards using' +
              ' the same ID? (' + el.goalShardId + ')');
        }
      }
    });
    return ids;
  }

  /**
   * @description Get a reference to a ShardInfo object using its shard ID.
   * @private
   * @param {number} shardId The shard ID used by Discord.
   * @returns {?ShardInfo} The matched shard info, or null if it couldn't be
   * found.
   */
  _getShardById(shardId) {
    if (!this._knownUsers) return null;
    return Object.values(this._knownUsers)
        .find((el) => !el.isMaster && el.goalShardId === shardId);
  }
  /**
   * @description Get the master shard from the known users. Assumes only one
   * master exists.
   * @private
   * @returns {?ShardInfo} The matched shard info, or null if it couldn't be
   * found.
   */
  _getMasterUser() {
    if (!this._knownUsers) return null;
    return Object.values(this._knownUsers).find((el) => el.isMaster);
  }

  /**
   * Handler for all http requests. This may get used in the future for API
   * requests. Currently unused and always replies with a "501 Not Implemented"
   * response.
   *
   * @private
   * @param {http.IncomingMessage} req The client's request.
   * @param {http.ServerResponse} res Our response to the client.
   */
  _handler(req, res) {
    res.writeHead(501);
    if (req.method === 'GET') {
      res.end('Not Implemented');
    } else {
      res.end();
    }
  }

  /**
   * Returns the number of connected clients.
   *
   * @public
   * @returns {number} Number of sockets.
   */
  getNumClients() {
    return Object.keys(this._sockets).length;
  }

  /**
   * Handler for a new socket connecting.
   *
   * @private
   * @this bound
   * @param {socketIo~Socket} socket The socket.io socket that connected.
   */
  _socketConnection(socket) {
    const now = Date.now();
    // x-forwarded-for is trusted because the last process this jumps through is
    // our local proxy.
    const ipName = common.getIPName(
        socket.handshake.headers['x-forwarded-for'] ||
        socket.handshake.address);
    this._ipConnectHistory.push([ipName, now]);
    let remove = 0;
    let ipCount = 0;
    let i = 0;
    while (ipCount < this._config.connCount &&
           i < this._ipConnectHistory.length) {
      if (now - this._ipConnectHistory[i][1] >= this._config.connTime) {
        remove = i + 1;
      } else if (ipName === this._ipConnectHistory[i][0]) {
        ipCount++;
      }
      ++i;
    }
    if (remove > 0) {
      this._ipConnectHistory.splice(0, remove);
    }
    if (ipCount >= this._config.connCount) {
      socket.disconnect(true);
      return;
    }
    common.log(
        `Socket    connected (${this.getNumClients()}): ${ipName}`, socket.id);
    this._sockets[socket.id] = socket;

    socket.on('disconnect', (reason) => {
      const num = this.getNumClients() - 1;
      common.log(
          `Socket disconnected (${num})(${reason}): ${ipName}`, socket.id);
      delete this._sockets[socket.id];
      if (socket.userId) delete this._shardSockets[socket.userId];
      if (socket.isMasterShard) this._masterShardSocket = null;
    });

    const shardAuth = socket.handshake.headers['authorization'];
    if (!shardAuth) {
      common.logDebug(
          'Socket attempted connection without authorization header.',
          socket.id);
      socket.disconnect(true);
      return;
    }
    const [userId, userSig, timestamp] = shardAuth.split(',');
    if (!userId || !userSig || !(timestamp * 1)) {
      common.logDebug(
          'Socket attempted connection with invalid authorization header.',
          socket.id);
      socket.disconnect(true);
      return;
    }

    if (!this._knownUsers) {
      common.logDebug(
          'Socket attempted connection before known users were loaded.',
          socket.id);
      socket.disconnect(true);
      return;
    }

    if (!this._knownUsers[userId]) {
      common.logDebug(
          'Socket attempted connection with invalid user ID: ' + userId,
          socket.id);
      socket.disconnect(true);
      return;
    }

    if (this._shardSockets[userId]) {
      common.logWarning(
          'Socket attempted connection ID of shard that is already connected!',
          socket.id);
      socket.disconnect(true);
      return;
    }

    if (Math.abs(timestamp - now) > this._config.tsPrecision) {
      common.logDebug(
          'Socket attempted connection with invalid timestamp header.',
          socket.id);
      socket.disconnect(true);
      return;
    }

    if (!this._privKey) {
      common.logDebug(
          'Socket attempted connection prior to us loading private key.',
          socket.id);
      socket.disconnect(true);
      return;
    }

    const user = this._knownUsers[userId];
    if (!user.key) {
      common.logWarning('User does not have a known public key! ' + userId);
      console.log(user);
      socket.disconnect(true);
      return;
    }
    const verifData = `${userId}${timestamp}`;
    const verify = crypto.createVerify(signAlgorithm);
    verify.update(verifData);
    verify.end();
    let ver = false;
    try {
      ver = verify.verify(user.key, userSig, 'base64');
    } catch (err) {
      common.error('Failed to attempt to verify signature.');
      console.error(verifData, user.key, userSig);
    }
    if (!ver) {
      common.logDebug(
          'Socket attempted connection but we failed to verify signature.',
          socket.id);
      socket.disconnect(true);
      return;
    }

    user.lastSeen = now;
    socket.userId = userId;

    if (user.isMaster && this._masterShardSocket) {
      common.logWarning(
          'Socket attempted connection as a master shard while another master' +
              ' is already connected!',
          socket.id);
      socket.disconnect(true);
      return;
    }

    const sign = crypto.createSign(signAlgorithm);
    const signData = `Look at me, I'm the captain now. ${now}`;
    sign.update(signData);
    sign.end();
    const masterSig = sign.sign(this._privKey, 'base64');
    socket.emit('masterVerification', masterSig, signData);

    if (user.isMaster) {
      socket.isMasterShard = true;
      this._masterShardSocket = socket;
    } else {
      socket.isMasterShard = false;
      this._shardSockets[userId] = socket;
    }
    this._refreshShardStatus();

    socket.on('status', (status) => {
      common.logDebug(`${userId} updated status.`, socket.id);
      user.lastSeen = Date.now();
      try {
        // console.log(userId, ':', status);
        status = ShardingMaster.ShardStatus.from(status);
      } catch (err) {
        common.error(
            `Failed to parse shard status from shard ${userId}`, socket.id);
        console.error(err);
        return;
      }
      if (!user.stats) {
        user.stats = new ShardingMaster.ShardStatus(userId);
      } else {
        if (status.id && status.id !== userId) {
          common.logWarning(
              'User changed ID after handshake! This will be ignored, but ' +
              'should not happen! ' + userId + ' --> ' + status.id);
        }
        user.stats.update(status);
      }
      if (user.stats.goalShardId != user.goalShardId) {
        common.logWarning(
            'Shard goal state is incorrect! ' + user.id + ' Received: ' +
            user.stats.goalShardId + ', expected: ' + user.goalShardId);
      }
      if (this._config.heartbeat.useMessageStats) {
        if (user.stats.messageCountDelta > 0) {
          user.lastHeartbeat = user.lastSeen;
        }
      } else {
        user.lastHeartbeat = user.lastSeen;
      }

      user.currentShardId = user.stats.currentShardId;
      user.currentShardCount = user.stats.currentShardCount;

      if (this._config.heartbeat.updateStyle === 'push') {
        this._sendHeartbeatRequest(user);
      }
      // TODO: Store history of shard status for historic purposes.
    });

    socket.on(
        'broadcastEval', (...args) => this.broadcastEvalToShards(...args));
    socket.on('respawnAll', (...args) => this.respawnAll(...args));
    socket.on('sendSQL', (...args) => this.sendSQL(...args));
  }

  /**
   * @description Broadcast a message to all connected shards.
   * @public
   * @param {string} script Text for each shard to evaluate.
   * @param {Function} cb Callback once all shards have replied. First argument
   * is optional error message, second will be an array of responses, indexed by
   * shard ID.
   */
  broadcastEvalToShards(script, cb) {
    const sockets = Object.entries(this._shardSockets);
    const num = sockets.length;
    const out = new Array(num);
    let numDone = 0;
    let err = null;
    /**
     * @description Fired for each completed response from a shard. Fires the
     * callback once all responses have been received, or an error has been
     * raised.
     * @private
     */
    function done() {
      numDone++;
      if (err && numDone <= num) {
        cb(err);
        numDone = num + 1;
      } else if (numDone == num) {
        cb(null, out);
      }
    }
    sockets.forEach((ent) => {
      const id = this._knownUsers[ent[0]].currentShardId;
      if (id < 0) {
        done();
        return;
      }
      ent[1].emit('evalRequest', script, (error, res) => {
        if (error) {
          err = error;
          done();
          return;
        }
        out[id] = res;
        done();
      });
    });
  }

  /**
   * @description Kills all running shards and respawns them.
   * @param {Function} [cb] Callback once all shards have been rebooted or an
   * error has occurred.
   */
  respawnAll(cb) {
    const list = Object.values(this._knownUsers);
    let i = 0;
    list.forEach((info) => {
      if (info.goalShardId < 0 || info.goalShardId !== info.currentShardId) {
        return;
      }
      const socket = this._shardSockets[info.id];
      if (socket) {
        socket.emit('respawn', i * this._config.respawnDelay);
      } else {
        common.logWarning(
            'Unable to respawn shard #' + info.goalShardId + ' ' + info.id +
            ' due to socket disconnect.');
        // TODO: Resend this request once reconnected instead of failing.
      }
      i++;
    });
    cb();
  }

  /**
   * @description Send an SQL query to our database.
   * @public
   * @param {string} query The query to send to database.
   * @param {Function} cb First argument is optional error, otherwise query
   * response.
   */
  sendSQL(query, cb) {
    if (!global.sqlCon) {
      cb('No Database Connection');
      return;
    }
    global.sqlCon.query(query, cb);
  }

  /**
   * @description Generates a key pair using configured settings for either the
   * master or its shards. The settings used cannot differ between any parties
   * involved, otherwise all keys must be changed.
   *
   * @see {@link
   * https://nodejs.org/api/crypto.html#crypto_crypto_generatekeypair_type_options_callback}
   *
   * @public
   * @static
   * @param {Function} cb Callback with optional error, then public key, then
   * private key.
   */
  static generateKeyPair(cb) {
    crypto.generateKeyPair(keyType, keyOptions, cb);
  }

  /**
   * @description Generate a unique name for a new shard.
   * @private
   * @returns {string} New unique shard name.
   */
  _generateShardName() {
    const alp = 'abcdefghijklmnopqrstuvwxyz';
    const len = 3;
    let out;
    do {
      out = '';
      for (let i = 0; i < len; ++i) {
        out += alp[Math.floor(Math.random() * alp.length)];
      }
    } while (this._knownUsers[out]);
    return out;
  }

  /**
   * @description Creates a configuration for a new shard. This config contains
   * the shard's key-pair, name, and the host information to find this
   * master. This file will be saved directly to disk, as well as emailed to
   * sysadmins.
   * @public
   * @param {boolean} [isMaster=false] Is this config for a master shard.
   */
  generateShardConfig(isMaster = false) {
    const made = new ShardingMaster.ShardInfo(this._generateShardName());
    this._knownUsers[made.id] = made;
    if (isMaster) made.isMaster = true;
    ShardingMaster.generateKeyPair((err, pub, priv) => {
      if (err) {
        delete this._knownUsers[made.id];
        common.error('Failed to generate key-pair!');
        console.error(err);
        ShardingMaster._sendShardCreateFailEmail(
            this._config.mail, 'Failed to generate key-pair!', err);
        return;
      }
      made.key = pub;
      const config = {
        host: (isMaster && this._config.masterHost) || this._config.remoteHost,
        pubKey: pub,
        privKey: priv,
        masterPubKey: this._pubKey,
        id: made.id,
        signAlgorithm: signAlgorithm,
      };
      const dir = shardDir;
      const file = `${shardDir}/shard_${made.id}_config.json`;
      const str = JSON.stringify(config, null, 2);
      common.mkAndWrite(file, dir, str, (err) => {
        if (err) {
          common.error('Failed to save new shard config to disk: ' + file);
          console.error(err);
          delete this._knownUsers[made.id];
          ShardingMaster._sendShardCreateFailEmail(
              this._config.mail,
              'Failed to save new shard config to disk: ' + file, err);
        } else {
          ShardingMaster._sendShardCreateEmail(this._config.mail, file, made);
          this._saveUsers();
        }
      });
    });
  }

  /**
   * @description Send the newly created config to sysadmins.
   * @private
   * @static
   * @param {ShardingMaster.ShardMasterConfig.MailConfig} conf Mail config
   * object.
   * @param {string} filename The path to the file of the shard's configuration
   * to send to sysadmins.
   * @param {ShardingMaster.ShardInfo} [info] Shard info of created shard for
   * additional information to sysadmins.
   */
  static _sendShardCreateEmail(conf, filename, info) {
    if (!conf.enabled) return;
    const str = conf.shardConfigCreateMessage.replace(/{(\w+)}/g, (m, one) => {
      switch (one) {
        case 'date':
          return new Date().toString();
        case 'id':
          return info && info.id || one;
        case 'pubkey':
          return info && info.key || one;
        default:
          return one;
      }
    });
    const args = conf.args.map((el) => {
      if (el === '%ATTACHMENT%') return filename;
      return el;
    });
    ShardingMaster._sendEmail(conf.command, args, conf.spawnOpts, str);
  }

  /**
   * @description Send an email to sysadmins alerting them that a new shard must
   * be created, but we were unable to for some reason.
   * @private
   * @static
   * @param {ShardingMaster.ShardMasterConfig.MailConfig} conf Mail config
   * object.
   * @param {...Error|string} [errs] The error generated with information as to
   * why creation failed.
   */
  static _sendShardCreateFailEmail(conf, ...errs) {
    if (!conf.enabled) return;
    const str = conf.shardConfigCreateFailMessage.replace(/{\w+}/g, (m) => {
      switch (m) {
        case 'date':
          return new Date().toString();
        case 'errors':
          return errs.map((err) => {
            if (err instanceof Error) {
              return `${err.code}: ${err.message}\n${err.stack}`;
            } else if (typeof err === 'string') {
              return err;
            } else {
              return JSON.stringify(err, null, 2);
            }
          }).join('\n\n===== ERROR SPLIT =====\n\n');
        default:
          return m;
      }
    });
    ShardingMaster._sendEmail(conf.command, conf.failArgs, conf.spawnOpts, str);
  }

  /**
   * @description Sends an email given the raw inputs.
   * @private
   * @static
   * @param {string} cmd The command to run to start the mail process.
   * @param {string[]} args The arguments to pass.
   * @param {object} opts Options to pass to spawn.
   * @param {string} stdin The data to write to stdin of the process.
   */
  static _sendEmail(cmd, args, opts, stdin) {
    const proc = spawn(cmd, args, opts);
    proc.on('error', (err) => {
      common.error('Failed to spawn mail process.');
      console.error(err);
    });
    proc.stderr.on('data', (data) => {
      common.logWarning(`Mail: ${data.toString()}`);
    });
    proc.stdout.on('data', (data) => {
      common.logDebug(`Mail: ${data.toString()}`);
    });
    proc.on('close', (code) => {
      common.logDebug('Send email. Exited with ' + code);
    });

    if (stdin && stdin.length > 0) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  }

  /**
   * @description Format and send the request for a shard heartbeat.
   * @private
   * @param {number|ShardingMaster.ShardInfo} user Either the goal shard ID, or
   * the shard user information.
   */
  _sendHeartbeatRequest(user) {
    let updating;
    if (typeof user === 'number' && !isNaN(user)) {
      updating = this._getShardById(user);
    } else {
      updating = user;
    }
    if (!updating || !updating.id) {
      const num = typeof user === 'number' ? user : (user && user.goalShardId);
      common.error('Unable to find user for HB with goal shard ID: ' + num);
      return;
    }
    const socket = updating.isMaster ? this._masterShardSocket :
                                       this._shardSockets[updating.id];
    if (!socket) {
      common.logWarning(
          'Failed to send request for heartbeat to shard ' + updating.id +
          (updating.isMaster ? ' MASTER' : ''));
    } else {
      const req = updating.request();
      req.config = {
        botName: this._config.botName,
        nodeArgs: this._config.shardNodeLaunchArgs,
        botArgs: this._config.shardBotLaunchArgs,
        heartbeat: {
          updateStyle: this._config.heartbeat.updateStyle,
          interval: this._config.heartbeat.interval,
          expectRebootAfter: this._config.heartbeat.expectRebootAfter,
          assumeDeadAfter: this._config.heartbeat.assumeDeadAfter,
        },
      };
      socket.emit('update', req);
      common.logDebug('Sent heartbeat request to ' + updating.id);
    }
  }

  /**
   * @description Server has encountered an error, and must close.
   * @private
   * @this bound
   * @param {Error} err The emitted error event.
   */
  _serverError(err) {
    if (this._io) this._io.close();
    if (this._app) this._app.close();
    if (err.code === 'EADDRINUSE') {
      common.error(
          'ShardMaster failed to bind to port because it is in use. (' +
          err.port + ')');
    } else {
      common.error('ShardMaster failed for unknown reason.');
      console.error(err);
    }
    process.exit(1);
  }

  /**
   * @description Cleanup and fully shutdown gracefully.
   * @public
   */
  exit() {
    if (this._hbTimeout) clearTimeout(this._hbTimeout);
    if (this._io) this._io.close();
    if (this._app) this._app.close();
    fs.unwatchFile(usersFile);
    fs.unwatchFile(configFile);
    fs.unwatchFile(authFile);
    process.exit(0);
  }
}

try {
  ShardingMaster.ShardMasterConfig = require(configFile);
} catch (err) {
  // Meh.
}
ShardingMaster.ShardStatus = require('./ShardStatus.js');
ShardingMaster.ShardInfo = require('./ShardInfo.js');

if (require.main === module) {
  console.log('Started via CLI, booting up...');
  const manager =
      new ShardingMaster(process.argv[2], process.argv[3], process.argv[4]);

  process.on('SIGINT', manager.exit);
  process.on('SIGTERM', manager.exit);
}

module.exports = ShardingMaster;