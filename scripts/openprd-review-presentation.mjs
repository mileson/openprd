#!/usr/bin/env node
import { buildReviewPresentationTemplatePayload, reviewPresentationWorkspace } from '../src/review-presentation.js';

function parseArgs(argv) {
  const flags = {
    project: '.',
    version: null,
    presentation: null,
    template: false,
    write: false,
    failOnViolation: false,
    help: false,
  };
  const positionals = [];
  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--version') {
      flags.version = args.shift() ?? null;
      continue;
    }
    if (arg === '--presentation') {
      flags.presentation = args.shift() ?? null;
      continue;
    }
    if (arg === '--template') {
      flags.template = true;
      continue;
    }
    if (arg === '--write') {
      flags.write = true;
      continue;
    }
    if (arg === '--fail-on-violation') {
      flags.failOnViolation = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    positionals.push(arg);
  }
  flags.project = positionals[0] ?? flags.project;
  return flags;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node scripts/openprd-review-presentation.mjs [path] [--version v0001] [--presentation review-presentation.json] [--write] [--fail-on-violation]',
    '  node scripts/openprd-review-presentation.mjs [path] --template',
  ].join('\n'));
}

async function main(argv = process.argv.slice(2)) {
  const flags = parseArgs(argv);
  if (flags.help) {
    printUsage();
    return 0;
  }

  if (flags.template) {
    console.log(JSON.stringify(buildReviewPresentationTemplatePayload(), null, 2));
    return 0;
  }

  const result = await reviewPresentationWorkspace(flags.project, {
    version: flags.version,
    presentationPath: flags.presentation,
    write: flags.write,
  });
  console.log(JSON.stringify(result, null, 2));
  return flags.failOnViolation && !result.ok ? 1 : 0;
}

main().then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  console.error(error?.message ?? error);
  process.exitCode = 1;
});
