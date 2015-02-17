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

    this._workfolder = path.resolve(conf.location || 'work');
    this._bufis = {};

    this.socket = this.connect(conf.url);
    this.confirmations = 0;
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

    ios(socket).on('transfer', this.onTransfer.bind(this));
    socket.on('transferred', this.onTransferred.bind(this));
    socket.on('confirm', this.onConfirm.bind(this));

    socket.on('cancel', this.onCancelBuild.bind(this));

    socket.on('reconnecting', this.onReconnecting.bind(this));
    socket.on('reconnect', this.onReconnect.bind(this));
    socket.on('disconnect', this.onDisconnect.bind(this));
    socket.on('error', this.onError.bind(this));

    Logger.extendSocket(socket, socket, 'log', {
        mirror: true
    });

    return socket;
};

Agent.prototype.onReconnecting = function (attempt) {
    Logger.verbose("Reconnecting, attempt #%s", attempt);
};

Agent.prototype.onReconnect = function (attempt) {
    Logger.verbose("Successfully reconnected on attempt #%d", attempt);
};

/**
 * Register to the server
 */
Agent.prototype.onConnect = function () {
    Logger.verbose('Successfully connected to master! Registering now.');
    this.socket.emit('register', this.getAID(), this.getPlatform(), this.getName());
};

Agent.prototype.onTransfer = function (stream, meta, BID) {
    var localpath = path.resolve(this.getBuildfolder(BID), meta.basename);

    var _this = this;
    FileStream.save(stream, localpath)
        .then(function () {
            _this.socket.log.agent('Successfully received file for Build #%s!', BID);
            _this.addFile(BID, localpath);
        })
        .catch(function (err) {
            _this.socket.log.warn('Could not save file for Build #%s!', BID, err);
            // @todo: special failed function (cleans workfolder,...)
            _this.socket.emit('status', BuildStatus.failed);
        });
};

Agent.prototype.onTransferred = function (BID) {
    var bufis = this.getFiles(BID);
    var bupro = new BuildProcess(BID, bufis, this);
    var _this = this;
    bupro.init()
        .catch(function (err) {
            //@todo: buildLogger
            Logger.error('BuildProcess failed', err);
        })
        .then(function (artifacts) {
            Logger.info('Finished Build #%s (%s artifacts)', BID, artifacts.length || '0');
            if (artifacts) {
                var files = [];
                artifacts.map(function (artifact) {
                    files.push(path.resolve(_this.getBuildfolder(BID), artifact));
                });
                _this.serve(BID, files);
            } else {
                _this.conclude(BID);
            }
        });
};

Agent.prototype.onConfirm = function (BID) {
    this.confirmations = this.confirmations - 1;
    if (this.confirmations === 0) {
        this.conclude(BID);
    }
};

Agent.prototype.conclude = function (BID) {
    this.socket.emit('conclude', BID);
};

Agent.prototype.serve = function (BID, artifacts) {
    var _this = this;
    var streams = [];
    P.resolve(artifacts).map(function (artifact) {
        streams.push(FileStream.send(_this.socket, 'serve', artifact, BID));
    });

    this.confirmations = artifacts.length;

    P.all(streams).then(function () {
        Logger.verbose('Streaming %d artifact(s) to the server', streams.length);
    });
};

/**
 * Log socket disconnects
 */
Agent.prototype.onDisconnect = function () {
    Logger.verbose('Agent diconnected! Affected platform: %s', this.getPlatform());
};

/**
 * Log socket errors
 *
 * @param {Object} err - error object
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

//@todo: build failed call
// emit('fail', BID, err)

module.exports = Agent;