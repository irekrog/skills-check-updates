import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { basename } from 'node:path';

import { readFrontmatterVersion } from './frontmatter.ts';
import { readInstalledSkill } from './local-files.ts';
import { getGitHubRepo } from './source.ts';
import { escapeTerminal } from './terminal.ts';

import type { SkillsLock } from './lock.ts';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type UiSkill = {
  name: string;
  source: string;
  sourceType: string;
  url: string | null;
  status: 'installed' | 'missing' | 'error';
  markdown: string;
  version: string | null;
  files: number;
  message: string | null;
};

export const readUiSkills = async (cwd: string, lock: SkillsLock, names: string[]): Promise<UiSkill[]> =>
  Promise.all(names.map(async (name): Promise<UiSkill> => {
    const rawEntry = Object.hasOwn(lock.skills, name) ? lock.skills[name] : undefined;
    const entry = rawEntry && typeof rawEntry.source === 'string' && typeof rawEntry.sourceType === 'string'
      && (rawEntry.sourceUrl === undefined || typeof rawEntry.sourceUrl === 'string') ? rawEntry : undefined;
    const repo = entry && getGitHubRepo(entry);
    const skill: UiSkill = {
      name, source: entry?.source ?? 'Unknown source', sourceType: entry?.sourceType ?? 'unknown',
      url: repo ? `https://github.com/${repo}` : null,
      status: 'error', markdown: '', version: null, files: 0, message: null,
    };
    try {
      if (!entry) throw new Error(rawEntry ? 'Invalid skill entry in skills-lock.json' : 'Skill is not in skills-lock.json');
      const files = await readInstalledSkill(cwd, name);
      const markdown = files?.find((file) => file.path === 'SKILL.md')?.content.toString('utf8');
      return {
        ...skill, status: markdown === undefined ? 'missing' : 'installed', markdown: markdown ?? '',
        version: markdown === undefined ? null : readFrontmatterVersion(markdown), files: files?.length ?? 0,
        message: markdown === undefined ? 'No local SKILL.md found in the supported project skill folders.' : null,
      };
    } catch (error) {
      return { ...skill, message: error instanceof Error ? error.message : String(error) };
    }
  }));

export const renderUi = (project: string, skills: UiSkill[]): string => {
  // Escape HTML delimiters even inside JSON: skill instructions must stay inert text.
  const data = JSON.stringify({ project, skills }).replace(/</g, '\\u003c');
  return HTML.replace('/* SKILL_DATA */', () => data);
};

export const serveUi = async (html: string): Promise<{ url: string; server: Server }> => {
  const path = `/${randomBytes(32).toString('hex')}`;
  // Set once the port is known; until then every Host header is rejected.
  let host = '';
  let consumed = false;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Connection', 'close');
    if (consumed || request.method !== 'GET' || request.url !== path || request.headers.host !== host) {
      response.writeHead(404).end();
      return;
    }
    consumed = true;
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(html);
    server.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  host = `127.0.0.1:${port}`;
  const url = `http://${host}${path}`;
  const expiry = setTimeout(() => {
    server.close();
    server.closeAllConnections();
  }, 5 * 60_000);
  server.once('close', () => clearTimeout(expiry));
  return { url, server };
};

