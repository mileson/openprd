#!/usr/bin/env node
import { main } from '../src/openprd.js';

const exitCode = await main(['dev-check', ...process.argv.slice(2)]);
process.exitCode = exitCode;
