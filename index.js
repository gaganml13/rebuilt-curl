#!/usr/bin/env node

/**
 * rebuilt-curl - Standalone CLI HTTP Client
 * Modeled after the parameter-dispatch blueprint extracted from curl.exe:
 *  - Sequential argv traversal with lookahead parameter consumption
 *  - Bare '--' terminates option parsing; remaining items are non-options
 *  - Non-option arguments are implicitly dispatched as '--url'
 *  - Exact error signatures for unknown options and missing parameters
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// ANSI color escape codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function formatStatus(status, statusText) {
  let color = colors.green;
  if (status >= 500) {
    color = colors.red;
  } else if (status >= 400) {
    color = colors.yellow;
  } else if (status >= 300) {
    color = colors.cyan;
  }
  return `${color}${colors.bold}${status} ${statusText}${colors.reset}`;
}

function formatDuration(ms) {
  return `${colors.magenta}${colors.bold}[${ms.toFixed(1)}ms]${colors.reset}`;
}

function colorizeJson(jsonStr) {
  return jsonStr.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          // Key
          return `${colors.cyan}${match.slice(0, -1)}${colors.reset}:`;
        }
        // String value
        return `${colors.green}${match}${colors.reset}`;
      }
      if (/true|false/.test(match)) {
        return `${colors.yellow}${match}${colors.reset}`;
      }
      if (/null/.test(match)) {
        return `${colors.gray}${match}${colors.reset}`;
      }
      // Number
      return `${colors.magenta}${match}${colors.reset}`;
    }
  );
}

function printHelp() {
  console.log(`
Usage: rebuilt-curl [options...] <url>

Options:
  --url <url>              Specify a URL to fetch (or pass as bare argument)
  -X, --method <method>    Specify HTTP request method (GET, POST, PUT, DELETE, etc.)
      --request <method>   Alias for --method
  -H, --header <header>    Add custom HTTP request header (e.g. "Content-Type: application/json")
  -d, --data <data>        HTTP POST/request body data
  -o, --output <file>      Write response body to specified file instead of stdout
  -v, --verbose            Show verbose request and response details
  -h, --help               Display this help text
  --                       Treat all subsequent arguments as URLs/non-options

Blueprint Features:
  - Bare argument dispatched implicitly as --url
  - Exact option validation & lookahead parameter consumption
  - Colorized HTTP status line and execution duration in milliseconds
  - Automatic JSON detection and pretty-printing
`);
}

/**
 * Parameter-dispatch parser mirroring curl.exe's FUN_140010c30:
 * - Iterates through argv
 * - Lookahead argument inspection for parameterized flags
 * - Dispatches bare non-flag items as implicit '--url'
 */
function parseArgs(argv) {
  const options = {
    url: null,
    method: null,
    headers: {},
    data: null,
    output: null,
    verbose: false,
  };

  let optionsEnabled = true;
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (!arg) {
      i++;
      continue;
    }

    if (optionsEnabled && arg.startsWith('-')) {
      // Check for bare double-dash '--'
      if (arg === '--') {
        optionsEnabled = false;
        i++;
        continue;
      }

      // Check for help flag
      if (arg === '-h' || arg === '--help') {
        printHelp();
        process.exit(0);
      }

      // Check for verbose flag
      if (arg === '-v' || arg === '--verbose') {
        options.verbose = true;
        i++;
        continue;
      }

      // Options requiring lookahead parameters
      let targetFlag = null;
      if (arg === '--url') {
        targetFlag = 'url';
      } else if (arg === '-X' || arg === '--method' || arg === '--request') {
        targetFlag = 'method';
      } else if (arg === '-H' || arg === '--header') {
        targetFlag = 'header';
      } else if (arg === '-d' || arg === '--data') {
        targetFlag = 'data';
      } else if (arg === '-o' || arg === '--output') {
        targetFlag = 'output';
      } else {
        console.error(`rebuilt-curl: option ${arg}: is unknown`);
        console.error("rebuilt-curl: try 'rebuilt-curl --help' for more information");
        process.exit(2);
      }

      // Lookahead check
      if (i + 1 >= argv.length || argv[i + 1] === undefined) {
        console.error(`rebuilt-curl: option ${arg}: requires parameter`);
        process.exit(2);
      }

      const param = argv[i + 1];

      switch (targetFlag) {
        case 'url':
          options.url = param;
          break;
        case 'method':
          options.method = param.toUpperCase();
          break;
        case 'header': {
          const colonIdx = param.indexOf(':');
          if (colonIdx === -1) {
            console.error(`rebuilt-curl: bad header format '${param}'. Expected 'Name: Value'`);
            process.exit(2);
          }
          const name = param.slice(0, colonIdx).trim();
          const value = param.slice(colonIdx + 1).trim();
          options.headers[name] = value;
          break;
        }
        case 'data':
          options.data = param;
          if (!options.method) {
            options.method = 'POST';
          }
          break;
        case 'output':
          options.output = param;
          break;
      }

      // Consumed the flag and its parameter
      i += 2;
    } else {
      // Non-option argument dispatched implicitly as '--url'
      // Mimics curl.exe FUN_140010c30: FUN_14000cc10("--url", pbVar7, ...)
      options.url = arg;
      i++;
    }
  }

  return options;
}

