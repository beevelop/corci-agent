/**
 * @name Agent
 * @version 0.1.0
 * @fileoverview the agent processes builds ordered by the server
 */

var libs = require('corci-libs');
var Common = libs.Common;
var Logger = libs.Logger;
var FileStream = libs.FileStream;

var ios = Common.socket.stream;
var ioc = Common.socket.client;
var path = require('path');

var BuildTask = require('./BuildTask');

/**
 * Initialize the AgentWorker
 *
 * @class
 * @param {Object} conf - command line options
 * @param {*} captain - the agent's platform class (e.g. Android IOS, WP,...)
 */
function Agent(conf, captain) {
    this._AID = Common.getShortID();
    this._captain = captain;
    this._conf = conf;
    this._buildTasks = {};

    this._workfolder = path.resolve(conf.location || 'work');

    this.socket = this.connect(conf.url);
}

Agent.prototype.getAID = function () {
    return this._AID;
};

Agent.prototype.getCaptain = function () {
    return this._captain;
};

Agent.prototype.getPlatform = function () {
    return this.getCaptain().PID;
};

Agent.prototype.getName = function () {
    return this._conf.name;
};

Agent.prototype.getWorkFolder = function () {
    return this._workfolder;
};

Agent.prototype.getBuildTask = function (BID) {
    return this._buildTasks[BID];
};

Agent.prototype.addBuildTask = function (BID, fileCount) {
    this._buildTasks[BID] = new BuildTask(BID, fileCount, this);
    return this;
};

/**
 * Connect to the server (create new socket)
 * and attach listeners
 */
Agent.prototype.connect = function (url) {
    var socket = ioc.connect(url);
    socket.on('connect', this.onConnect.bind(this));

    // Request
    socket.on('hire', this.onHire.bind(this));
    ios(socket).on('transfer', this.onTransfer.bind(this));
    socket.on('cancel', this.onCancelBuild.bind(this));

    // Response
    socket.on('accept', this.onAccept.bind(this));

    // Error-Handling
    socket.on('reconnecting', this.onReconnecting.bind(this));
    socket.on('reconnect', this.onReconnect.bind(this));
    socket.on('disconnect', this.onDisconnect.bind(this));
    socket.on('error', this.onError.bind(this));

    Logger.extendSocket(socket, socket, 'log', {
        mirror: true
    });

    return socket;
};

/**
 * Register to the server
 */
Agent.prototype.onConnect = function () {
    Logger.verbose('Successfully connected to master! Registering now.');
    this.socket.emit('register', this.getAID(), this.getPlatform(), this.getName());
};

Agent.prototype.onHire = function (BID, fileCount) {
    this.addBuildTask(BID, fileCount);
    Logger.agent('Agent has been hired for Build #%s - expecting %d file(s)', BID, fileCount);
    this.socket.emit('accept', BID);
};

Agent.prototype.onTransfer = function (stream, meta, BID) {
    var task = this.getBuildTask(BID);
    var localPath = path.resolve(task.getBuildFolder(), meta.basename);

    var _this = this;
    FileStream.save(stream, localPath)
        .then(function () {
            _this.socket.log.agent('Successfully received file for Build #%s!', BID);
            _this.getBuildTask(BID).addFile(localPath);
        })
        .catch(function (err) {
            _this.socket.log.warn('Could not save file for Build #%s!', BID, err);
            // don't cancel build at this point - might succeed anyway
        })
        .then(function () {
            if (task.hasAllFiles()) {
                _this.runBuildTask(task);
            }
        });
};

Agent.prototype.runBuildTask = function (task) {
    var _this = this;
    task.init()
        .bind(this)
        .then(this.conclude)
        .catch(function (err) {
            task.addLogs(err);
            _this.socket.log.error('BuildProcess for Build #%s failed', task.getBID(), err);
            _this.fail(task.getBID(), err);
        });
};

Agent.prototype.conclude = function (task) {
    var artifacts = task.getArtifacts();
    Logger.info('Finished Build #%s (%s artifacts)', task.getBID(), (artifacts && artifacts.length) || '0');
    this.socket.emit('conclude', task.getBID(), artifacts.length);
};

Agent.prototype.onAccept = function (BID) {
    var artifacts = this.getBuildTask(BID).getArtifacts();
    FileStream.sendAll(this.socket, 'serve', artifacts, BID)
        .then(function () {
            Logger.verbose('Streamed %d artifact(s) to the server', artifacts.length);
        });
};

Agent.prototype.fail = function (BID, err) {
    this.socket.emit('fail', BID, err);
};

Agent.prototype.onReconnecting = function (attempt) {
    Logger.verbose("Reconnecting, attempt #%s", attempt);
};

Agent.prototype.onReconnect = function (attempt) {
    Logger.verbose("Successfully reconnected on attempt #%d", attempt);
};

/**
 * Log socket disconnects
 */
Agent.prototype.onDisconnect = function () {
    Logger.verbose('Agent diconnected! Affected platform: %s', this.getPlatform());
};

/**
 * Log socket errors
 */
Agent.prototype.onError = function (err) {
    Logger.error('Socket reported an error', err);
};

/**
 * Set build status
 */
Agent.prototype.onCancelBuild = function () {
    //@todo: cancel build!
};

module.exports = Agent;