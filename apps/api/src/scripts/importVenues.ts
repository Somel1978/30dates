import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { z } from 'zod';

/**
 * Loads curated partner venues from a JSON array:
 *   [{ "name": "...", "venue_type": "specialty_coffee" | "wine_bar", "address": "...",
 *      "lat": 51.5, "lng": -0.12, "curation_score": 4.5 }]
 * Usage: npm run import:venues -w @thirtydates/api -- /path/to/venues.json
 */
const venueSchema = z.object({
  name: z.string().trim().min(1),
  venue_type: z.enum(['specialty_coffee', 'wine_bar']),
  address: z.string().trim().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  curation_score: z.number().min(0).max(5).default(3),
});

async function main(file: string, connectionString: string): Promise<void> {
  const venues = z.array(venueSchema).parse(JSON.parse(await readFile(file, 'utf8')));
  const client = new pg.Client({ connectionString });
  await client.connect();
  for (const v of venues) {
    await client.query(
      `INSERT INTO partner_venues (name, venue_type, address, geom, curation_score)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326), $6)`,
      [v.name, v.venue_type, v.address, v.lat, v.lng, v.curation_score],
    );
  }
  await client.end();
  console.log(`imported ${venues.length} venues`);
}

const [file] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error('usage: DATABASE_URL=... importVenues <venues.json>');
  process.exit(1);
}
main(file, url).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
