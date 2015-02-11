/**
 * @name GenericBuild
 * @version 0.0.1
 * @fileoverview handles the build process for all platforms
 */

var corciLibs = require('corci-libs');
var Common = corciLibs.Common;
var Msg = corciLibs.Msg;
var FileHelper = corciLibs.FileHelper;
var async = Common.async;
var multiGlob = Common.multiGlob;
var fs = Common.fsExtra;
var P = Common.Promise;

var path = require('path');
var exec = require('child_process').exec;
var splice = Array.prototype.splice;

/**
 * Constructor of the generic build sequence
 *
 * @class
 * @param {Build} build - reference to the build object
 * @param {Agent} agent - reference to the agent
 * @param {String} [command] - command to build
 */
function GenericBuild(build, agent, command) {
    this.build = build;
    this.agent = agent;
    this.command = command || "cordova build {0} {1} --{2}";
    this.locationPath = path.resolve(build.locationPath);
    this.files = build.files;
    this.platform = new agent.platform(build, agent);

    this.callHook('init');
}

GenericBuild.prototype.callHook = function (name, args) {
    var startHook = P.resolve.apply(P, args || []);
    if (typeof this.platform[name] === 'function') {
        return startHook.then(this.platform[name].bind(this.platform)).then(function () {
            console.log('\n\n\nHook called: '+name);
        });
    }

    return startHook;
};

/**
 * Launch the generic build sequence
 */
GenericBuild.prototype.launch = function () {
    var _self = this;
    var _agent = this.agent;
    if (_agent.conf.reuseworkfolder) {
        fs.remove(this.locationPath, function (err) {
            if (err) {
                var _msg = 'Error while deleting workfolder:\n{2}';
                _agent.log(_self.build, Msg.debug, _msg, err);
            }
            _agent.ensureWorkFolder(_self.s3WriteFiles.bind(_self));
        });
    } else {
        this.s1Cleanup();
    }
};

/**
 * Report failed build to agent
 */
GenericBuild.prototype.buildFailed = function () {
    splice.call(arguments, 0, 0, this.build);
    return this.agent.buildFailed.apply(this.agent, arguments);
};

/**
 * Clean up the agent's workfolder (according to keep argument)
 */
GenericBuild.prototype.s1Cleanup = function () {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    FileHelper.cleanLastFolders(this.agent.conf.keep, this.agent.workFolder + '/*', this.s1CleanupDone.bind(this));
};

/**
 * Ensure the workfolder (create if not exist) after cleaning up
 *
 * @param {Object} [err] - error object (cleanup failed) or null
 */
GenericBuild.prototype.s1CleanupDone = function (err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    var _agent = this.agent;
    if (err) {
        var _msg = 'Error while cleaning up last {2} folders in AGENT {3} working folder {4}:\n{5}';
        _agent.log(this.build, Msg.debug, _msg, _agent.conf.keep, _agent.conf.platform, _agent.workFolder, err);
    }
    _agent.ensureWorkFolder(this.s2EmptyWorkFolder.bind(this));
};

/**
 * Empty the workfolder
 *
 * @param {Object} [err] - error object or null
 */
GenericBuild.prototype.s2EmptyWorkFolder = function (err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (err) {
        var _msg = 'error creating the working folder {2}\n{3}';
        return this.buildFailed(this.build, _msg, this.agent.workFolder, err);
    }
    var glob = this.locationPath;
    if (!/(\/|\\)$/.test(glob)) {
        glob += '/';
    }
    glob += '*';
    multiGlob.glob(glob, function (err, files) {
        if (err) {
            return this.s3WriteFiles(null);
        }
        async.each(files, function (file, cb) {
            fs.remove(file, function (err) {
                cb(err);
            });
        }, this.s3WriteFiles.bind(this));
    }.bind(this));
};

/**
 * Write files to locationPath
 *
 * @param {Object} [err] - error object (cleaning up failed) or null
 */
