var Agent = require('./lib/Agent');

var libs = require('corci-libs');
var Common = libs.Common;
var Logger = libs.Logger;
var yargs = Common.yargs;

Logger.addLevels({
    agent: 3,
    build: 2,
    bupro: 2
}, {
    agent: 'blue',
    build: 'yellow',
    bupro: 'green'
});

function Cmd(Captain) {

    var conf = yargs
        .help('help')
        .version('0.1.0', 'v')
        .alias('v', 'version')
        .showHelpOnFail(true)
        .usage('Connects the CorCI-agent to the corCI-master.\nUsage: $0')
        .options('p', {
            alias: 'port',
            default: 8000,
            describe: 'Port the agent should connect to'
        })
        .options('q', {
            alias: 'protocol',
            default: 'http',
            describe: 'Protocol the server is reachable at (https requires key and cert argument)'
        })
        .options('h', {
            alias: 'host',
            default: 'localhost',
            describe: 'the server\'s hostname'
        })
        .options('l', {
            alias: 'location',
            default: 'builds',
            describe: 'Path to the working directory'
        })
        .options('n', {
            alias: 'name',
            describe: 'this agent\'s name'
        })
        .argv;

    conf.url = '{0}://{1}{2}/{3}'.format(
        conf.protocol,
        conf.host,
        conf.port === 80 ? '' : ':' + conf.port,
        'agent'
    );
    var agent = new Agent(conf, Captain);
}

module.exports = Cmd;