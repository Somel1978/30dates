import { describe, expect, it } from 'vitest';
import { loadConfig, parseOrigins } from '../src/config.js';

describe('WEB_ORIGIN list', () => {
  it('normalises, trims and de-duplicates addresses', () => {
    expect(parseOrigins(' http://192.168.1.50:3000/ , http://30plus:3000,HTTPS://Dates.Example.com ,http://30plus:3000')).toEqual([
      'http://192.168.1.50:3000',
      'http://30plus:3000',
      'https://dates.example.com',
    ]);
  });

  it('rejects malformed entries', () => {
    expect(() => parseOrigins('http://ok:3000,not a url')).toThrow('not a URL');
    expect(() => parseOrigins('ftp://files.example.com')).toThrow('http:// or https://');
    expect(() => parseOrigins(' , ')).toThrow('at least one');
  });

  it('exposes the parsed list on the loaded config', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      JWT_SECRET: 'x'.repeat(32),
      ESCROW_PAIR_SALT: 'y'.repeat(32),
      CRON_SECRET: 'z'.repeat(16),
      WEB_ORIGIN: 'http://192.168.1.50:3000,http://30plus:3000',
    });
    expect(config.WEB_ORIGINS).toEqual(['http://192.168.1.50:3000', 'http://30plus:3000']);
  });
});
