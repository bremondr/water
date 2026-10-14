// Saves the current reservoir portal pages into test/fixtures/ so the parser tests run offline.
// Re-run when a portal changes its layout, then fix the parser until `npm test` passes again.
import { writeFile, mkdir } from 'node:fs/promises';
import { PLATFORMS, getPage } from '../dams.mjs';

const dir = new URL('../test/fixtures/', import.meta.url);
await mkdir(dir, { recursive: true });
for (const p of PLATFORMS) {
  for (const page of ['Prehled', 'Objemy']) {
    const html = await getPage(`${p.base}/${page}.aspx`);
    // the ASP.NET view state is large, opaque and irrelevant to parsing
    const slim = html.replace(/(<input[^>]*name="__(?:VIEWSTATE|EVENTVALIDATION)[^>]*value=")[^"]*/g, '$1');
    await writeFile(new URL(`${p.key}-${page}.html`, dir), slim);
    console.log(`${p.key}-${page}.html  ${slim.length} bytes`);
  }
}
