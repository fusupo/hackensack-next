// Shows that the browser tests refuse a dev server they didn't start.
//
// Something answering HTTP on the browser tests' port could be a developer's
// editor serving the real projects/ folder. playwright.config.ts sets
// `reuseExistingServer: false`, so Playwright must stop instead of testing it.
// This script occupies a port, runs the browser tests on it, and exits 0 only
// if they failed with Playwright's "is already used" error (any other
// failure, such as a missing browser or a failing test, exits 1).
//
// The port is HACKENSACK_E2E_PORT when set, and otherwise a free one the OS
// picks; either way the browser tests are told to use it.
//
//   node e2e/check-port-refused.mjs

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const wanted = Number(process.env.HACKENSACK_E2E_PORT ?? 0)
let port = wanted

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('not the hackensack editor\n')
})

server.on('error', (e) => {
  console.error(`could not listen on 127.0.0.1:${wanted}: ${e.message}`)
  process.exit(2)
})

server.listen(wanted, '127.0.0.1', () => {
  port = server.address().port
  // Asynchronous on purpose: Playwright checks the port over HTTP, so this
  // process's event loop must stay free to answer.
  const child = spawn('npx', ['playwright', 'test'], {
    // No JUnit file: this run is expected to fail.
    env: {
      ...process.env,
      FACTORY_RESULTS_DIR: '',
      HACKENSACK_E2E_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  child.on('close', (code) => {
    server.close()
    process.stdout.write(output)
    const refused = code !== 0 && /is already used/.test(output)
    console.log(
      refused
        ? `\nOK: playwright test exited ${code} and refused the server on port ${port}.`
        : `\nFAIL: expected playwright test to refuse the server on port ${port}; it exited ${code}.`,
    )
    process.exit(refused ? 0 : 1)
  })
})