GenericBuild.prototype.s3WriteFiles = function (err) {
    var _msg;
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (err) {
        _msg = 'error cleaning the working folder {2}\n{3}';
        return this.buildFailed(_msg, this.agent.workFolder, err);
    }

    _msg = 'the agentworker on {0}'.format(this.build.conf.platform);
    FileHelper.writeFiles(this.locationPath, this.files, _msg, this.s4ProcessFiles.bind(this));
};

/**
 * Process the files (initiate extraction)
 *
 * @param {Object} [err] - error object (writing files failed) or null
 */
GenericBuild.prototype.s4ProcessFiles = function (err) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    //serverUtils.freeMemFiles(this.files);
    if (err) {
        return this.buildFailed('error while saving files on agent worker:\n{2}', err);
    }

    var _msg = 'extracting archives for {2}...';
    this.agent.log(this.build, Msg.info, _msg, this.build.conf.platform);

    async.each(this.files, this.s5ExtractFile.bind(this));
};

/**
 * Extract the files
 *
 * @param {String} item - file object
 */
GenericBuild.prototype.s5ExtractFile = function (item) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }

    var _msg = 'extracting {2} to {3}';
    this.agent.log(this.build, Msg.debug, _msg, item.file, this.locationPath);

    this.agent.archiver.extractArchive.call(this.agent.archiver, this.build, item.file, this.locationPath, {
        cwd: this.agent.workFolder,
        maxBuffer: 20 * 1024 * 1024
    }, this.s6AllFilesExtracted.bind(this));
};

/**
 * Call hook or initiate config modifications after extraction
 *
 * @param {Object} [err] - error object (extraction failed) or null
 */
GenericBuild.prototype.s6AllFilesExtracted = function (err) {

    console.log('\n\n\n######## All files extracted!!!\n\n\n');

    // Final callback after each item has been iterated over.
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (err) {
        return this.buildFailed('error extracting archive files\n{2}', err);
    }

    this.ensurePlatforms();
};

/**
 * Ensure the requested platform does exist
 */
GenericBuild.prototype.ensurePlatforms = function () {
    var _self = this;
    var build = this.build;
    var agent = this.agent;
    var platformDir = path.resolve(this.locationPath, 'platforms', build.conf.platform);

    fs.exists(platformDir, function (exists) {
        if (!exists) {
            agent.log(build, Msg.buildLog, 'Platform directory ({0}) doesnt exist... adding platform!'.format(platformDir));
            _self.addPlatform.call(_self);
        } else {
            agent.log(build, Msg.buildLog, 'Platform directory ({0}) has been found! No need to add platform.'.format(platformDir));
            _self.callHook('filesDone').done(_self.s6ModifyConfigXML.bind(_self));
        }
    });
};

/**
 * Run `cordova add platform` and log results
 */
GenericBuild.prototype.addPlatform = function () {
    var _build = this.build;
    var _self = this;

    var cmd = "cordova platform add {0}".format(_build.conf.platform);
    var cordovaPlatform = exec(cmd, {
        cwd: this.locationPath,
        maxBuffer: 20 * 1024 * 1024
    }, function (err, stdout, stderr) {

        if (stdout) {
            _self.agent.log(_build, Msg.buildLog, 'stdout:\n', stdout);
        }
        if (stderr) {
            _self.agent.log(_build, Msg.error, 'stderror:\n{2}', stderr);
        }
        if (err) {
            _self.agent.log(_build, Msg.error, 'error:\n{2}', err);
        }

        _self.callHook('filesDone').done(_self.s6ModifyConfigXML.bind(_self));
    });

    cordovaPlatform.on('close', function (code) {
        if (_build.conf.status === 'cancelled') {
            return;
        }
        if (code && code !== 1) {
            return _self.buildFailed('child process exited with code ' + code);
        }
    });
};

/**
 * Modify the config.xml (set bundleid)
 *
 * @TODO: document bundleid
 *
 * @param {String} [cmd] - cordova command (can be set by filesDone-Hook)
 */
