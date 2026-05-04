import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

function cjoin(...parts) {
  return path.join(...parts);
}

function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readYaml(filePath) {
  const text = await readText(filePath);
  const parsed = YAML.parse(text);
  return parsed ?? {};
}

async function readJson(filePath) {
  const text = await readText(filePath);
  return JSON.parse(text);
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function appendText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, text, 'utf8');
}

function stringifyYaml(value) {
  return YAML.stringify(value, { indent: 2, lineWidth: 100 });
}

async function writeYaml(filePath, value) {
  const text = stringifyYaml(value);
  await writeText(filePath, text);
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendJsonl(filePath, value) {
  await appendText(filePath, `${JSON.stringify(value)}\n`);
}

async function readJsonl(filePath) {
  const text = await readText(filePath);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export {
  appendJsonl,
  appendText,
  cjoin,
  exists,
  readJson,
  readJsonl,
  readText,
  readYaml,
  stringifyYaml,
  writeJson,
  writeText,
  writeYaml,
};
