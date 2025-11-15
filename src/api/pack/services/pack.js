'use strict';

/**
 * pack service.
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::pack.pack');