function normalizeUrl(inputUrl) {
  if (!inputUrl) return null;
  if (!/^https?:\/\//i.test(inputUrl)) {
    return `http://${inputUrl}`;
  }
  return inputUrl;
}

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0) {
    console.error("rebuilt-curl: try 'rebuilt-curl --help' for more information");
    process.exit(2);
  }

  const options = parseArgs(rawArgs);

  if (!options.url) {
    console.error("rebuilt-curl: no URL specified!");
    console.error("rebuilt-curl: try 'rebuilt-curl --help' for more information");
    process.exit(2);
  }

  const resolvedUrl = normalizeUrl(options.url);
  const method = options.method || (options.data ? 'POST' : 'GET');

  const fetchOptions = {
    method,
    headers: {
      'User-Agent': 'rebuilt-curl/1.0.0',
      ...options.headers,
    },
  };

  if (options.data && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = options.data;
    if (!fetchOptions.headers['Content-Type']) {
      fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }

  if (options.verbose) {
    console.error(`${colors.dim}> ${method} ${resolvedUrl}${colors.reset}`);
    for (const [k, v] of Object.entries(fetchOptions.headers)) {
      console.error(`${colors.dim}> ${k}: ${v}${colors.reset}`);
    }
    if (fetchOptions.body) {
      console.error(`${colors.dim}> [Body ${fetchOptions.body.length} bytes]${colors.reset}`);
    }
    console.error(colors.dim + '----------------------------------------' + colors.reset);
  }

  const startTime = performance.now();
  let response;

  try {
    response = await fetch(resolvedUrl, fetchOptions);
  } catch (err) {
    const elapsed = performance.now() - startTime;
    console.error(
      `${colors.red}${colors.bold}rebuilt-curl: (error) Could not resolve or connect to host [${elapsed.toFixed(1)}ms]${colors.reset}`
    );
    console.error(`${colors.dim}${err.message}${colors.reset}`);
    process.exit(7); // Matches curl CURLE_COULDNT_CONNECT / host resolution error code
  }

  const durationMs = performance.now() - startTime;
  const statusLine = formatStatus(response.status, response.statusText || '');
  const durationLine = formatDuration(durationMs);

  // Status and execution duration banner
  console.error(`${statusLine} ${durationLine}`);

  if (options.verbose) {
    for (const [k, v] of response.headers.entries()) {
      console.error(`${colors.dim}< ${k}: ${v}${colors.reset}`);
    }
    console.error(colors.dim + '----------------------------------------' + colors.reset);
  }

  const rawText = await response.text();
  let outputContent = rawText;
  let isJson = false;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(rawText);
      const prettyJson = JSON.stringify(parsed, null, 2);
      isJson = true;
      if (options.output) {
        outputContent = prettyJson;
      } else {
        // Colorize for terminal output
        outputContent = colorizeJson(prettyJson);
      }
    } catch {
      // Fallback to raw text if JSON parsing fails
      isJson = false;
      outputContent = rawText;
    }
  }

  if (options.output) {
    try {
      writeFileSync(options.output, outputContent, 'utf-8');
      console.error(
        `${colors.cyan}Saved ${rawText.length} bytes ${isJson ? '(formatted JSON) ' : ''}to '${options.output}'${colors.reset}`
      );
    } catch (writeErr) {
      console.error(`rebuilt-curl: Failed to write to '${options.output}': ${writeErr.message}`);
      process.exit(23);
    }
  } else {
    // Print response to stdout
    if (outputContent) {
      console.log(outputContent);
    }
  }
}

main();
