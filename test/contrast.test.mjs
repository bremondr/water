// WCAG contrast guard for the colour tokens in index.html. It reads the CSS custom properties (light, and the
// dark overrides) and checks the combinations the UI actually uses, so a palette tweak cannot quietly bring back
// unreadable text. 4.5:1 for text, 3:1 for UI component boundaries and graphics (WCAG 2.1 AA).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = html.split('<style>')[1].split('</style>')[0];

const vars = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2]]));
const light = vars(css.match(/:root\{([\s\S]*?)\}/)[1]);
const dark = { ...light, ...vars(css.match(/prefers-color-scheme:dark\)\{:root\{([\s\S]*?)\}\}/)[1]) };
const themes = { light, dark };

const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const atLeast = (fg, bg, min, what) => assert.ok(ratio(fg, bg) >= min, `${what}: ${fg} on ${bg} is ${ratio(fg, bg).toFixed(2)}:1, needs ${min}:1`);

for (const [name, t] of Object.entries(themes)) {
  test(`${name}: body and secondary text on the page and panel backgrounds`, () => {
    for (const bg of [t.bg, t.panel]) { atLeast(t.text, bg, 4.5, '--text'); atLeast(t.muted, bg, 4.5, '--muted'); }
  });

  test(`${name}: status colours used as chart text and lines`, () => {
    for (const k of ['d0t', 'd1t', 'd2t', 'd3t', 'd4t', 'dryt'])
      for (const bg of [t.bg, t.panel]) atLeast(t[k], bg, 4.5, `--${k}`);
  });

  test(`${name}: pressed chips and tabs`, () => atLeast(t['on-accent'], t.accent, 4.5, 'on-accent on accent'));

  test(`${name}: form fields and idle chips have a 3:1 boundary`, () => {
    for (const bg of [t.bg, t.panel]) atLeast(t.field, bg, 3, '--field');
  });
}

test('status badges: every background has a text colour that reaches 4.5:1', () => {
  // the badge colours are the same in both themes
  const pairs = [...css.matchAll(/\.badge\.(b-[\w]+)\{background:var\(--([\w]+)\);color:(#[0-9a-fA-F]{6})\}/g)];
  assert.ok(pairs.length >= 7, `expected all badge variants, found ${pairs.length}`);
  for (const [, cls, token, text] of pairs) atLeast(text, light[token], 4.5, `.${cls}`);
  atLeast('#ffffff', light.dry, 4.5, 'default badge text (white) on --dry');
});

test('weir icons: white glyph on teal / grey', () => {
  atLeast('#ffffff', css.match(/\.weir\{[^}]*background:(#[0-9a-fA-F]{6})/)[1], 4.5, '.weir');
  atLeast('#ffffff', css.match(/\.weir\.nodata\{background:(#[0-9a-fA-F]{6})/)[1], 4.5, '.weir.nodata');
});

test('warning notes: light and dark', () => {
  const l = css.match(/\.note\.warn\{background:(#[0-9a-fA-F]{6});color:(#[0-9a-fA-F]{6})/);
  const d = css.match(/prefers-color-scheme:dark\)\{\.note\.warn\{background:(#[0-9a-fA-F]{6});color:(#[0-9a-fA-F]{6})/);
  assert.ok(l && d, 'could not find the .note.warn rules');
  atLeast(l[2], l[1], 4.5, '.note.warn light');
  atLeast(d[2], d[1], 4.5, '.note.warn dark');
});
