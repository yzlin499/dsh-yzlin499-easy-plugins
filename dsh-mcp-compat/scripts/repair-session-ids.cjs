// 一次性修复：给历史里缺 id 的 user/message 事件补 id。
// 背景：dsh-mcp-compat 0.12.0~0.12.4 的「手动调用结果写入会话」直接 append 了
// { role, content, source } 的 user/message，缺 id；DSH 恢复会话时
// adoptSessionEvent → assertMessageEventShape 要求 id 非空，于是一整条会话读取失败。
//
// 用法：node repair-sessions.cjs [--dry-run]
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const ZSTD_MAGIC = 0xfd2fb528;
const CHECKSUM_OPTIONS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
const dryRun = process.argv.includes('--dry-run');

/** 照抄 @deepseek-ai/dsh-session-persistence-jsonl 的帧扫描（不依赖其导出）。 */
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) throw new Error(`reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

const sessionsRoot = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'sessions');
const projCacheDir = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'session_projcache', 'sessions');

function walk(dir, out) {
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) { walk(p, out); continue; }
    if (/\.jsonl(\.zstd)?$/.test(it.name)) out.push(p);
  }
}

const files = [];
walk(sessionsRoot, files);
console.log('扫描会话日志:', files.length, '个（根目录', sessionsRoot, '）');

let repaired = 0;
let failed = 0;
for (const file of files) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (e) { console.log('  跳过（读失败）', file, e.message); continue; }
  let plaintext;
  try {
    const { frames } = scanZstdFrames(bytes);
    if (!frames.length) { console.log('  跳过（无帧）', file); continue; }
    plaintext = Buffer.concat(frames.map((f) => zlib.zstdDecompressSync(bytes.subarray(f.start, f.end)))).toString('utf8');
  } catch (e) {
    console.log('  跳过（解码失败）', file, e.message);
    failed++;
    continue;
  }
  const lines = plaintext.split('\n').filter((line) => line.trim() !== '');
  if (!lines.length) continue;
  let patched = 0;
  const next = lines.map((line) => {
    let event;
    try { event = JSON.parse(line); } catch { return line; }
    if (event.type !== 'user/message') return line;
    const data = event.data && typeof event.data === 'object' ? event.data : null;
    if (!data) return line;
    if (typeof data.id === 'string' && data.id !== '') return line;
    data.id = `msg_${randomUUID()}`;
    if (data.role !== 'user') data.role = 'user';
    if (!data.source || typeof data.source.kind !== 'string' || data.source.kind === '') data.source = { kind: 'user' };
    if (!Array.isArray(data.content)) data.content = [{ type: 'text', text: String(data.content ?? '') }];
    patched++;
    return JSON.stringify(event);
  });
  if (!patched) continue;

  const sessionId = path.basename(path.dirname(file));
  console.log(`${dryRun ? '[dry-run] ' : ''}修复 ${sessionId}：补 ${patched} 个 id  (${file})`);
  if (dryRun) { repaired++; continue; }

  const header = next.slice(0, 1).join('\n') + '\n';
  const rest = next.slice(1).join('\n') + '\n';
  const encoded = Buffer.concat([
    zlib.zstdCompressSync(Buffer.from(header, 'utf8'), CHECKSUM_OPTIONS),
    zlib.zstdCompressSync(Buffer.from(rest, 'utf8'), CHECKSUM_OPTIONS),
  ]);
  const backup = `${file}.bak-${Date.now()}`;
  try {
    fs.copyFileSync(file, backup);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, encoded);
    fs.renameSync(tmp, file);
    // 投影缓存是派生物：删掉强制按新日志重建
    const cache = path.join(projCacheDir, `${sessionId}.json`);
    if (fs.existsSync(cache)) fs.rmSync(cache, { force: true });
    console.log(`  已写回（备份 ${path.basename(backup)}）`);
    repaired++;
  } catch (e) {
    console.log('  写回失败:', e.message);
    failed++;
  }
}
console.log(`\n完成：修复 ${repaired} 个会话，失败 ${failed} 个${dryRun ? '（dry-run 未写盘）' : ''}`);
