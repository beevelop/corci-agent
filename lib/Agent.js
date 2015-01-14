/**
 * @name Agent
 * @version 0.0.1
 * @fileoverview the agent processes builds ordered by the server
 */

var corciLibs = require('corci-libs');

var Common = corciLibs.Common;
var Build = corciLibs.Build;
var Msg = corciLibs.Msg;
var FileHelper = corciLibs.FileHelper;
var Archiver = corciLibs.Archiver;

var multiGlob = Common.multiGlob;
var fs = Common.fsExtra;

var ioc = require('socket.io-client');
var path = require('path');
var utils = require('utils');
var exec = require('child_process').exec;
var splice = Array.prototype.splice;

var GenericBuild = require('./GenericBuild');

/**
 * Initialize the AgentWorker
 *
 * @class
 * @param {Object} conf - command line options
 * @param {Platform} platform - the agent's platform class (e.g. Android IOS, WP,...)
 */
function Agent(conf, platform) {
    this.platform = utils.inherits(platform, require('./Platform'));
    this.id = Common.getShortID();

    this.conf = conf || {};
    this.url = '{0}/{1}'.format(conf.url, 'agent');
    this.workFolder = conf.agentwork || 'work';

    this.archiver = new Archiver(conf["7zpath"]);

    process.on('exit', function () {
        if (this.socket.connected) {
            this.socket.disconnect();
        }
        this.socket.connected = false;
    }.bind(this));
}

/**
 * Connect to the server (create new socket)
 * and attach listeners
 */
Agent.prototype.connect = function () {
    if (this.socket) {
        this.socket.connect();
        return;
    }

    console.log('Connecting agent supporting', this.conf.agent, 'to:', this.url);
    this.socket = ioc.connect(this.url, {
        'max reconnection attempts': Infinity,
        'force new connection': true,
        'reconnect': true,
        'reconnection limit': Infinity,
        'sync disconnect on unload': true,
        'reconnection delay': 500
    });

    this.attachListeners();
    this.ensureWorkFolder();
};

/**
 * Attach socket listeners
 */
Agent.prototype.attachListeners = function () {
    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('disconnect', this.onDisconnect.bind(this));
    this.socket.on('error', this.onError.bind(this));
    this.socket.on('build', this.onBuild.bind(this));
    this.socket.on('cancel', this.onCancelBuild.bind(this));
    this.socket.on('log', function (msg) {
        console.log(new Msg(msg).toString());
    });
    this.socket.on('reconnecting', function (attempt) {
        console.log("Reconnecting, attempt #" + attempt);
    });
    this.socket.on('reconnect', function (attempt) {
        console.log("AgentWorker successfully reconnected on attempt #" + attempt);
    });
};


/**
 * Register to the server
 */
Agent.prototype.onConnect = function () {
    console.log('AgentWorker connected! Supporting platforms: ', this.conf.agent);
    this.emit('register', {
        id: this.id,
        name: this.conf.agentname,
        platforms: this.conf.agent
    });
};

/**
 * Log socket disconnects
 */
Agent.prototype.onDisconnect = function () {
    console.log('AgentWorker diconnected! Affected platforms: ', this.conf.agent);
};

/**
 * Log socket errors
 *
 * @param {Object} err - error object
 */
Agent.prototype.onError = function (err) {
    console.log('Agent Worker will attempt to reconnect because it the socket reported an error:', err);
};

/**
 * Set build status
 */
Agent.prototype.onCancelBuild = function () {
    this.build.conf.status = 'cancelled';
    try {
        if (this.exec) {
            this.exec.kill();
        }
    } catch (e) {
        //@TODO; error-handling ?
    }
};

/**
 * Initialise new build (via platform specific build sequences)
 *
 * @param {Build} build - the build object
 */
Agent.prototype.onBuild = function (build) {
    if (!build) {
        return this.buildFailed(build, 'No build configuration was specified!');
    }
    if (!build.conf || !build.conf.platform) {
        return this.buildFailed(build, 'No platform was specified for the requested build!');
    }
    this.emit('building', build.id);
    this.build = build = new Build(build.conf, null, this, build.conf.platform, build.files, null, build.id, build.masterId);
    build.locationPath = this.conf.reuseworkfolder ? path.resolve(this.workFolder) : path.resolve(this.workFolder, build.Id());


    var genericBuild = new GenericBuild(build, this);
};

/**
 * Wrapper function for socket emit
 */
Agent.prototype.emit = function () {
    if (!this.build || this.build.conf && this.build.conf.status !== 'cancelled') {
        return this.socket.emit.apply(this.socket, arguments);
    }
    return false;
};

/**
 * Output to console and emit to server
 *
 * @param {Build} build    - the build which the log message refers to
 * @param {int} priority   - priority of the log message (1-6)
 * @param {String} message - the log message
 * @param {*} args         - any additional arguments (passed to Msg.update
 */
Agent.prototype.log = function (build, priority, message, args) {
    if (/Command failed/i.test(message)) {
        var e = new Error("agent worker stack");
        message += e.stack;
    }
    splice.call(arguments, 1, 0, this, 'AW');
    var msg = new Msg();
    msg.update.apply(msg, arguments);

    if (this.conf.mode !== 'all' || !this.socket.connected) {
        console.log(msg.toString());
    }
    this.emit('log', msg);
};

/**
 * Ensuring the agent's workfolder exists (create it if necessary)
 *
 * @param {function} done - callback function
 */
