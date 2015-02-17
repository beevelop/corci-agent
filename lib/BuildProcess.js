/**
 * @name BuildProcess
 * @version 0.1.0
 * @fileoverview handles the build process for all platforms
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
function BuildProcess(BID, bufis, agent) {
    this._BID = BID;
    this._bufis = bufis;
    this._agent = agent;
    this._buildfolder = path.resolve(agent.getWorkfolder(), BID);
}

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
    return this.ensureBuildfolder()
        .bind(this)
        .then(this.extractFiles)
        .catch(function (err) {
            //@todo: buildlogger
            Logger.error('Could not initialize BuildProcess', err);
        })
        .then(function () {
            // Captain hooks...
            var cordi = new Cordova(this, this.hireCaptain());
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
    var xtracts = [];
    P.resolve(this.getFiles()).map(function (file) {
        //@todo: log extracting to buildLogger
        var archiver = new Archiver();
        xtracts.push(new P(function (resolve, reject) {
            archiver.extractFull(file, _this.getBuildfolder())
                .then(function () {
                    resolve();
                })
                .catch(function (err) {
                    reject(err);
                });
        }));
    });

    return P.all(xtracts);
};

module.exports = BuildProcess;