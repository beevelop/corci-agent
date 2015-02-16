/**
 * @name GenericBuild
 * @version 0.1.0
 * @fileoverview handles the build process for all platforms
 */

var libs = require('corci-libs');
var Common = libs.Common;
var Logger = libs.Logger;
var Archiver = libs.Archiver;

var fs = Common.fsExtra;
var P = Common.Promise;

var Cordova = require('./Cordova');

var path = require('path');
var spawn = require('child_process').child;

/**
 * Constructor of the generic build sequence
 * @class
 */
function BuildProcess(BID, bufis, agent) {
    this._BID = BID;
    this._bufis = bufis;
    this._agent = agent;
    this._buildfolder = path.resolve(agent.getWorkfolder(), BID);
}

BuildProcess.spawn = function (command, args, cwd) {
    return new P(function (resolve, reject) {
        var child = spawn(command, args, {
            cwd: cwd || './',
            env: process.env
        });

        child.stdout.on('data', resolve);
        child.stderr.on('data', reject);
    });
};

BuildProcess.prototype.getBID = function () {
    return this._BID;
};

BuildProcess.prototype.getFiles = function () {
    return this._bufis;
};

BuildProcess.prototype.getAgent = function () {
    return this._agent;
};

BuildProcess.prototype.getBuildfolder = function () {
    return this._buildfolder;
};

BuildProcess.prototype.hireCaptain = function () {
    var Captain = this.getAgent().getCaptain();
    return new Captain(this.getBuildfolder());
};

BuildProcess.prototype.init = function () {
    var _this = this;
    return this.ensureBuildfolder()
        .then(this.extractFiles().bind(this))
        .catch(function (err) {
            //@todo: buildlogger
            Logger.error('Could not initialize BuildProcess', err);
        })
        .then(function () {
            // Captain hooks...
            var cordi = new Cordova(_this, _this.hireCaptain());
            return cordi.init();
        })
        .catch(function (err) {
            //@todo: buildLogger
            Logger.error('Build has failed', err);
        });
};

BuildProcess.prototype.ensureBuildfolder = function () {
    return fs.ensureDirAsync(this.getBuildfolder())
        .catch(function (err) {
            //@todo: handle error / log to buildLogger
            throw err;
        });
};

BuildProcess.prototype.extractFiles = function () {
    var _this = this;
    return P.resolve(this.getFiles()).map(function (file) {
        //@todo: log extracting to buildLogger
        return Archiver.extract(file, _this.getWorkfolder());
    });
};

module.exports = BuildProcess;