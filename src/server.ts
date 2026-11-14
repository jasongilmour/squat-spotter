import { createServer } from 'node:http';
import { createHandler } from './http/handler.ts';
import { createNpmService } from './npm/service.ts';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
const server = createServer({ connectionsCheckingInterval: 1000 }, createHandler({ service: createNpmService({}) }));
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, host, () => {
  console.log(`Squat Spotter listening on http://${host}:${port}`);
});
