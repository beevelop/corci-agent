/**
 * @name Cordova
 * @version 0.1.0
 * @fileoverview cordova specific build process
 */

var path = require('path');
var libs = require('corci-libs');
var Logger = libs.Logger;
var Common = libs.Common;
var P = Common.Promise;
var fs = Common.fsExtra;

var spawn = require('child_process').spawn;

function Cordova(task, captain) {
    this._buildTask = task;
    this._captain = captain;
}

Cordova.prototype.getBuildTask = function () {
    return this._buildTask;
};

Cordova.prototype.getBuildFolder = function () {
    return this.getBuildTask().getBuildFolder();
};

Cordova.prototype.getPlatform = function () {
    return this.getBuildTask().getAgent().getPlatform();
};

Cordova.prototype.callHook = function (name, args) {
    var startHook = P.resolve.apply(P, args || []);
    if (typeof this._captain[name] === 'function') {
        var hook = this._captain[name].bind(this._captain);
        return startHook.then(hook);
    }

    return startHook;
};

Cordova.prototype.init = function () {
    var _this = this;
    return this.callHook('onInit')
        .bind(this)
        .then(this.ensurePlatform)
        .catch(function (err) {
            _this.getBuildTask().addLogs(err);
            Logger.error('Could not ensure platform.', err);
            throw err; // don't swallow
        })
        .then(function () {
            return _this.callHook('onFilesDone');
        })
        .then(this.deleteHooks)
        .catch(function (err) {
            _this.getBuildTask().addLogs(err);
            Logger.error('Could not delete hooks!', err);
        })
        .then(function () {
            return _this.callHook('preBuild');
        })
        .then(this.runCordovaBuild)
        .catch(function (err) {
            _this.getBuildTask().addLogs(err);
            Logger.error('Failed building cordova: ', err);
            throw err;
        })
        .then(function (stdout) {
            _this.getBuildTask().addLogs(stdout);
            Logger.silly(stdout);
        })
        .then(function () {
            return _this.callHook('onBuildDone');
        });
};

Cordova.prototype.ensurePlatform = function () {
    var platformDir = path.resolve(this.getBuildFolder(), 'platforms', this.getPlatform());

    var _this = this;
    return fs.existsAsync(platformDir).then(function (exists) {
        if (exists) {
            return true;
        }
        return _this.addPlatform();
    });
};

Cordova.prototype.addPlatform = function () {
    var platform = this.getPlatform();
    var args = ['platform', 'add', platform];
    var _this = this;
    return this.spawnCmd('cordova', args, this.getBuildFolder())
        .then(function (stdout) {
            _this.getBuildTask().addLogs(stdout);
        })
        .catch(function (err) {
            Logger.error('Failed adding platform "%s"', platform, err);
            throw err;
        });
};

Cordova.prototype.deleteHooks = function () {
    var hooks = path.resolve(this.getBuildFolder(), 'hooks');
    return fs.removeAsync(hooks);
};

Cordova.prototype.runCordovaBuild = function () {
    var args = ['build', this.getPlatform(), '--release'];
    return this.spawnCmd('cordova', args, this.getBuildFolder());
};

Cordova.prototype.spawnCmd = function (command, args, cwd) {
    return new P(function (resolve, reject) {
        var child = spawn(command, args, {
            cwd: cwd || './',
            env: process.env
        });

        var stdout = '';
        var stderr = '';
        child.stdout.on('data', function (buf) {
            stdout += buf;
        });
        child.stderr.on('data', function (buf) {
            stderr += buf;
        });

        child.on('close', function () {
            if (stderr.length > 0) {
                reject(stderr);
            } else {
                resolve(stdout);
            }
        });
    });
};

module.exports = Cordova;