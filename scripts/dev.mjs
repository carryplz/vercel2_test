// Vercel 없이 로컬에서 실행하기 위한 간단한 개발 서버.
// public/ 정적 파일과 api/*.js 함수를 Vercel과 같은 방식으로 띄운다.
// 사용법: npm run dev  ->  http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Vercel Node 함수의 req/res 헬퍼 흉내
function wrapRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
    return res;
  };
  return res;
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function handleApi(req, res, url) {
  const name = url.pathname.slice('/api/'.length);
  const file = join(ROOT, 'api', `${name}.js`);
  if (!/^[a-z0-9-]+$/i.test(name) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  // 파일을 고치면 서버 재시작 없이 새 코드가 반영되도록 수정 시각을 붙여 불러온다
  const mod = await import(`${pathToFileURL(file).href}?v=${statSync(file).mtimeMs}`);
  req.query = Object.fromEntries(url.searchParams);
  req.body = await readBody(req);
  await mod.default(req, wrapRes(res));
}

async function handleStatic(res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname);
  const file = normalize(join(ROOT, 'public', rel));
  if (!file.startsWith(join(ROOT, 'public'))) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await handleStatic(res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end('server error');
  }
  console.log(req.method, url.pathname, res.statusCode);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