Agent.prototype.ensureWorkFolder = function (done) {
    var workFolder = this.workFolder = path.resolve(this.workFolder);
    var agent = this;

    fs.mkdirs(workFolder, function (err) {
        if (err) {
            agent.log(null, Msg.error, 'Cannot create folder: {2}', workFolder);
            process.env.PWD = workFolder;
        }
        if (done) {
            done(err, workFolder);
        }
    });
};

/**
 * Wrapper function to log and interact with command execution
 *
 * @param {Build} build          - concerning build
 * @param {String} cmd           - command to execute
 * @param {Object} opts          - options passed to the exec command
 * @param {function} callback    - callback function
 * @param {String} exitCodeError - error message
 */
Agent.prototype.exec = function (build, cmd, opts, callback, exitCodeError) {
    var agent = this;
    var process = exec(cmd, opts, function (err, stdout, stderr) {
        if (build.conf.status === 'cancelled') {
            return;
        }
        if (stdout) {
            agent.log(build, Msg.buildLog, '{2}', stdout);
        }
        if (err && (!err.code || err.code !== 1)) {
            agent.log(build, Msg.error, 'error:\n{2}', err);
        }
        if (stderr && (err && err.message || '').indexOf(stderr) < 0) {
            agent.log(build, Msg.error, 'stderror:\n{2}', stderr);
        }
        callback.apply(agent, arguments);
        if (stderr || err && (!err.code || err.code !== 1)) {
            return agent.buildFailed(build, '');
        }
    }).on('close', function (code) {
        if (build.conf.status === 'cancelled') {
            return;
        }
        if (code && code !== 1) {
            return agent.buildFailed(build, exitCodeError || 'process exited with error code {2}', code);
        }
    });
    process.stdout.on('data', function (data) {
        if ((/error\:/gi).test(data || '')) {
            return agent.buildFailed(build, data);
        }
        agent.log(build, Msg.buildLog, data);
    });
    process.stderr.on('data', function (data) {
        agent.log(build, Msg.error, data);
    });
    return process;
};

/**
 * Initialise upload of succeded build
 *
 * @param {Build} build - current build
 * @param {Array} globFiles - array of globs to upload
 */
Agent.prototype.buildSuccess = function (build, globFiles) {
    if (build.conf.status === 'cancelled') {
        return;
    }

    var agent = this;
    var workFolder = build.locationPath;
    multiGlob.glob(globFiles, {
        cwd: workFolder
    }, function (err, files) {
        if (build.conf.status === 'cancelled') {
            return;
        }
        if (err) {
            return agent.buildFailed(build, 'error globbing {2}', globFiles);
        }
        files = files.map(function (file) {
            return {file: path.resolve(workFolder, file)};
        });
        agent.emit('uploading', build.id);//change build status to uploading..
        FileHelper.readFiles(files, '[Agent WORKER] cordova build agent worker output files', function (err) {
            if (build.conf.status === 'cancelled') {
                return;
            }
            if (err) {
                FileHelper.freeMemFiles(files);
                return agent.buildFailed(build, err);
            }
            agent.uploadFiles(build, files);
        });
    });
};

/**
 * Upload outputFiles to the server
 *
 * @param {Build} build - current build
 * @param {Object} outputFiles - list of files to upload
 */
Agent.prototype.uploadFiles = function (build, outputFiles) {
    var _self = this;
    try {
        build.outputFiles = outputFiles;
        var size = 0;
        outputFiles.forEach(function (file) {
            size += file && file.content && file.content.data && file.content.data.length || 0;
        });
        if (size) {
            _self.log(build, Msg.info, 'Uploading results file(s) to cordova build server...{0}'.format(Common.getFilesize(size)));
        }
        var paths = [];
        outputFiles.forEach(function (file) {
            paths.push(file.file);
            if (build.conf.name) {
                var ext = path.extname(file.file);
                switch (ext) {
                    case '.ipa':
                    case '.apk':
                    case '.xap':
                        file.name = build.conf.name ? build.conf.name + ext : file.file;
                        break;
                }
            }
            file.file = path.basename(file.file);
        });

        _self.emit('build-success', build.serialize({
            outputFiles: 1,
            content: 1
        }));
        outputFiles.forEach(function (file, index) {
            file.file = paths[index];
        });
    } finally {
        //free agent's memory of output files contents
        FileHelper.freeMemFiles(outputFiles);
        var buildPath = path.resolve(build.locationPath, 'build.' + build.conf.platform + '.json');
        build.save(buildPath, function (err) {
            if (err) {
                _self.log(build, Msg.debug, err);
            }
        });
    }
};

/**
 * Handle build files (report to the server and upload logfiles)
 *
 * @param {Build} build - current build
 * @param {Object} [err] - error object (build failed) or null
 * @param {*} args - any additional arguments (passed to {@link Agent#log}
 */
Agent.prototype.buildFailed = function (build, err, args) {
    if (build.conf.status === 'cancelled') {
        return;
    }

    var e = new Error("failed with stack");
    err = err + '\n' + e.stack;

    var agent = this;
    if (err) {
        splice.call(arguments, 1, 0, Msg.error);
        this.log.apply(this, arguments);
        this.log.call(this, build, Msg.error, '*** BUILD FAILED on {2} ***', build && build.conf && build.conf.platform || 'unknown platform');
    }

    FileHelper.freeMemFiles(build.files);
    var buildPath = path.resolve(build.locationPath, 'build.' + build.conf.platform + '.json');
    build.save(buildPath, function (err) {
        if (err) {
            agent.log(build, Msg.debug, err);
        }
    });
    this.emit('build-failed', build.serialize());
};

module.exports = Agent;