var fs = require('fs'),
    cfenv = require('cfenv'),
    sha256 = require('sha256'),
    validate = require ('jsonschema').validate,
    Logger = require('./logger');

class ServiceBroker {

    constructor() {
        this.logger = new Logger();
        let serviceName = process.env.SERVICE_NAME || 'overview-service';
        this.catalog = {
            services: [
                {
                    name: serviceName,
                    description: 'Provides an overview of any service instances and bindings that have been created by a platform.',
                    id: sha256(serviceName).substring(0, 32),
                    tags: [ 'overview-broker' ],
                    bindable: true,
                    plan_updateable: true,
                    bindings_retrievable: true,
                    instances_retrievable: true,
                    metadata: { shareable: true },
                    plans: this.generatePlansForService(serviceName),
                }
            ]
        };

        // Expose a syslog drain service if requested
        if (process.env.SYSLOG_DRAIN_URL) {
            this.catalog.services.push({
                name: serviceName + '-syslog-drain',
                description: 'Provides an example syslog drain service.',
                id: sha256(serviceName + '-syslog-drain').substring(0, 32),
                tags: [ 'overview-broker' ],
                requires: [ 'syslog_drain' ],
                bindable: true,
                bindings_retrievable: true,
                instances_retrievable: true,
                plan_updateable: true,
                plans: this.generatePlansForService(serviceName + '-syslog-drain'),
                metadata: { shareable: true }
            });
        }

        // Expose a volume mount service if requested
        if (process.env.EXPOSE_VOLUME_MOUNT_SERVICE) {
            this.catalog.services.push({
                name: serviceName + '-volume-mount',
                description: 'Provides an example volume mount service.',
                id: sha256(serviceName + '-volume-mount').substring(0, 32),
                tags: [ 'overview-broker' ],
                requires: [ 'volume_mount' ],
                bindable: true,
                bindings_retrievable: true,
                instances_retrievable: true,
                plan_updateable: true,
                plans: this.generatePlansForService(serviceName + '-volume-mount'),
                metadata: { shareable: true }
            });
        };
        this.dashboardUrl = `${cfenv.getAppEnv().url}/dashboard`;
        logger.debug(`Service broker created. (${this.catalog.services.length} service${this.catalog.services.length == 1 ? '' : 's'} exposed)`);
    }

    getCatalog() {
        return this.catalog;
    }

    setCatalog(data) {
        try {
            var catalogData = JSON.parse(data);
            this.catalog = catalogData;
            return null;
        }
        catch (e) {
            return e.toString();
        }
    }

    getDashboardUrl() {
        return this.dashboardUrl;
    }

    getService(serviceId) {
        return this.catalog.services.find(function(service) {
            return service.id == serviceId;
        });
    }

    getPlanForService(serviceId, planId) {
        var service = this.getService(serviceId);
        if (!service) {
            return null;
        }
        return service.plans.find(function(plan) {
            return plan.id == planId;
        });
    }

    // getServiceInstanceExtensionAPIs(serviceId) {
    //     return [
    //         {
    //             discovery_url: '/logs',
    //             server_url: `${cfenv.getAppEnv().url}/v2/service_instances/${serviceId}`,
    //             adheres_to: 'http://broker.sapi.life/logs'
    //         },
    //         {
    //             discovery_url: '/health',
    //             server_url: `${cfenv.getAppEnv().url}/v2/service_instances/${serviceId}`,
    //             adheres_to: 'http://broker.sapi.life/health'
    //         },
    //         {
    //             discovery_url: '/info',
    //             server_url: `${cfenv.getAppEnv().url}/v2/service_instances/${serviceId}`,
    //             adheres_to: 'http://broker.sapi.life/info'
    //         }
    //     ]
    // };

    validateParameters(schema, parameters) {
        var result = validate(parameters, schema);
        if (!result.valid) {
            return result.errors.toString();
        }
        else {
            return null;
        }
    }

    generatePlansForService(serviceName) {
        var plans = [];

        // Add a very simple plan
        plans.push({
            name: 'simple',
            description: 'A very simple plan.',
            free: true
        });

        // Add a complex plan with a schema
        var complexPlanSchema = {
            $schema: 'http://json-schema.org/draft-04/schema#',
            additionalProperties: false,
            type: 'object',
            properties: {
                rainbow: {
                    type: 'boolean',
                    default: false,
                    description: 'Follow the rainbow'
                },
                name: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 30,
                    default: 'This is a default string',
                    description: 'The name of the broker'
                },
                color: {
                    type: 'string',
                    enum: [ 'red', 'amber', 'green' ],
                    default: 'green',
                    description: 'Your favourite color'
                },
                config: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string'
                        },
                        port: {
                            type: 'integer'
                        }
                    }
                }
            },
            required: [ 'name' ]
        };
        plans.push({
            name: 'complex',
            description: 'A more complicated plan.',
            free: true,
            schemas: {
                service_instance: {
                    create: {
                        parameters: complexPlanSchema
                    },
                    update: {
                        parameters: complexPlanSchema
                    }
                },
                service_binding: {
                    create: {
                        parameters: complexPlanSchema
                    }
                }
            }
        });

        // Load example schemas if requested and generate a plan for each
        if (process.env.ENABLE_EXAMPLE_SCHEMAS) {
            var exampleSchemas = fs.readdirSync('example_schemas');
            for (var i = 0; i < exampleSchemas.length; i++) {
                var name = exampleSchemas[i].split('.json')[0];
                var schema = require(`./example_schemas/${name}`);
                plans.push({
                    name: name,
                    description: name.replace(/-/g, ' '),
                    free: true,
                    schemas: {
                        service_instance: {
                            create: {
                                parameters: schema
                            },
                            update: {
                                parameters: schema
                            }
                        },
                        service_binding: {
                            create: {
                                parameters: schema
                            }
                        }
                    }
                });
            }
        }

        // Add an id to each plan
        plans.forEach(function(plan) {
            plan.id = sha256(`${serviceName}-${plan.name}`).substring(0, 32);
            if (parseInt(process.env.MAXIMUM_POLLING_DURATION_IN_SECONDS)) {
                plan.maximum_polling_duration = parseInt(process.env.MAXIMUM_POLLING_DURATION_IN_SECONDS);
            }
        });

        // All plans generated
        return plans;
    }

}

module.exports = ServiceBroker;
