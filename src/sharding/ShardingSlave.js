// Copyright 2020 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (web@campbellcrowley.com)
const socketIo = require('socket.io-client');
const common = require('../common.js');
const crypto = require('crypto');
const {fork, exec} = require('child_process');
const path = require('path');
const fs = require('fs');
const auth = require('../../auth.js');

const ShardingMaster = require('./ShardingMaster.js');

const configDir = path.resolve(__dirname + '/../../config/');
const botCWD = path.resolve(__dirname + '/../../');

/**
 * @description The slave that is managed by {@link ShardingMaster}. This does
 * nothing to communicate with Discord until the master has told it to do so.
 * The main purpose of this is to connect and listen to the master for commands
 * and messages. This class must have a config file generated by the master
 * named similarly to `shard_abc_config.json` in the `./config/` directory.
 * @class
 */
class ShardingSlave {
  /**
   * @description Starts the slave, and attempts to connect to the master
   * immediately. Throws errors if setup is incorrect.
   */
  constructor() {
    common.begin(false, true);

    const files = fs.readdirSync(configDir);
    const file = files.find((el) => el.match(common.shardConfigRegex));
    if (!file) {
      throw new Error('Failed to find shard config file required for boot.');
    }
    const data = fs.readFileSync(`${configDir}/${file}`);
    /**
     * @description Parsed config file from disk.
     * @private
     * @type {object}
     * @constant
     */
    this._config = JSON.parse(data);
    /**
     * @description The settings the master has told us to operate with. This
     * includes the botName, heartbeat settings, as well as shard ID and count.
     * Null until a connection is established.
     * @private
     * @type {?object}
     */
    this._settings = null;

    /**
     * @description This slave's ID/Name.
     * @public
     * @type {string}
     * @constant
     */
    this.id = this._config.id;

    common.log(`Shard ${this.id} booting up...`, this.id);
    /**
     * @description The public key of this shard.
     * @public
     * @type {string}
     * @constant
     */
    this.pubKey = this._config.pubKey;
    /**
     * @description The private key identifying this shard.
     * @private
     * @type {string}
     * @constant
     */
    this._privKey = this._config.privKey;

    /**
     * @description The current status information about this shard. This is
     * sent to the master as a heartbeat.
     * @private
     * @type {ShardingMaster.ShardStatus}
     */
    this._status = new ShardingMaster.ShardStatus(this.id);

    /**
     * @description Timeout for respawn request.
     * @private
     * @type {?number}
     * @default
     */
    this._respawnTimeout = null;
    /**
     * @description Timeout to attempt reconnection if no heartbeat request was
     * received from the master (pull), or the timeout until the next heartbeat
     * will be sent (push).
     * @private
     * @type {?number}
     * @default
     */
    this._hbTimeout = null;
    /**
     * @description The timestamp at which the last message from the master was
     * received.
     * @private
     * @type {number}
     * @default
     */
    this._lastSeen = 0;

    /**
     * @description Has the connection to the master been verified. If false,
     * the current connection has not been established to be the correct
     * endpoint. This may not necessarily be a security vulnerability however,
     * as this is a redundant check in addition to the HTTPS websocket
     * connection.
     * @private
     * @type {boolean}
     * @default
     */
    this._verified = false;

    /**
     * @description Ongoing promises for calls to
     * {@link external:Discord}'s Shard#eval, mapped by the script they were
     * called with.
     * @type {Map<string, Promise>}
     * @private
     */
    this._evals = new Map();

    const host = this._config.host;
    const authHeader = this._generateAuthHeader();

    /**
     * @description The socket.io socket used to communicate with the master.
     * @private
     * @type {socketIo.Socket}
     * @constant
     */
    this._socket = socketIo(`${host.protocol}//${host.host}:${host.port}`, {
      path: `${host.path}master/`,
      extraHeaders: {authorization: authHeader},
    });
    this._socket.on('connect', () => this._socketConnected());
    this._socket.on(
        'reconnecting', (...args) => this._socketReconnecting(...args));
    this._socket.on(
        'disconnect', (...args) => this._socketDisconnected(...args));
    this._socket.on(
        'masterVerification', (...args) => this._masterVerification(...args));
    this._socket.on('evalRequest', (...args) => this._evalRequest(...args));
    this._socket.on('update', (...args) => this._updateRequest(...args));
    this._socket.on('respawn', (...args) => this._respawnChild(...args));
    this._socket.on('writeFile', (...args) => this._receiveMasterFile(...args));
    this._socket.on('getFile', (...args) => this._sendMasterFile(...args));
    this._socket.on(
        'connect_error', (...args) => this._socketConnectError(...args));
    this._socket.on(
        'connect_timeout', (...args) => this._socketConnectError(...args));
    this._socket.on('error', (...args) => this._socketConnectError(...args));
  }
  /**
   * @description Socket connected fail event handler.
   * @private
   * @param {...*} [args] Error arguments.
   */
  _socketConnectError(...args) {
    common.error('Failed to connect to master.', this.id);
    console.error(...args);
    this._socket.io.opts.extraHeaders.authorization =
        this._generateAuthHeader();
    // this._socket.connect();
  }

