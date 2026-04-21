#!/usr/bin/env node
import { main } from '../src/openprd.js';

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
