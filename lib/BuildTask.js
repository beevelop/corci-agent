/**
 * @name BuildTask
 * @version 0.1.0
 * @fileoverview handles the abstracted build task for all platforms
 */

var libs = require('corci-libs');
var Common = libs.Common;
var Logger = libs.Logger;

var Archiver = Common.Archiver;
var fs = Common.fsExtra;
var P = Common.Promise;

var Cordova = require('./Cordova');

var path = require('path');

/**
 * Constructor of the generic build sequence
 * @class
 */
function BuildTask(BID, fileCount, agent) {
    this._BID = BID;
    this._agent = agent;
    this._expectedFileCount = fileCount;
    this._bufis = [];
    this._logs = [];
    this._artifacts = [];
    this._buildFolder = path.resolve(agent.getWorkFolder(), BID);
}

//@todo: add TTL feature to prevent zombie tasks
//       e.g. when the master server tragically dies

BuildTask.prototype.getBID = function () {
    return this._BID;
};

BuildTask.prototype.getBuildFolder = function () {
    return this._buildFolder;
};

BuildTask.prototype.getArtifacts = function () {
    return this._artifacts;
};

BuildTask.prototype.addArtifact = function (artifact) {
    this._artifacts.push(artifact);
    return this;
};

BuildTask.prototype.getFiles = function () {
    return this._bufis;
};

BuildTask.prototype.hasAllFiles = function () {
    return this._expectedFileCount === this.getFiles().length;
};

BuildTask.prototype.addFile = function (localPath) {
    this._bufis.push(localPath);
};

BuildTask.prototype.getAgent = function () {
    return this._agent;
};

BuildTask.prototype.getLogs = function () {
    return this._logs;
};

BuildTask.prototype.addLogs = function (logs) {
    this._logs.push(logs);
    return this;
};

BuildTask.prototype.hireCaptain = function () {
    var Captain = this.getAgent().getCaptain();
    return new Captain(this.getBuildFolder());
};

BuildTask.prototype.init = function () {
    return this.ensureBuildFolder()
        .bind(this)
        .then(this.extractFiles)
        .catch(function (err) {
            this.addLogs(err);
            Logger.error('Could not initialize BuildProcess', err);
            throw err; // don't swallow
        })
        .then(function () {
            // Captain hooks...
            var cordi = new Cordova(this, this.hireCaptain());
            return cordi.init();
        })
        .then(this.addArtifacts)
        .then(function () {
            return P.resolve(this);
        })
        .catch(function (err) {
            this.addLogs(err);
            Logger.error('Cordova-Build has failed', err);
            throw err; // don't swallow either
        });
};

BuildTask.prototype.addArtifacts = function (artifacts) {
    var _this = this;
    artifacts.map(function (artifact) {
        var artifactPath = path.resolve(_this.getBuildFolder(), artifact);
        _this.addArtifact(artifactPath);
    });

    var logFile = path.resolve(this.getBuildFolder(), this.getBID() + '.log');
    return fs.writeFileAsync(logFile, this.getLogs().join('\n'))
        .then(function () {
            _this.addArtifact(logFile);
        });
};

BuildTask.prototype.ensureBuildFolder = function () {
    return fs.ensureDirAsync(this.getBuildFolder());
};

BuildTask.prototype.extractFiles = function () {
    var _this = this;
    var xtracts = [];
    return P.resolve(this.getFiles())
        .map(function (file) {
            _this.addLogs('Extracting ' + file);
            return xtracts.push(_this.extractFile(file, _this.getBuildFolder()));
        }).then(function (xtracts) {
            return P.all(xtracts);
        });
};

BuildTask.prototype.extractFile = function (file, folder) {
    var archiver = new Archiver();
    return new P(function (resolve, reject) {
        archiver.extractFull(file, folder)
            .then(function () {
                resolve();
            })
            .catch(function (err) {
                reject(err);
            });
    });
};

module.exports = BuildTask;