  /**
   * @description Socket connected event handler.
   * @private
   * @param {number} attempt The reconnection attempt number.
   */
  _socketReconnecting(attempt) {
    common.log(
        `Socket reconnecting to master... (Attempt: #${attempt})`, this.id);
    this._socket.io.opts.extraHeaders.authorization =
        this._generateAuthHeader();
  }

  /**
   * @description Socket connected event handler.
   * @private
   */
  _socketConnected() {
    common.log('Socket connected to master', this.id);
    this._reconnectTimeout = null;
  }
  /**
   * @description Socket disconnected event handler.
   * @private
   * @param {string} reason Either ‘io server disconnect’, ‘io client
   * disconnect’, or ‘ping timeout’.
   */
  _socketDisconnected(reason) {
    common.log(`Socket disconnected from master (${reason})`, this.id);
    this._socket.io.opts.extraHeaders.authorization =
        this._generateAuthHeader();
    if (this._verified && !this._reconnectTimeout &&
        reason === 'io server disconnect') {
      this._reconnectTimeout = setTimeout(() => {
        if (!this._socket.connected) {
          this._socket.disconnect();
          this._socket.connect();
        }
        this._socket.reconnection(true);
      }, 3000);
    }
    this._verified = false;
  }
  /**
   * @description Verify that we are connecting to the master we expect.
   * @private
   * @param {string} sig The signature.
   * @param {string} data The message sent that was signed.
   */
  _masterVerification(sig, data) {
    this._lastSeen = Date.now();
    const verify = crypto.createVerify(this._config.signAlgorithm);
    verify.update(data);
    verify.end();
    if (!verify.verify(this._config.masterPubKey, sig, 'base64')) {
      common.logWarning('Failed to verify signature from Master!', this.id);
    } else {
      this._verified = true;
      common.log('Verified signature from master successfully.', this.id);
    }
  }
  /**
   * @description Master has requested shard evaluates a script.
   * @private
   * @param {string} script Script to evaluate on the shard.
   * @param {Function} cb Callback function with optional error, otherwise
   * success message is second parameter.
   */
  _evalRequest(script, cb) {
    this._lastSeen = Date.now();
    if (!this._child) {
      cb('Not Running');
      return;
    }
    if (this._evals.has(script)) {
      this._evals.get(script)
          .then((res) => cb(null, res))
          .catch((err) => cb(err));
      return;
    }
    const promise = new Promise((resolve, reject) => {
      const listener = (message) => {
        if (!message || message._eval !== script) return;
        this._child.removeListener('message', listener);
        this._evals.delete(script);
        if (!message._error) {
          resolve(message._result);
        } else {
          reject(message._error);
        }
      };

      this._child.on('message', listener);

      this._child.send({_eval: script}, (err) => {
        if (!err) return;
        this._child.removeListener('message', listener);
        this._evals.delete(script);
        reject(err);
      });
    });
    this._evals.set(script, promise);
    promise.then((res) => cb(null, res)).catch((err) => cb(err));
  }
  /**
   * @description Trigger the child process to be killed and restarted.
   * @private
   * @param {number} [delay] Time to wait before actually respawning in
   * milliseconds.
   */
  _respawnChild(delay) {
    if (!this._respawnTimeout && delay) {
      this._respawnTimeout = setTimeout(() => this._respawnChild(), delay);
      return;
    }
    clearTimeout(this._respawnTimeout);
    if (this._child && this._status.stopTime > this._status.startTime &&
        Date.now() - this._status.stopTime > 5000) {
      common.logWarning('Child failed to shutdown! Forcefully killing...');
      this._child.kill('SIGKILL');
    } else if (this._child) {
      this._child.kill('SIGTERM');
      this._status.stopTime = Date.now();
    } else if (this._status.goalShardId >= 0) {
      this._spawnChild();
    }
  }
  /**
   * @description Master has sent a status update, and potentially expects a
   * response.
   * @private
   * @param {string} settings Current settings for operation as JSON parsable
   * string.
   */
  _updateRequest(settings) {
    this._lastSeen = Date.now();
    common.logDebug(
        'New settings received from master: ' + JSON.stringify(settings),
        this.id);
    if (!settings || typeof settings !== 'object') return;
    this._settings = settings;
    const s = this._status;
    s.goalShardId = settings.id;
    s.goalShardCount = settings.count;
    s.isMaster = settings.master || false;

    if (s.currentShardId != s.goalShardId ||
        s.currentShardCount != s.goalShardCount) {
      if (s.goalShardId < -1) {
        this.exit();
        return;
      } else if (s.currentShardId >= 0) {
        this._respawnChild();
      } else {
        this._spawnChild();
      }
    }
    if (this._settings.config.heartbeat.updateStyle === 'pull') {
      this._generateHeartbeat();
    }
    this._hbTimeoutHandler();
    // TODO: Implement 'push' update style event loop.
  }

