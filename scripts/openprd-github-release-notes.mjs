#!/usr/bin/env node
import path from 'node:path';
import { buildGitHubReleasePayload, writeGitHubReleaseNotes } from '../src/github-release.js';

function printHelp() {
  console.log([
    'Usage: node scripts/openprd-github-release-notes.mjs [projectRoot] [options]',
    '',
    'Options:',
    '  --version <x.y.z>   Expected project version. Defaults to package.json version.',
    '  --tag <tag>         Git tag to publish, for example v0.1.23.',
    '  --title <text>      Override the GitHub Release title.',
    '  --out <file>        Write the rendered markdown to a file instead of stdout.',
    '  --json              Print the structured payload as JSON.',
    '  --help              Show this help message.',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = [...argv];
  const result = {
    projectRoot: '.',
    version: '',
    tag: '',
    title: '',
    out: '',
    json: false,
    help: false,
  };

  if (args[0] && !args[0].startsWith('--')) {
    result.projectRoot = args.shift();
  }

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--help') {
      result.help = true;
      continue;
    }
    if (arg === '--json') {
      result.json = true;
      continue;
    }
    if (['--version', '--tag', '--title', '--out'].includes(arg)) {
      const value = args.shift();
      if (!value) {
        throw new Error(`Missing value for ${arg}.`);
      }
      result[arg.slice(2)] = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  result.projectRoot = path.resolve(result.projectRoot);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const options = {
    version: args.version || undefined,
    tag: args.tag || undefined,
    title: args.title || undefined,
    out: args.out || undefined,
  };
  const result = args.out
    ? await writeGitHubReleaseNotes(args.projectRoot, options)
    : await buildGitHubReleasePayload(args.projectRoot, options);

  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.out) {
    console.log(result.out);
    return;
  }

  console.log(result.markdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
