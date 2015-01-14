/**
 * @name Platform
 * @version 0.0.1
 * @fileoverview Interface for all platforms
 */


/**
 * Constructor of the android build sequence
 *
 * @class
 * @param {Build} build - reference to the build object
 * @param {Agent} agent - reference to the agent
 */
function Platform(build, agent) {
    this.build = build;
    this.agent = agent;
}

/**
 * Initiate building sequence
 * looks for existing APKs
 */
Platform.prototype.init = function () {};

/**
 * Hook into preCordovaBuild to make some file manipulations
 *
 * @param {function} startBuild - the Agent's callback to start the build
 */
Platform.prototype.preCordovaBuild = function (startBuild) {};

/**
 * Hook into filesDone to make some file manipulations
 *
 * @param {function} startBuild - the Agent's callback to start the build
 */
Platform.prototype.filesDone = function (startBuild) {};

/**
 * Hook into the {@link GenericBuild}s buildDone callback
 *
 * @param {Object} [err] - error object or null
 */
Platform.prototype.buildDone = function (err) {};

module.exports = Platform;