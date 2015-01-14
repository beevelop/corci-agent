var Agent = require('./lib/Agent');

var Common = require('corci-libs').Common;
var yargs = Common.yargs;

var patch = require('corci-libs').patch;
// patch on to support binding with multiple events at once
patch(process.EventEmitter.prototype, ["on", "addListener"]);

function Cmd(platformName, platformClass) {

    var conf = yargs
        .help('help')
        .version('0.0.1', 'v')
        .alias('v', 'version')
        .showHelpOnFail(true)
        .usage('Connects the corCI-agent to the corCI-master.\nUsage: $0')
        .options('p', {
            alias: 'port',
            default: 8000,
            describe: 'Port the server should use'
        })
        .options('q', {
            alias: 'protocol',
            default: 'http',
            describe: 'Protocol the server should use (https requires key and cert argument)'
        })
        .options('h', {
            alias: 'host',
            default: 'localhost',
            describe: 'Hostname the server should use'
        })
        .options('k', {
            alias: 'keep',
            default: 0,
            describe: 'Amount of builds to keep (0 = unlimited)'
        })
        .options('l', {
            alias: 'location',
            default: 'builds',
            describe: 'Path to the builds directory'
        })
        .options('n', {
            alias: 'name',
            describe: 'Name of this agent'
        })
        .options('reuseworkfolder', {
            boolean: true,
            default: false,
            describe: 'if enabled empties location for each build'
        })
        .argv;

    conf.agent = platformName;
    conf.url = '{0}://{1}{2}'.format(conf.protocol, conf.host, conf.port === 80 ? '' : ':' + conf.port);
    var agent = new Agent(conf, platformClass);
    agent.connect();
}

module.exports = Cmd;