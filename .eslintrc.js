'use strict';

module.exports = {
    extends: 'hapi',
    parserOptions: {
        ecmaVersion: 2020
    },
    rules: {},
    globals: {
        describe: true,
        it: true,
        beforeEach: true,
        afterEach: true
    }
};
