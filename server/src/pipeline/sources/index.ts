import { config } from '../../config.js';
import type { JobSource } from '../types.js';
import { FixtureJobSource } from './fixtures.js';
import { UpworkJobSource } from './upwork.js';

let source: JobSource | undefined;

export function getJobSource(): JobSource {
  if (source) return source;
  source =
    config.JOB_SOURCE === 'upwork'
      ? new UpworkJobSource(
          {
            clientId: config.UPWORK_CLIENT_ID,
            clientSecret: config.UPWORK_CLIENT_SECRET,
            accessToken: config.UPWORK_ACCESS_TOKEN,
            refreshToken: config.UPWORK_REFRESH_TOKEN,
          },
          () => console.log('[upwork] access token refreshed (update UPWORK_ACCESS_TOKEN in .env to persist it)'),
        )
      : new FixtureJobSource();
  return source;
}
