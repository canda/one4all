require('./configuration/Winston');
const Server = require('./classes/Server');
const Winston = require('winston'); //  error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5

Winston.info('Child process started');
Winston.info('Process id = ', process.pid);
Winston.info('Starting server...');

const server = new Server();

Winston.info('Server is running');

process.on('uncaughtException', function(err) {
  Winston.error(`Caught exception: ${err}`);
});