GenericBuild.prototype.s6ModifyConfigXML = function () {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    var bundleid = this.build.conf[this.build.conf.platform + 'bundleid'] || this.build.conf.bundleid;
    if (bundleid) {
        var configPath = path.resolve(this.build.locationPath, 'config.xml');
        var _msg = 'Changing bundleid to {2} in config.xml';
        this.agent.log(this.build, Msg.info, _msg, bundleid);

        fs.readFile(configPath, 'utf8', function (err, data) {
            if (err) {
                return this.buildFailed('error reading {2}\n{3}', configPath, err);
            }
            var result = data.replace(/<widget id\=(\"|\').*?(\"|\')/g, "<widget id=\"{0}\"".format(bundleid));

            fs.writeFile(configPath, result, 'utf8', function (err) {
                if (err) {
                    var _msg = 'error writing bundleid {2} into {3}\n{4}';
                    return this.buildFailed(_msg, bundleid, configPath, err);
                }
                this.s6DeleteHooks();
            }.bind(this));
        }.bind(this));
    } else {
        this.s6DeleteHooks();
    }
};

/**
 * Delete all cordova hook files and call preCordovaBuild-Hook
 */
GenericBuild.prototype.s6DeleteHooks = function () {
    var hooks = 'hooks/**/*.bat';
    var _self = this;
    multiGlob.glob(hooks, {cwd: _self.agent.workFolder}, function (err, hooks) {
        hooks.forEach(function (file) {
            file = path.resolve(_self.agent.workFolder, file);
            try {
                // @todo: async
                fs.removeSync(file);
            } catch (e) {
                _self.agent.buildFailed(_self.build, e);
            }
        });
    });

    var self = this;
    this.callHook('preCordovaBuild', [this.build, this.command])
        .catch(function (e) {
            self.buildFailed('error starting build\n{2}', e);
        })
        .then(this.s7BuildCordova.bind(this));
};

/**
 * Run cordova build command and save logfiles
 *
 * @param {String} cmd   - custom build command to execute
 * @param {String} args  - additonal arguments for cordova build command
 */
GenericBuild.prototype.s7BuildCordova = function (cmd, args) {
    var _build = this.build;
    var _agent = this.agent;

    var _msg = 'building cordova on {2}...';
    _agent.log(_build, Msg.info, _msg, _build.conf.platform);

    cmd = (cmd || this.command).format(_build.conf.platform, args || '', _build.conf.buildmode || 'release');

    console.log('\n\n'+cmd+'\n\n\n');

    var cordovaBuildProcess = exec(cmd, {
        cwd: this.locationPath,
        env: process.env,
        maxBuffer: 20 * 1024 * 1024
    }, this.s8BuildExecuted.bind(this));

    cordovaBuildProcess.on('close', function (code) {
        if (_build.conf.status === 'cancelled') {
            return;
        }
        if (code && code !== 1) {
            return _agent.buildFailed('child process exited with code ' + code);
        }
    });
};

/**
 * Analyse build command results and report to agent
 *
 * @param {Object} [err]  - error object (build failed) or null
 * @param {String} stdout - full output of the build command
 * @param {String} stderr - error ourput of theb build command
 */
GenericBuild.prototype.s8BuildExecuted = function (err, stdout, stderr) {
    if (this.build.conf.status === 'cancelled') {
        return;
    }
    if (stdout) {
        this.agent.log(this.build, Msg.buildLog, stdout);
    }

    var e;
    if (err && (!err.code || err.code !== 1)) {
        e = 1;
        this.agent.log(this.build, Msg.error, 'error:\n{2}', err);
    }
    if (stderr) {
        if ((err && err.message || err && err.indexOf && err || '').indexOf(stderr) < 0) {
            this.agent.log(this.build, Msg.error, 'stderror:\n{2}', stderr);
        }
    }
    if (e) {
        return this.agent.buildFailed(this.build);
    }

    this.callHook('buildDone', [e]);
};

module.exports = GenericBuild;