  /**
   * @description Handler for {@link _hbTimeout}.
   * @private
   */
  _hbTimeoutHandler() {
    clearTimeout(this._hbTimeout);
    const style = this._settings.config.heartbeat.updateStyle;
    const extend = style === 'pull';
    const delay =
        this._settings.config.heartbeat.interval * (extend ? 1.5 : 1.0);
    this._hbTimeout = setTimeout(() => this._hbTimeoutHandler(), delay);

    const deathDelta = this._settings.config.heartbeat.assumeDeadAfter;
    const rebootDelta = this._settings.config.heartbeat.requestRebootAfter;

    if (style === 'push') {
      this._generateHeartbeat();
    } else if (
      style === 'pull' && Date.now() - this._lastSeen > rebootDelta &&
        this._status.goalShardId >= 0 && this._verified) {
      this._socket.disconnect();
      this._socket.reconnecting(true);
    } else if (
      style === 'pull' && Date.now() - this._lastSeen > deathDelta &&
        this._status.goalShardId >= 0) {
      common.logWarning(
          'No message has been received from ShardingMaster for too ' +
              'long, rebooting.',
          this.id);
      this.exit();
    }
  }

  /**
   * @description Spawn the child process with the current settings available.
   * @private
   */
  _spawnChild() {
    if (this._status.goalShardId < 0) return;
    if (this._child) return;
    common.log('Spawning child shard #' + this._status.goalShardId, this.id);
    this._status.reset();
    const botFullName =
        this._settings.master ? 'master' : this._settings.config.botName;
    const botName =
        ['release', 'dev'].includes(botFullName) ? null : botFullName;
    const env = Object.assign({}, process.env, {
      SHARDING_MANAGER: true,
      SHARDING_MANAGER_MODE: 'process',
      SHARDING_SLAVE: !this._settings.master,
      SHARDING_MASTER: this._settings.master,
      SHARDING_NAME: this.id,
      SHARDS: this._status.goalShardId,
      SHARD_COUNT: this._status.goalShardCount,
      DISCORD_TOKEN: auth[botFullName],
    });
    this._status.currentShardId = this._status.goalShardId;
    this._status.currentShardCount = this._status.goalShardCount;
    if (!this._settings.config.botArgs) this._settings.config.botArgs = [];
    if (botName) {
      const index = this._settings.config.botArgs.findIndex(
          (el) => el.match(/--botname=(\w+)$/));
      if (index >= 0) {
        this._settings.config.botArgs[index] = `--botname=${botName}`;
      } else {
        this._settings.config.botArgs.push(`--botname=${botName}`);
      }
    }
    if (this._settings.master &&
        !this._settings.config.botArgs.includes('--nologin')) {
      this._settings.config.botArgs.push('--nologin');
    }
    this._child = fork('src/SpikeyBot.js', this._settings.config.botArgs, {
      execArgv: this._settings.config.nodeArgs || [],
      env: env,
      cwd: botCWD,
      detached: false,
    });
    this._child.on('error', (...args) => this._handleError(...args));
    this._child.on('exit', (...args) => this._handleExit(...args));
    this._child.on('message', (...args) => this._childMessage(...args));
    this._status.startTime = Date.now();
  }

