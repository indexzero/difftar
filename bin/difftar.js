#!/usr/bin/env node

/**
 * RAWR! I'm Difftar!
 *
 * The giant green tarball-diffing monster that stomps through your npm packages!
 * Fear my unified diffs! I will compare your tarballs and ROAR the differences!
 *
 * Usage:
 *   difftar <left-tarball-url> <right-tarball-url> [options]
 *   difftar --diff <spec> --diff <spec> [options]
 *
 * Options:
 *   --diff-name-only        Only show file names (quiet stomp)
 *   --diff-unified=N        Number of context lines (default: 3)
 *   --diff-ignore-all-space Ignore all whitespace (gentle giant mode)
 *   --diff-no-prefix        Remove a/ b/ prefixes
 *   --diff-src-prefix=X     Custom source prefix
 *   --diff-dst-prefix=X     Custom destination prefix
 *   --diff-text             Treat all files as text
 *   --auth=bearer|basic     Authentication type
 *   --token=TOKEN           Auth token/credential
 *   --help                  Show this help
 *
 * Examples:
 *   difftar https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz \
 *           https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz
 *
 *   difftar --diff lodash@4.17.20 --diff lodash@4.17.21
 *
 *   difftar --diff lodash@4.17.20 --diff lodash@4.17.21 --diff-name-only
 */

import { diff } from '../src/index.js';

/**
 * Parse command line arguments
 * @param {string[]} args
 * @returns {{ left: string | null, right: string | null, options: object }}
 */
function parseArgs(args) {
  const result = {
    left: null,
    right: null,
    options: {},
    auth: null,
    token: null,
    help: false
  };

  const diffSpecs = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      i++;
    } else if (arg === '--diff-name-only') {
      result.options.nameOnly = true;
      i++;
    } else if (arg.startsWith('--diff-unified=')) {
      result.options.context = parseInt(arg.slice('--diff-unified='.length), 10);
      i++;
    } else if (arg === '--diff-unified' && args[i + 1]) {
      result.options.context = parseInt(args[i + 1], 10);
      i += 2;
    } else if (arg === '--diff-ignore-all-space') {
      result.options.ignoreAllSpace = true;
      i++;
    } else if (arg === '--diff-ignore-space-change') {
      result.options.ignoreSpaceChange = true;
      i++;
    } else if (arg === '--diff-no-prefix') {
      result.options.noPrefix = true;
      i++;
    } else if (arg.startsWith('--diff-src-prefix=')) {
      result.options.srcPrefix = arg.slice('--diff-src-prefix='.length);
      i++;
    } else if (arg.startsWith('--diff-dst-prefix=')) {
      result.options.dstPrefix = arg.slice('--diff-dst-prefix='.length);
      i++;
    } else if (arg === '--diff-text') {
      result.options.text = true;
      i++;
    } else if (arg === '--diff' && args[i + 1]) {
      diffSpecs.push(args[i + 1]);
      i += 2;
    } else if (arg.startsWith('--auth=')) {
      result.auth = arg.slice('--auth='.length);
      i++;
    } else if (arg.startsWith('--token=')) {
      result.token = arg.slice('--token='.length);
      i++;
    } else if (!arg.startsWith('-')) {
      // Positional argument (URL)
      if (!result.left) {
        result.left = arg;
      } else if (!result.right) {
        result.right = arg;
      }
      i++;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  // Handle --diff specs
  if (diffSpecs.length === 2) {
    result.left = diffSpecs[0];
    result.right = diffSpecs[1];
  } else if (diffSpecs.length === 1) {
    console.error('Error: --diff requires two specs');
    process.exit(1);
  }

  return result;
}

/**
 * Convert package spec to tarball URL
 * @param {string} spec - Package spec like "lodash@4.17.21" or full URL
 * @returns {string} Tarball URL
 */
