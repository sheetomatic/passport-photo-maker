import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function safePath(requestUrl) {
  const url = new URL(requestUrl, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const resolved = path.resolve(ROOT, `.${pathname}`);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) return null;
  return resolved;
}

export function createStaticServer() {
  return http.createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Method not allowed');
      return;
    }

    const filePath = safePath(request.url || '/');
    if (!filePath) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }

    try {
      let stat = await fs.stat(filePath);
      let target = filePath;
      if (stat.isDirectory()) {
        target = path.join(filePath, 'index.html');
        stat = await fs.stat(target);
      }
      if (!stat.isFile()) throw new Error('not a file');

      const extension = path.extname(target).toLowerCase();
      const headers = {
        'Content-Type': MIME[extension] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      };
      response.writeHead(200, headers);
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(target).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:16px system-ui;padding:40px"><h1>404</h1><p>That file is not part of the app.</p><p><a href="/">Back to Passport Photo Maker</a></p></body>',
      );
    }
  });
}

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

export async function startServer({
  port = Number(process.env.PORT) || 5173,
  host = process.env.HOST || '127.0.0.1',
} = {}) {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const localHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const urls = lanAddresses().map((ip) => `http://${ip}:${actualPort}`);
  return {
    server,
    port: actualPort,
    host,
    url: `http://${localHost}:${actualPort}`,
    lanUrls: host === '0.0.0.0' || host === '::' ? urls : [],
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const portArgumentIndex = process.argv.indexOf('--port');
  const port =
    portArgumentIndex !== -1 ? Number(process.argv[portArgumentIndex + 1]) : undefined;
  const hostArgumentIndex = process.argv.indexOf('--host');
  const host =
    hostArgumentIndex !== -1 ? process.argv[hostArgumentIndex + 1] : undefined;

  startServer({
    port: Number.isFinite(port) ? port : undefined,
    host: host || undefined,
  })
    .then(({ url, lanUrls, host: boundHost }) => {
      console.log(`\nPassport Photo Maker running at ${url}`);
      if (boundHost === '0.0.0.0' || boundHost === '::') {
        if (lanUrls.length) {
          console.log('\nOpen this on your phone (same Wi-Fi):');
          for (const lanUrl of lanUrls) console.log(`  ${lanUrl}`);
        } else {
          console.log('\nNo LAN IPv4 address was found. Check your Wi-Fi connection.');
        }
      }
      console.log('\nPress Ctrl+C to stop.\n');
    })
    .catch((error) => {
      console.error('Could not start the local server:', error);
      process.exitCode = 1;
    });
}
