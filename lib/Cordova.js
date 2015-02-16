/**
 * @name Cordova
 * @version 0.1.0
 * @fileoverview cordova specific build process
 */

var libs = require('corci-libs');
var Logger = libs.Logger;
var BuildProcess = require('./BuildProcess');

function Cordova(bupro, captain) {
    this._bupro = bupro;
    this._captain = captain;
}

Cordova.prototype.getBuildProcess = function () {
    return this._bupro;
};

Cordova.prototype.getBuildfolder = function () {
    return this.getBuildProcess().getBuildfolder();
};

Cordova.prototype.getPlatform = function () {
    return this.getBuildProcess().getAgent().getPlatform();
};

Cordova.prototype.callHook = function (name, args) {
    var startHook = P.resolve.apply(P, args || []);
    if (typeof this._captain[name] === 'function') {
        return startHook.then(this._captain[name].bind(this._captain)).then(function () {
            Logger.verbose('Hook "%s" called', name);
        });
    }

    return startHook;
};

Cordova.prototype.init = function () {
    var _this = this;
    return this.callHook('onInit')
        .then(this.ensurePlatform().bind(this))
        .catch(function (err) {
            //@todo: buildlogger
            Logger.error('Could not ensure platform.', err);
            throw err; // don't swallow
        })
        .then(function () {
            return _this.callHook('onFilesDone');
        })
        .then(this.deleteHooks().bind(this))
        .catch(function (err) {
            //@todo: buildLogger
            Logger.error('Could not delete hooks!', err);
        })
        .then(function () {
            //@todo: build + command doesnt exist anymore
            return _this.callHook('preBuild');
        })
        .then(this.runCordovaBuild.bind(this))
        .catch(function (err) {
            //@todo: buildLogger
            Logger.error('Failed building cordova.', err);
        })
        .then(function () {
            return _this.callHook('onBuildDone');
        });

    //@todo: then what?
};

Cordova.prototype.ensurePlatform = function () {
    var platformDir = path.resolve(this.getBuildfolder(), 'platforms', this.getPlatform());

    var _this = this;
    return fs.existsAsync(platformDir).then(function (exists) {
        if (exists) {
            return _this.call('filesDone');
        }
        return _this.addPlatform();
    });
};

Cordova.prototype.addPlatform = function () {
    var args = ['platform', 'add', this.getPlatform()];
    return BuildProcess.spawn('cordova', args, this.getBuildfolder())
        .then(function (stdout) {
            //@todo: buildlogger
        })
        .catch(function (err) {
            //@todo: buildlogger
            throw e;
        });
};

Cordova.prototype.deleteHooks = function () {
    var hooks = path.resolve(this.getBuildfolder(), 'hooks');
    return fs.removeAsync(hooks);
};

Cordova.prototype.runCordovaBuild = function () {
    var args = ['build', this.getPlatform(), '--release'];
    return BuildProcess.spawn('cordova', args, this.getBuildfolder());
};