function specToUrl(spec) {
  // If already a URL, return as-is
  if (spec.startsWith('http://') || spec.startsWith('https://')) {
    return spec;
  }

  // Parse package@version format
  let name, version;

  if (spec.startsWith('@')) {
    // Scoped package: @scope/name@version
    const atIndex = spec.lastIndexOf('@');
    if (atIndex > 0) {
      name = spec.slice(0, atIndex);
      version = spec.slice(atIndex + 1);
    } else {
      name = spec;
      version = 'latest';
    }
  } else {
    // Regular package: name@version
    const atIndex = spec.indexOf('@');
    if (atIndex > 0) {
      name = spec.slice(0, atIndex);
      version = spec.slice(atIndex + 1);
    } else {
      name = spec;
      version = 'latest';
    }
  }

  // Construct npm registry URL
  // Format: https://registry.npmjs.org/{name}/-/{basename}-{version}.tgz
  const basename = name.startsWith('@') ? name.split('/')[1] : name;
  return `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
    ____  _  __  __ _
   |  _ \\(_)/ _|/ _| |_ __ _ _ __
   | | | | | |_| |_| __/ _\` | '__|
   | |_| | |  _|  _| || (_| | |
   |____/|_|_| |_|  \\__\\__,_|_|

   RAWR! I'm Difftar! The giant green tarball-diffing monster!
   I stomp through your npm packages and ROAR the differences!

Usage:
  difftar <left-url> <right-url> [options]
  difftar --diff <spec> --diff <spec> [options]

Arguments:
  <left-url>   URL to the left (old) tarball to CHOMP
  <right-url>  URL to the right (new) tarball to STOMP
  <spec>       Package spec (e.g., lodash@4.17.21) or tarball URL

Options:
  --diff <spec>            Package spec or URL (use twice for MAXIMUM DESTRUCTION)
  --diff-name-only         Only show changed file names (quiet stomp)
  --diff-unified=N         Number of context lines (default: 3)
  --diff-ignore-all-space  Ignore all whitespace changes (gentle giant mode)
  --diff-ignore-space-change  Ignore whitespace amount changes
  --diff-no-prefix         Remove a/ b/ prefixes
  --diff-src-prefix=X      Source prefix (default: a/)
  --diff-dst-prefix=X      Destination prefix (default: b/)
  --diff-text              Treat all files as text (even binary prey!)
  --auth=bearer|basic      Authentication type for private registries
  --token=TOKEN            Auth token or base64 credentials
  --help, -h               Show this help

Examples:
  # STOMP two versions using URLs
  difftar https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz \\
          https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz

  # CHOMP packages using specs (npm diff style)
  difftar --diff lodash@4.17.20 --diff lodash@4.17.21

  # Quiet stomp - only show changed file names
  difftar --diff is-number@6.0.0 --diff is-number@7.0.0 --diff-name-only

  # RAWR at private registries with authentication
  difftar --diff @myorg/pkg@1.0.0 --diff @myorg/pkg@2.0.0 \\
          --auth=bearer --token=npm_xxxxx

RAWR! Let Difftar loose on your tarballs today!
`);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (parsed.help || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  if (!parsed.left || !parsed.right) {
    console.error('Error: Two package specs or URLs are required');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  // Convert specs to URLs
  const leftUrl = specToUrl(parsed.left);
  const rightUrl = specToUrl(parsed.right);

  // Build source configs
  const leftConfig = {
    transport: 'url',
    source: leftUrl
  };

  const rightConfig = {
    transport: 'url',
    source: rightUrl
  };

  // Add auth if specified
  if (parsed.auth && parsed.token) {
    leftConfig.auth = parsed.auth;
    leftConfig.credential = parsed.token;
    rightConfig.auth = parsed.auth;
    rightConfig.credential = parsed.token;
  }

  try {
    const output = await diff(leftConfig, rightConfig, parsed.options);
    process.stdout.write(output);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (error.phase) {
      console.error(`Phase: ${error.phase}`);
    }
    if (error.cause) {
      console.error(`Cause: ${error.cause.message}`);
    }
    process.exit(1);
  }
}

main();
