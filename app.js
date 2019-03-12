var express = require('express'),
    bodyParser = require('body-parser'),
    expressValidator = require('express-validator'),
    basicAuth = require('express-basic-auth'),
    morgan = require('morgan'),
    Logger = require('./logger'),
    ServiceBrokerInterface = require('./service_broker_interface'),
    serviceBrokerInterface = null;

function start(callback) {
    let app = express();

    app.use(bodyParser.json()); // support json encoded bodies
    app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies
    app.use(expressValidator());

    if (process.env.NODE_ENV != 'testing') {
        app.use(morgan('tiny'));
    }

    app.set('view engine', 'pug');

    logger = new Logger();
    serviceBrokerInterface = new ServiceBrokerInterface();

    /* Error modes */
    process.env.errorMode = ''; // Disabled by default
    const supportedErrorModes = [
        '', // Disabled
        'timeout', // Do not respond to any request
        'servererror', // Return HTTP 500 to every request
        'notfound', // Return HTTP 404 to every request
        'gone', // Return HTTP 410 to every request
        'unprocessable', // Return HTTP 422 to every request
        'concurrencyerror', // Return HTTP 422 with the "ConcurrencyError" error code
        'invalidjson', // Return invalid JSON to every request
        'failasync' // Fail asynchronous operations (after they have finished)
    ];

    /* Response modes */
    process.env.responseMode = 'async'; // Support async responses by default
    const supportedResponseModes = [
        'async', // Asynchronous responses where possible
        'sync', // Synchronous responses always
        'asyncalways' // Asynchronous responses always
    ];

    /* Unauthenticated routes */
    app.get('/', function(request, response) {
        response.redirect(303, '/dashboard');
    });
    app.get('/dashboard', function(request, response) {
        var data = serviceBrokerInterface.getDashboardData();
        data.errorMode = process.env.errorMode;
        data.responseMode = process.env.responseMode;
        response.render('dashboard', data);
    });
    app.get('/data', function(request, response) {
        var data = serviceBrokerInterface.getDashboardData();
        data.errorMode = process.env.errorMode;
        data.responseMode = process.env.responseMode;
        response.json(data);
    });
    app.get('/health', function(request, response) {
        response.sendFile('health.yaml', { root: 'extensions' });
    });
    app.get('/info', function(request, response) {
        response.sendFile('info.yaml', { root: 'extensions' });
    });
    app.get('/logs', function(request, response) {
        response.sendFile('logs.yaml', { root: 'extensions' });
    });
    app.post('/admin/clean', function(request, response) {
        serviceBrokerInterface.clean(request, response);
    });
    app.post('/admin/updateCatalog', function(request, response) {
        serviceBrokerInterface.updateCatalog(request, response);
    });
    app.post('/admin/setErrorMode', function(request, response) {
        if (!supportedErrorModes.includes(request.body.mode)) {
            response.status(400).send('Invalid error mode');
            return;
        }
        process.env.errorMode = request.body.mode;
        console.log(`Error mode is now ${process.env.errorMode || 'disabled'}`);
        response.json({});
    });
    app.post('/admin/setResponseMode', function(request, response) {
        if (!supportedResponseModes.includes(request.body.mode)) {
            response.status(400).send('Invalid response mode');
            return;
        }
        process.env.responseMode = request.body.mode;
        console.log(`Response mode is now ${process.env.responseMode}`);
        response.json({});
    });
    app.use('/images', express.static('images'));

    /* Extensions (unauthenticated) */
    app.get('/v2/service_instances/:instance_id/health', function(request, response) {
        serviceBrokerInterface.getHealth(request, response);
    });
    app.get('/v2/service_instances/:instance_id/info', function(request, response) {
        serviceBrokerInterface.getInfo(request, response);
    });

    /* Authenticated routes (uses Basic Auth) */
    var users = {};
    users[process.env.BROKER_USERNAME || 'admin'] = process.env.BROKER_PASSWORD || 'password';
    app.use(basicAuth({
        users: users
    }));

    app.all('*', function(request, response, next) {
        serviceBrokerInterface.saveRequest(request);
        switch (process.env.errorMode) {
            case 'timeout':
                console.log('timing out');
                return;
            case 'servererror':
                serviceBrokerInterface.sendJSONResponse(response, 500, {
                    error: 'ErrorMode',
                    description: 'Error mode enabled (servererror)'
                });
                return;
            case 'notfound':
                serviceBrokerInterface.sendJSONResponse(response, 404, {});
                return;
            case 'gone':
                serviceBrokerInterface.sendJSONResponse(response, 410, {});
                return;
            case 'unprocessable':
                serviceBrokerInterface.sendJSONResponse(response, 422, {
                    error: 'ErrorMode',
                    description: 'Error mode enabled (unprocessable)'
                });
                return;
            case 'concurrencyerror':
                serviceBrokerInterface.sendJSONResponse(response, 422, {
                    error: 'ConcurrencyError',
                    description: 'Error mode enabled (concurrencyerror)'
                });
                return;
            case 'invalidjson':
                serviceBrokerInterface.sendResponse(response, 200, '{ "invalidjson error mode enabled" }');
                return;
            default:
                break;
        }
        serviceBrokerInterface.checkRequest(request, response, next);
    });
    app.get('/v2/catalog', function(request, response) {
        serviceBrokerInterface.getCatalog(request, response);
    });
    app.put('/v2/service_instances/:instance_id', function(request, response) {
        serviceBrokerInterface.createServiceInstance(request, response);
    });
    app.patch('/v2/service_instances/:instance_id', function(request, response) {
        serviceBrokerInterface.updateServiceInstance(request, response);
    });
    app.delete('/v2/service_instances/:instance_id', function(request, response) {
        serviceBrokerInterface.deleteServiceInstance(request, response);
    });
    app.put('/v2/service_instances/:instance_id/service_bindings/:binding_id', function(request, response) {
        serviceBrokerInterface.createServiceBinding(request, response);
    });
    app.delete('/v2/service_instances/:instance_id/service_bindings/:binding_id', function(request, response) {
        serviceBrokerInterface.deleteServiceBinding(request, response);
    });
    app.get('/v2/service_instances/:instance_id/last_operation', function(request, response) {
        serviceBrokerInterface.getLastServiceInstanceOperation(request, response);
    });
    app.get('/v2/service_instances/:instance_id/service_bindings/:binding_id/last_operation', function(request, response) {
        serviceBrokerInterface.getLastServiceBindingOperation(request, response);
    });
    app.get('/v2/service_instances/:instance_id', function(request, response) {
        serviceBrokerInterface.getServiceInstance(request, response);
    });
    app.get('/v2/service_instances/:instance_id/service_bindings/:binding_id', function(request, response) {
        serviceBrokerInterface.getServiceBinding(request, response);
    });

    /* Listing */
    app.get('/v2/service_instances', function(request, response) {
        serviceBrokerInterface.listInstances(request, response);
    });

    var port = process.env.PORT || 3000;
    var server = app.listen(port, function() {
        logger.debug(`Overview broker running on port ${server.address().port}`);
        callback(server, serviceBrokerInterface);
    });
}

exports.start = start;
