#!/usr/bin/env node
'use strict';

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { startServer } = require('./server');

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [options]')
  .option('port', {
    alias: 'p',
    type: 'number',
    description: 'Port to serve on',
    default: 3000,
  })
  .option('dir', {
    alias: 'd',
    type: 'string',
    description: 'Directory to serve',
    default: '.',
  })
  .option('share', {
    alias: 's',
    type: 'boolean',
    description: 'Create a public tunnel URL',
    default: false,
  })
  .option('qrcode', {
    alias: 'q',
    type: 'boolean',
    description: 'Display QR code for the share URL',
    default: false,
  })
  .option('open', {
    alias: 'o',
    type: 'boolean',
    description: 'Open browser on start',
    default: false,
  })
  .option('watch', {
    alias: 'w',
    type: 'boolean',
    description: 'Watch for file changes (live reload)',
    default: true,
  })
  .example('$0', 'Serve current directory on port 3000')
  .example('$0 --share --qrcode', 'Share publicly with QR code')
  .example('$0 -p 8080 -d ./dist --share', 'Share ./dist on port 8080')
  .help()
  .alias('help', 'h')
  .parseSync();

startServer(argv);
