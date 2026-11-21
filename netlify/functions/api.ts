import { connectLambda } from '@netlify/blobs';
import serverless from 'serverless-http';
import { createApiApp } from '../../src/server/createApp.ts';
import { createNetlifyBlobsStorage } from '../../src/server/storage.ts';

const app = createApiApp(createNetlifyBlobsStorage('allodabou-controle'));

const serverlessHandler = serverless(app, {
  binary: ['image/*', 'application/octet-stream'],
});

export const handler = async (
  event: Record<string, unknown>,
  context: Record<string, unknown>
) => {
  if (event && typeof event.blobs === 'string' && event.blobs.length > 0) {
    connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);
  }
  return serverlessHandler(event, context);
};
