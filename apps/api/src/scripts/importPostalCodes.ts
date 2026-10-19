import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import pg from 'pg';

/**
 * Loads postal-code centroids from a GeoNames postal export (tab-separated:
 * country, postal code, place, admin1, code1, admin2, code2, admin3, code3, lat, lng, accuracy).
 * Usage: npm run import:postal-codes -w @thirtydates/api -- /path/to/allCountries.txt
 */
const BATCH = 5_000;

async function main(file: string, connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let batch: [string, string, string, number, number][] = [];
  let total = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await client.query(
      `INSERT INTO postal_code_centroids (country_code, postal_code, place_name, centroid)
       SELECT c, p, n, ST_SetSRID(ST_MakePoint(lng, lat), 4326)
         FROM unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[]) AS t (c, p, n, lat, lng)
       ON CONFLICT (country_code, postal_code) DO UPDATE
         SET place_name = EXCLUDED.place_name, centroid = EXCLUDED.centroid`,
      [batch.map((r) => r[0]), batch.map((r) => r[1]), batch.map((r) => r[2]), batch.map((r) => r[3]), batch.map((r) => r[4])],
    );
    total += batch.length;
    batch = [];
  };

  const seen = new Set<string>();
  for await (const line of lines) {
    const cols = line.split('\t');
    const country = cols[0]?.trim().toUpperCase();
    const postal = cols[1]?.trim().toUpperCase().replace(/\s+/g, ' ');
    const lat = Number(cols[9]);
    const lng = Number(cols[10]);
    if (!country || country.length !== 2 || !postal || postal.length > 16 || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${country}:${postal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    batch.push([country, postal, cols[2] ?? '', lat, lng]);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  await client.end();
  console.log(`imported ${total} postal codes`);
}

const [file] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error('usage: DATABASE_URL=... importPostalCodes <geonames-file>');
  process.exit(1);
}
main(file, url).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