  /**
   * @description We received a file from the sharding master that it intends
   * for us to write to disk at the given filename relative to the project root.
   *
   * @private
   * @param {string} filename Filename relative to project directory.
   * @param {string|Buffer} data The data to write to the file.
   */
  _receiveMasterFile(filename, data) {
    this._lastSeen = Date.now();
    const file = path.resolve(`${botCWD}/${filename}`);
    if (!file.startsWith(botCWD)) {
      this.logWarning('Master sent file outside of project directory: ' + file);
      return;
    }
    common.mkAndWrite(file, null, data, (err) => {
      if (err) {
        common.error(`Failed to write file from master to disk: ${file}`);
        console.error(err);
      } else {
        common.logDebug(`Wrote file from master to disk: ${file}`);
      }
    });
  }

  /**
   * @description Sharding master has requested one of our files.
   *
   * @private
   * @param {string} filename Filename relative to project directory.
   * @param {Function} cb Callback to send the error or file back on.
   */
  _sendMasterFile(filename, cb) {
    this._lastSeen = Date.now();
    const file = path.resolve(`${botCWD}/${filename}`);
    if (!file.startsWith(botCWD)) {
      common.logWarning(
          'Master requested file outside of project directory: ' + file);
      cb(null);
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        common.error('Failed to read file that master requested disk: ' + file);
        console.error(err);
        cb(null);
      } else {
        common.logDebug('Sending file to master from disk: ' + file);
        cb(data);
      }
    });
  }

  /**
   * @description Handle an error during spawning of child.
   * @private
   * @param {Error} err Error emitted by EventEmitter.
   */
  _handleError(err) {
    this._child = null;
    common.error('Failed to fork child process!', this.id);
    console.error(err);
    this._status.goalShardId = -1;
    this._status.goalShardCount = -1;
    this._status.currentShardId = -1;
    this._status.currentShardCount = -1;
  }
  /**
   * @description Handle the child processes exiting.
   * @private
   * @param {number} code Process exit code.
   * @param {string} signal Process kill signal.
   */
  _handleExit(code, signal) {
    common.log('Child exited with code ' + code + ' (' + signal + ')', this.id);
    this._child = null;
    this._status.currentShardId = -1;
    this._status.currentShardCount = -1;
    if (this._status.goalShardId >= 0) this._spawnChild();
  }

  /**
   * @description Handle a message from the child.
   * @private
   * @param {object} message A parsed JSON object or primitive value.
   */
  _childMessage(message) {
    if (message) {
      if (message._ready) {
        // Shard became ready.
        return;
      } else if (message._disconnect) {
        // Shard disconnected.
        return;
      } else if (message._reconnecting) {
        // Shard attempting to reconnect.
        return;
      } else if (message._sFetchProp) {
        // Shard is requesting a property fetch. I don't use this so I haven't
        // bothered to implement it.
        return;
      } else if (message._sEval) {
        this.broadcastEval(message._sEval, (err, res) => {
          if (err) {
            this._child.send({_sEval: message._sEval, _error: err});
          } else {
            this._child.send({_sEval: message._sEval, _result: res});
          }
        });
        return;
      } else if (message._sRespawnAll) {
        this.respawnAll(() => {});
        return;
      } else if (message._sSQL) {
        // Shard has requested to send a query to our primary database.
        this.sendSQL(message._sSQL, (err, res) => {
          if (err) {
            this._child.send({_sSQL: message._sSQL, _error: err});
          } else {
            this._child.send({_sSQL: message._sSQL, _result: res});
          }
        });
        return;
      } else if (typeof message === 'string' && message.startsWith('reboot')) {
        common.log(`Reboot requested: ${JSON.stringify(message)}`);
        if (!this._socket.connected) {
          common.logWarning(
              'Requested reboot broadcast while disconnected from master!',
              this.id);
        } else {
          this._socket.emit('reboot', message);
        }
        return;
      }
    }
    // common.logDebug(`Shard Message: ${JSON.stringify(message)}`, this.id);
  }

  /**
   * @description Fire a broadcast to all shards requesting eval of given
   * script.
   * @see {@link ShardingMaster~broadcastEvalToShards}
   * @public
   * @param {string} script The script to evaluate.
   * @param {Function} cb Callback once all shards have completed or there was
   * an error. First argument is optional error, second will otherwise be array
   * of responses indexed by shard IDs.
   */
  broadcastEval(script, cb) {
    if (!this._socket.connected) {
      common.logWarning(
          'Requested eval broadcast while disconnected from master!', this.id);
      cb('Disconnected from master!');
      // TODO: Resend this request once reconnected instead of failing.
    } else {
      this._socket.emit('broadcastEval', script, cb);
    }
  }
  /**
   * @description Send an SQL query to the master to run on our database.
   * @see {@link ShardingMaster~sendSQL}
   * @public
   * @param {string} query The query to evaluate.
   * @param {Function} cb First argument is optional error, second will
   * otherwise be response from query.
   */
  sendSQL(query, cb) {
    if (!this._socket.connected) {
      common.logWarning(
          'Requested SQL broadcast while disconnected from master!', this.id);
      cb('Disconnected from master!');
      // TODO: Resend this request once reconnected instead of failing.
    } else {
      this._socket.emit('sendSQL', query, cb);
    }
  }
  /**
   * @description Kills all running shards and respawns them.
   * @see {@link ShardingMaster.respawnAll}
   * @param {Function} [cb] Callback once all shards have been rebooted or an
   * error has occurred.
   */
  respawnAll(cb) {
    if (!this._socket.connected) {
      common.logWarning(
          'Requested Respawn All while disconnected from master!', this.id);
      cb('Disconnected from master!');
      // TODO: Resend this request once reconnected instead of failing.
    } else {
      this._socket.emit('respawnAll', cb);
    }
  }

  /**
   * @description Fetch stats necessary for heartbeat message to the master,
   * then sends the message.
   * @private
   */
  _generateHeartbeat() {
    if (!this._socket.connected) {
      common.logWarning(
          'Heartbeat generation requested, but socket is not connected!',
          this.id);
      return;
    }
    const hbEvalReq = 'this.getStats && this.getStats(true) || null';

    common.logDebug('Attempting to fetch stats for heartbeat...');
    this._evalRequest(hbEvalReq, (...args) => this._hbEvalResHandler(...args));
  }
  /**
   * @description Handler for response to status fetching for a heartbeat
   * request.
   * @private
   * @param {?Error|string} err Optional error message.
   * @param {*} res Response from eval.
   */
  _hbEvalResHandler(err, res) {
    const now = Date.now();
    const s = this._status;
    if (err || !res) {
      common.error('Failed to fetch stats for heartbeat!', this.id);
      console.error(err);
      this._socket.emit('status', s);
      return;
    }

    this._fetchDiskStats((err, stats) => {
      const delta = (s.timestamp > s.startTime) ? now - s.timestamp : 0;
      s.timestamp = now;
      s.timeDelta = delta;
      s.memHeapUsed = res.memory.heapUsed;
      s.memHeapTotal = res.memory.heapTotal;
      s.memRSS = res.memory.rss;
      s.memExternal = res.memory.external;
      if (s.cpuLoad.length !== res.cpus.length) {
        s.cpuLoad = new Array(res.cpus.length);
      }
      res.cpus.forEach((el, i) => {
        const t = el.times;
        let total = 0;
        let prevTotal = 0;
        for (const c in t) {
          if (!c) continue;
          total += t[c];
          prevTotal += (s.cpus[i] || el).times[c];
        }
        const totalDiff = total - prevTotal;
        s.cpuLoad[i] = t.user / totalDiff;
      });
      s.cpus = res.cpus;
      const prevDelta = s.messageCountDelta || 0;
      s.messageCountDelta = (res.numMessages || 0) - (s.messageCountTotal || 0);
      s.messageCountTotal = res.numMessages || 0;
      s.storageUsedTotal = stats.root;
      s.storageUsedUsers = stats.save;

      this._socket.emit('status', s);

      common.logDebug(`Status Message: ${JSON.stringify(s)}`);
      if (this._settings.config.heartbeat.useMessageStats) {
        // common.logDebug(
        //     `Message delta: ${s.messageCountDelta}, Prev: ${prevDelta}`);
        if (prevDelta === 0 && s.messageCountDelta === 0 && !s.isMaster) {
          common.error('No messages received for last two heartbeats!');
          this._respawnChild();
        }
      } else {
        common.logDebug('Heartbeat Sent');
      }
    });
  }

  /**
   * @description Fetch disk storage information about the bot. If a value was
   * unable to be fetched, it will return a `null` value instead of a string.
   * @private
   * @param {Function} cb Callback with first argument as optional error,
   * otherwise the second is an object containing stats about different
   * directories.
   */
  _fetchDiskStats(cb) {
    // cb(null, {});
    // return;
    // // Resolve the absolute path to the project root.
    const root = path.resolve(`${__dirname}/../..`);
    // // Paths relative to project root.
    // const dirs = [
    //   ['save', './save/'],
    //   // ['docs', './docs/'],
    //   // ['img', './img/'],
    //   // ['sounds', './sounds/'],
    //   // ['node_modules', './node_modules/'],
    //   ['root', './'],
    // ];

    const opts = {
      env: null,
      timeout: 5000,
      cwd: root,
    };

    const regex =
        's/^\\S+\\s+([0-9]+\\w)\\s+([0-9]+\\w)\\s+([0-9]+\\w)\\s+([0-9]+%).*' +
        '/\\2\\/\\1 \\4/p';
    exec(`df -h | grep G | sed -rn '${regex}'`, opts, (err, stdout) => {
      if (err) {
        common.logWarning('Failed to fetch save directory size.', this.id);
        console.error(err);
        cb(err);
      } else {
        cb(null, stdout.trim());
      }
    });

    // let numDone = 0;
    // const out = {};

    // /**
    //  * @description Fired at completion of obtaining directory information
    //  for
    //  * each in the `dir` array. Fires callback once all are complete.
    //  * @private
    //  */
    // function done() {
    //   if (++numDone === dirs.length) return;
    //   cb(null, out);
    // }

    // dirs.forEach((el) => {
    //   const name = el[0];
    //   const dir = el[1];
    //   exec(`du -sh ${dir}`, opts, (err, stdout) => {
    //     if (err) {
    //       common.logWarning('Failed to fetch save directory size.', this.id);
    //       console.error(err);
    //       out[name] = null;
    //     } else {
    //       out[name] = stdout.toString().trim().split('\t')[0];
    //     }
    //     done();
    //   });
    // });
  }

  /**
   * @description Generate the string to pass as the `authorization` header
   * during the connection request to the master.
   * @private
   * @returns {string} The string to pass directly to the auth header.
   */
  _generateAuthHeader() {
    const now = Date.now();
    const sign = crypto.createSign(this._config.signAlgorithm);
    const signData = `${this.id}${now}`;
    sign.update(signData);
    sign.end();
    const signature = sign.sign(this._privKey, 'base64');
    return `${this.id},${signature},${now}`;
  }

  /**
   * @description Cleanup and fully shutdown gracefully.
   * @public
   */
  exit() {
    if (this._socket) this._socket.close();
    if (this._status.goalShardId >= 0) {
      this._status.goalShardId = -2;
      this._status.goalShardCount = -2;
    }
    if (this._child) this._child.kill('SIGTERM');

    process.exit(0);
  }
}

if (require.main === module) {
  console.log('Started via CLI, booting up...');
  const slave = new ShardingSlave();

  process.on('SIGINT', (...args) => slave.exit(...args));
  process.on('SIGTERM', (...args) => slave.exit(...args));
}
module.exports = ShardingSlave;