export const openUi = async (cwd: string, lock: SkillsLock, names: string[]): Promise<void> => {
  const skills = await readUiSkills(cwd, lock, names);
  const { url } = await serveUi(renderUi(basename(cwd), skills));
  console.log(`Skill map: ${escapeTerminal(url)}`);
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  execFile(command, args, (error) => {
    if (error) console.error('Could not open a browser automatically. Open the local URL above within five minutes.');
  });
};

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Skill map · scu</title>
<style>
:root {
  --color-paper: oklch(98.5% 0.004 250);
  --color-surface: oklch(99.5% 0.002 250);
  --color-ink: oklch(24% 0.02 258);
  --color-muted: oklch(47% 0.02 258);
  --color-rule: oklch(87% 0.012 250);
  --color-edge: oklch(66% 0.018 250);
  --color-accent: oklch(51% 0.21 262);
  --color-focus: var(--color-accent);
  --color-accent-ink: var(--color-surface);
  --color-selection: color-mix(in oklch, var(--color-accent) 7%, var(--color-surface));
  --color-hover: color-mix(in oklch, var(--color-ink) 4%, var(--color-surface));
  --color-pressed: color-mix(in oklch, var(--color-ink) 9%, var(--color-surface));
  --color-warning: oklch(45% 0.1 65);
  --color-error: oklch(45% 0.16 25);
  --font-display: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: var(--font-display);
  --space-3xs: 0.25rem;
  --space-2xs: 0.5rem;
  --space-xs: 0.75rem;
  --space-sm: 1rem;
  --space-md: 1.5rem;
  --space-lg: 2rem;
  --space-xl: 3rem;
  --text-xs: 0.75rem;
  --text-sm: 0.8125rem;
  --text-md: 0.875rem;
  --text-input: 1rem;
  --text-title: clamp(1.125rem, 1rem + 0.5vw, 1.5rem);
  --space-page: clamp(0.5rem, 0.25rem + 1vw, 1rem);
  --rule-width: 1px;
  --radius-control: 0.25rem;
  --size-control: 2.75rem;
  --size-map: clamp(28rem, calc(100dvh - 6rem), 80rem);
}
*, *::before, *::after { box-sizing: border-box; }
html, body { overflow-x: clip; }
body { margin: 0; background: var(--color-paper); color: var(--color-ink); font: 400 var(--text-md)/1.5 var(--font-body); }
button, input { font: inherit; color: inherit; }
button, a { touch-action: manipulation; }
button { cursor: pointer; white-space: nowrap; }
button:disabled, input:disabled { opacity: 0.55; cursor: not-allowed; color: var(--color-muted); background: var(--color-hover); }
:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 3px; }
button:active:not(:disabled), a:active { background: var(--color-pressed); }
[hidden] { display: none !important; }
main { display: grid; grid-template-columns: [content-start] minmax(0, 1fr) [content-end]; padding: var(--space-page); }
main > * { grid-column: content; }
p { margin: 0; color: var(--color-muted); }
.workspace { min-inline-size: 0; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2xs) var(--space-md); padding-block-end: var(--space-xs); }
.search { flex: 1 1 24rem; display: flex; align-items: center; gap: var(--space-xs); padding-inline: var(--space-xs); min-block-size: var(--size-control); border: var(--rule-width) solid var(--color-rule); border-radius: var(--radius-control); background: var(--color-surface); }
.search svg { inline-size: 1em; block-size: 1em; flex: none; color: var(--color-muted); }
input { min-inline-size: 0; inline-size: 100%; block-size: var(--size-control); padding: 0; border: 0; background: none; font-size: var(--text-input); }
input::placeholder { color: var(--color-muted); }
input:active { background: var(--color-hover); }
.search:has(:focus-visible) { border-color: var(--color-focus); }
.tools { flex: 1 1 20rem; display: flex; align-items: center; justify-content: end; gap: var(--space-3xs); line-height: 1; }
.tools button, .back { min-inline-size: var(--size-control); min-block-size: var(--size-control); padding-inline: var(--space-xs); border: var(--rule-width) solid var(--color-rule); border-radius: var(--radius-control); background: var(--color-surface); font-size: var(--text-sm); }
.tools .fit { margin-inline-start: var(--space-2xs); }
.zoom, .view-label { color: var(--color-muted); font-family: var(--font-mono); font-size: var(--text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
.zoom { min-inline-size: 3.25rem; text-align: center; }
.view-label { margin-inline-end: auto; padding-inline-end: var(--space-2xs); }
.body { display: flex; flex-wrap: wrap; border: var(--rule-width) solid var(--color-rule); background: var(--color-surface); }
.map-area { flex: 999 1 0; min-inline-size: min(100%, 36rem); }
.viewport { block-size: var(--size-map); overflow: auto; overscroll-behavior: contain; }
.sizer { position: relative; min-inline-size: 100%; min-block-size: 100%; overflow: clip; }
.canvas { position: relative; inline-size: max(42rem, calc(var(--branch-count, 1) * 17rem + 4rem)); padding: var(--space-xl) var(--space-lg); transform-origin: 0 0; display: flex; flex-direction: column; align-items: center; gap: var(--space-xl); }
.connections { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; pointer-events: none; }
.connections path { fill: none; stroke: var(--color-edge); stroke-width: 1; }
.root { z-index: 1; display: grid; justify-items: center; gap: var(--space-2xs); padding: var(--space-sm) var(--space-md); border: var(--rule-width) solid var(--color-edge); border-radius: var(--radius-control); background: var(--color-surface); max-inline-size: 30rem; }
.root strong { font: 500 var(--text-title)/1.3 var(--font-display); overflow-wrap: anywhere; min-inline-size: 0; }
.root small { color: var(--color-muted); font-family: var(--font-mono); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.branches { z-index: 1; display: grid; grid-template-columns: repeat(var(--branch-count, 1), minmax(0, 1fr)); gap: var(--space-lg); inline-size: 100%; align-items: start; }
.branch { min-inline-size: 0; }
.source { display: grid; gap: var(--space-3xs); text-align: start; inline-size: 100%; padding: var(--space-xs); background: var(--color-paper); border: var(--rule-width) solid var(--color-rule); border-radius: var(--radius-control); }
.source .owner { display: block; color: var(--color-muted); font-size: var(--text-xs); overflow: clip; text-overflow: ellipsis; }
.source strong { display: block; font-family: var(--font-display); font-size: var(--text-md); font-weight: 500; overflow: clip; text-overflow: ellipsis; }
.source small { color: var(--color-muted); font: 400 var(--text-xs)/1.5 var(--font-mono); }
.source[aria-expanded=false] { border-style: dashed; }
.branch:has([aria-pressed=true]) .source { color: var(--color-accent); }
.nodes { display: grid; gap: var(--space-3xs); padding-block-start: var(--space-sm); padding-inline-start: var(--space-md); }
.node { display: flex; align-items: center; gap: var(--space-2xs); min-inline-size: 0; inline-size: 100%; min-block-size: var(--size-control); padding-block: var(--space-2xs); padding-inline: var(--space-xs); text-align: start; background: var(--color-surface); border: var(--rule-width) solid var(--color-rule); border-radius: var(--radius-control); font-size: var(--text-sm); }
.node-name { overflow: clip; text-overflow: ellipsis; }
.node[aria-pressed=true] { background: var(--color-selection); color: var(--color-accent); border-color: var(--color-accent); }
.dot { inline-size: 0.4em; block-size: 0.4em; flex: none; border-radius: 50%; background: var(--color-muted); }
.node[aria-pressed=true] .dot { background: var(--color-accent); }
.node[data-status=missing] .dot { background: var(--color-warning); }
.node[data-status=error] .dot { background: var(--color-error); }
.node .badge { margin-inline-start: auto; color: var(--color-warning); font-size: var(--text-xs); }
.node[data-status=error] .badge { color: var(--color-error); }
.empty { padding: var(--space-xl); }
.empty strong { display: block; margin-block-end: var(--space-2xs); font-family: var(--font-display); font-size: var(--text-title); font-weight: 500; }
.detail { flex: 1 1 22rem; min-inline-size: 0; max-block-size: var(--size-map); padding: var(--space-md); overflow: auto; overscroll-behavior: contain; border-inline-start: var(--rule-width) solid var(--color-rule); background: var(--color-paper); }
.detail-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); margin-block-end: var(--space-sm); }
.detail-label { font-size: var(--text-sm); color: var(--color-muted); }
.detail h2 { margin-block: 0 var(--space-sm); min-inline-size: 0; overflow-wrap: anywhere; font: 500 var(--text-title)/1.4 var(--font-display); font-style: normal; }
.detail .status { display: block; inline-size: fit-content; margin-block-end: var(--space-md); color: var(--color-muted); font-size: var(--text-xs); }
.detail dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-xs) var(--space-md); margin-block: 0 var(--space-md); font-size: var(--text-sm); }
.detail dt { color: var(--color-muted); }
.detail dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.detail a { display: inline-flex; align-items: center; min-block-size: var(--size-control); color: var(--color-accent); text-underline-offset: 0.2em; }
.detail pre { padding-block-start: var(--space-md); margin-block: var(--space-md) 0; border-block-start: var(--rule-width) solid var(--color-rule); white-space: pre-wrap; overflow-wrap: anywhere; font: 400 var(--text-sm)/1.8 var(--font-mono); }
@media (hover: hover) and (pointer: fine) {
  button:hover:not(:disabled), .detail a:hover { background: var(--color-hover); }
}
</style>
</head>
<body>
<main>
<section class="workspace" aria-label="Interactive skill map">
<div class="toolbar"><label class="search"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input id="search" type="search" aria-label="Search skills and sources" placeholder="Search skills or sources…" autocomplete="off"></label><div class="tools"><span class="view-label" id="visible" aria-live="polite"></span><button id="out" aria-label="Zoom out">−</button><span class="zoom" id="zoom" aria-live="polite">100%</span><button id="in" aria-label="Zoom in">+</button><button class="fit" id="fit">Fit map</button></div></div>
<div class="body"><div class="map-area"><div class="viewport" id="viewport" tabindex="0" role="region" aria-label="Skill map, scroll to explore"><div class="sizer" id="sizer"><div class="canvas" id="canvas"><svg class="connections" id="connections" aria-hidden="true"></svg><div class="root" id="root"><strong id="root-name"></strong><small id="root-count"></small></div><div class="branches" id="branches"></div></div></div><div class="empty" id="empty" hidden><strong>No skills to show.</strong><p id="empty-message"></p></div></div></div>
<aside class="detail" id="detail" aria-label="Skill details" hidden><div class="detail-top"><span class="detail-label">Skill details</span><button class="back" id="clear" aria-label="Clear selection" hidden>×</button></div><div id="detail-content"><p>Select a skill to view its instructions.</p></div></aside></div>
</section>
</main>
<script type="application/json" id="skill-data">/* SKILL_DATA */</script>
<script>
'use strict';
const { project, skills } = JSON.parse(document.getElementById('skill-data').textContent);
const $ = (id) => document.getElementById(id);
const groups = new Map();
for (const skill of skills.slice().sort((a,b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))) {
  if (!groups.has(skill.source)) groups.set(skill.source, []);
  groups.get(skill.source).push(skill);
}
const folded = new Set();
let selected = null;
let scale = 1;
let links = [];
const initialDetails = $('detail-content').cloneNode(true);
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
$('root-name').textContent = project;
$('root-count').textContent = skills.length + ' skills · ' + groups.size + ' sources';
function showDetails(skill) {
  selected = skill;
  $('detail').hidden = false;
  $('clear').hidden = false;
  const panel = $('detail-content');
  panel.replaceChildren(el('h2', skill.name), el('span', skill.status === 'installed' ? 'Installed locally' : skill.status === 'missing' ? 'Missing on disk' : 'Could not read skill', 'status'));
  const meta = el('dl');
  for (const [key, value] of [['Source',skill.source],['Type',skill.sourceType],['Version',skill.version || 'Not declared'],['Files',String(skill.files)]]) {
    meta.append(el('dt',key),el('dd',value));
  }
  panel.append(meta);
  if (skill.url) {
    const link = el('a','View repository ↗');
    link.href = skill.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; panel.append(link);
  }
  if (skill.message) panel.append(el('p',skill.message));
  if (skill.markdown) panel.append(el('pre',skill.markdown));
  document.querySelectorAll('.node').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.name === skill.name)));
  drawConnections();
}
function drawConnections() {
  const svg = $('connections');
  svg.replaceChildren();
  const canvas = $('canvas').getBoundingClientRect();
  for (const [from,to] of links) {
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const isRoot = from === $('root');
    const x1 = (a.left + (isRoot ? a.width/2 : 0) - canvas.left)/scale + (isRoot ? 0 : 12);
    const y1 = (a.bottom-canvas.top)/scale;
    const x2 = (b.left + (isRoot ? b.width/2 : 0) - canvas.left)/scale;
    const y2 = (b.top + (isRoot ? 0 : b.height/2) - canvas.top)/scale;
    const mid = (y1+y2)/2;
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', isRoot
      ? 'M '+x1+' '+y1+' C '+x1+' '+mid+', '+x2+' '+mid+', '+x2+' '+y2
      : 'M '+x1+' '+y1+' V '+y2+' H '+x2);
    svg.append(path);
  }
  $('sizer').style.inlineSize = $('canvas').offsetWidth*scale+'px';
  $('sizer').style.blockSize = $('canvas').offsetHeight*scale+'px';
}
function setScale(value) {
  scale = Math.max(.25,Math.min(1.75,value));
  $('canvas').style.transform = 'scale('+scale+')';
  $('zoom').textContent = Math.round(scale*100)+'%';
  $('out').disabled = scale <= .25; $('in').disabled = scale >= 1.75;
  drawConnections();
}
function render() {
  const query = $('search').value.trim().toLocaleLowerCase();
  $('branches').replaceChildren(); links = [];
  let count = 0, index = 0, branchCount = 0;
  for (const [source,entries] of groups) {
    const matches = entries.filter((skill) => (skill.name+' '+source).toLocaleLowerCase().includes(query));
    index++;
    if (!matches.length) continue;
    count += matches.length;
    branchCount++;
    const branch = el('div',undefined,'branch');
    const sourceButton = el('button',undefined,'source'); sourceButton.type = 'button'; sourceButton.title = source;
    sourceButton.setAttribute('aria-label',source);
    const parts = source.split('/'); const title = parts.pop();
    sourceButton.append(el('span',parts.join('/') || entries[0].sourceType,'owner'),el('strong',title || source));
    const collapsed = folded.has(source);
    sourceButton.append(el('small',matches.length+' skill'+(matches.length === 1 ? '' : 's')+' · '+(collapsed ? 'expand +' : 'collapse −')));
    sourceButton.setAttribute('aria-expanded',String(!collapsed));
    sourceButton.setAttribute('aria-controls','source-'+index);
    sourceButton.addEventListener('click',() => {
      if (folded.has(source)) folded.delete(source); else folded.add(source);
      render();
      Array.from(document.querySelectorAll('.source')).find((button) => button.dataset.source === source)?.focus();
    });
    sourceButton.dataset.source = source;
    const nodes = el('div',undefined,'nodes'); nodes.id = 'source-'+index;
    if (!collapsed) for (const skill of matches) {
      const button = el('button',undefined,'node'); button.type = 'button'; button.dataset.name = skill.name; button.dataset.status = skill.status;
      button.setAttribute('aria-pressed',String(selected === skill));
      button.setAttribute('aria-label',skill.name+', '+skill.status);
      button.append(el('span',undefined,'dot'),el('span',skill.name,'node-name'));
      button.title = skill.name;
      if (skill.status !== 'installed') button.append(el('small',skill.status,'badge'));
      button.addEventListener('click',() => showDetails(skill)); nodes.append(button); links.push([sourceButton,button]);
    }
    branch.append(sourceButton,nodes); $('branches').append(branch); links.push([$('root'),sourceButton]);
  }
  $('canvas').style.setProperty('--branch-count', Math.max(1,branchCount));
  $('canvas').hidden = count === 0; $('empty').hidden = count !== 0;
  $('sizer').hidden = count === 0;
  $('empty-message').textContent = query ? 'Try another skill name or repository.' : 'Install a skill or adjust your CLI filters.';
  $('visible').textContent = count+' / '+skills.length+' skills';
  drawConnections();
}
$('search').addEventListener('input',render);
$('in').addEventListener('click',() => setScale(scale+.1));
$('out').addEventListener('click',() => setScale(scale-.1));
$('fit').addEventListener('click',() => {
  setScale(Math.min(1,($('viewport').clientWidth-20)/$('canvas').offsetWidth,($('viewport').clientHeight-20)/$('canvas').offsetHeight));
  $('viewport').scrollTo(0,0);
});
$('clear').addEventListener('click',() => {
  selected = null; $('detail').hidden = true; $('clear').hidden = true; $('detail-content').replaceChildren(...initialDetails.cloneNode(true).childNodes); render();
});
window.addEventListener('resize',drawConnections);
render();
$('fit').click();
</script>
</body>
</html>`;
