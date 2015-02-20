/**
 * @name Agent
 * @version 0.1.0
 * @fileoverview the agent processes builds ordered by the server
 */

var libs = require('corci-libs');
var Common = libs.Common;
var Logger = libs.Logger;
var FileStream = libs.FileStream;

var P = Common.Promise;
var ios = Common.socket.stream;
var ioc = Common.socket.client;
var path = require('path');

var BuildProcess = require('./BuildProcess');

/**
 * Initialize the AgentWorker
 *
 * @class
 * @param {Object} conf - command line options
 * @param {Platform} captain - the agent's platform class (e.g. Android IOS, WP,...)
 */
function Agent(conf, captain) {
    this._AID = Common.getShortID();
    this._captain = captain;
    this._conf = conf;
    this._BID = null;

    this._workfolder = path.resolve(conf.location || 'work');
    this._bufis = {};

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

Agent.prototype.setBID = function (BID) {
    this._BID = BID;
};

Agent.prototype.getBID = function () {
    return this._BID;
};

Agent.prototype.getWorkfolder = function () {
    return this._workfolder;
};

Agent.prototype.getBuildfolder = function (BID) {
    return path.resolve(this.getWorkfolder(), BID);
};

Agent.prototype.addFile = function (BID, localpath) {
    this._bufis[BID] = this._bufis[BID] || [];
    this._bufis[BID].push(localpath);
};

Agent.prototype.getFiles = function (BID) {
    return this._bufis[BID];
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

Agent.prototype.onHire = function (BID, filecount) {
    this.filecount = filecount;
    this.setBID(BID);
    Logger.agent('Agent has been hired for Build #%s - expecting %d file(s)', BID, filecount);
    this.socket.emit('accept', BID);
};

Agent.prototype.onTransfer = function (stream, meta) {
    var localpath = path.resolve(this.getBuildfolder(this.getBID()), meta.basename);

    var _this = this;
    FileStream.save(stream, localpath)
        .then(function () {
            _this.socket.log.agent('Successfully received file for Build #%s!', _this.getBID());
            _this.addFile(_this.getBID(), localpath);
        })
        .catch(function (err) {
            _this.socket.log.warn('Could not save file for Build #%s!', _this.getBID(), err);
            // don't cancel build at this point - might succeed anyway
        })
        .then(function () {
            _this.filecount = _this.filecount - 1;
            if (_this.filecount === 0) {
                _this.runBuildProcess();
            }
        });
};

Agent.prototype.runBuildProcess = function () {
    var BID = this.getBID();
    var bufis = this.getFiles(BID);
    var bupro = new BuildProcess(BID, bufis, this);
    bupro.init()
        .bind(this)
        .then(this.conclude)
        .catch(function (err) {
            //@todo: buildLogger
            this.socket.log.error('BuildProcess for Build #%s failed', BID, err);
            this.fail(BID, err);
        });
};

Agent.prototype.conclude = function (artifacts) {
    var BID = this.getBID();
    Logger.info('Finished Build #%s (%s artifacts)', BID, (artifacts && artifacts.length) || '0');
    var files = [];
    if (artifacts) {
        var buildfoler = this.getBuildfolder(BID);
        artifacts.map(function (artifact) {
            files.push(path.resolve(buildfoler, artifact));
        });
    }
    this.artifacts = files;
    this.socket.emit('conclude', BID, files.length);
};

Agent.prototype.onAccept = function () {
    var streams = [];
    FileStream.sendAll(this.socket, 'serve', this.artifacts, this.getBID())
        .then(function () {
            Logger.verbose('Streamed %d artifact(s) to the server', streams.length);
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