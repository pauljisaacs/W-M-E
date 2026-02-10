#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAJOR = process.env.APP_VERSION_MAJOR || '1';
const MINOR = process.env.APP_VERSION_MINOR || '00';
const HOTFIX = process.env.APP_VERSION_HOTFIX || '00';
const BUILD = process.env.CI_PIPELINE_ID
  ? String(process.env.CI_PIPELINE_ID).slice(-4).padStart(4, '0')
  : '0000';

const majorNum = parseInt(MAJOR, 10);
const minorNum = parseInt(MINOR, 10);
const hotfixNum = parseInt(HOTFIX, 10);

const semver = `${majorNum}.${minorNum}.${hotfixNum}`;
const displayVersion = `${MAJOR}.${String(MINOR).padStart(2, '0')}.${String(HOTFIX).padStart(2, '0')} Build ${BUILD}`;

const versionInfo = {
  version: semver,
  displayVersion,
  major: majorNum,
  minor: minorNum,
  hotfix: hotfixNum,
  build: BUILD,
  buildDate: new Date().toISOString(),
  commitSha: process.env.CI_COMMIT_SHA || 'dev',
  commitShort: process.env.CI_COMMIT_SHORT_SHA || 'dev',
  branch: process.env.CI_COMMIT_BRANCH || 'local',
};

const versionFilePath = path.join(__dirname, '..', 'src', 'version.ts');
const versionFileContent = `// Auto-generated version file - DO NOT EDIT MANUALLY\n// Generated on ${new Date().toISOString()}\n\nexport const VERSION_INFO = ${JSON.stringify(versionInfo, null, 2)} as const;\n`;

fs.writeFileSync(versionFilePath, versionFileContent, 'utf-8');
console.log(`Generated desktop version: ${displayVersion}`);

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
packageJson.version = semver;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
console.log(`Updated desktop package.json version to ${semver}`);
