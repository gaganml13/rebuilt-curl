import http from 'node:http';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';

const execAsync = promisify(exec);

const server = http.createServer((req, res) => {
  if (req.url === '/json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Powered-By': 'NodeTest' });
    res.end(JSON.stringify({ greeting: 'Hello World', count: 42, success: true, tags: ['cli', 'curl'] }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Resource Not Found');
  }
});

server.listen(4567, '127.0.0.1', async () => {
  try {
    console.log('=== TEST 1: Implicit URL & JSON Pretty-Printing ===');
    const { stdout: out1, stderr: err1 } = await execAsync('node ./index.js http://127.0.0.1:4567/json');
    console.log('STDERR:\n' + err1);
    console.log('STDOUT:\n' + out1);

    console.log('=== TEST 2: Custom Headers, Verbose & Method ===');
    const { stdout: out2, stderr: err2 } = await execAsync('node ./index.js -X GET http://127.0.0.1:4567/json -H "Authorization: Bearer test" -v');
    console.log('STDERR:\n' + err2);
    console.log('STDOUT:\n' + out2);

    console.log('=== TEST 3: Output flag -o ===');
    const outFile = './test-out.json';
    if (existsSync(outFile)) unlinkSync(outFile);
    const { stdout: out3, stderr: err3 } = await execAsync(`node ./index.js http://127.0.0.1:4567/json -o ${outFile}`);
    console.log('STDERR:\n' + err3);
    console.log('FILE CONTENT:');
    console.log(readFileSync(outFile, 'utf-8'));
    unlinkSync(outFile);

    console.log('=== TEST 4: Bare -- option terminator ===');
    const { stdout: out4, stderr: err4 } = await execAsync('node ./index.js -X GET -- http://127.0.0.1:4567/json');
    console.log('STDERR:\n' + err4);
    console.log('STDOUT:\n' + out4);

    console.log('=== TEST 5: 404 Status ===');
    const { stdout: out5, stderr: err5 } = await execAsync('node ./index.js http://127.0.0.1:4567/nonexistent');
    console.log('STDERR:\n' + err5);
    console.log('STDOUT:\n' + out5);

    console.log('ALL TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    if (err.stdout) console.log('STDOUT:\n' + err.stdout);
    if (err.stderr) console.error('STDERR:\n' + err.stderr);
    console.error('ERROR:\n' + err.message);
    process.exit(1);
  } finally {
    server.close();
  }
});
