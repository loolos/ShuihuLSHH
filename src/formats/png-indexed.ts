// 解码 8 位索引色 PNG，直接取调色板索引（浏览器与 Node 共用；解压用 DecompressionStream）。
// gamedata/ 下拆出的原版图像都是这种 PNG（编码见 src/formats/png.ts 的 encodeIndexedPng），游戏要用索引做换色、透明色键等，所以不能交给浏览器解成 RGBA。

export interface IndexedImage {
  width: number;
  height: number;
  /** 调色板索引，行优先；0 = 透明 */
  pixels: Uint8Array;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeIndexedPng(buf: Uint8Array, file = 'png'): Promise<IndexedImage> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== 0x89504e47) throw new Error(`${file}: 不是 PNG`);
  let width = 0, height = 0;
  const idat: Uint8Array[] = [];
  for (let o = 8; o + 8 <= buf.length; ) {
    const len = dv.getUint32(o);
    const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(o + 8);
      height = dv.getUint32(o + 12);
      if (body[8] !== 8 || body[9] !== 3 || body[12] !== 0)
        throw new Error(`${file}: 要求 8 位索引色、不隔行的 PNG（原版调色板），这张是位深 ${body[8]}、色彩类型 ${body[9]}`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const all = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let p = 0;
  for (const d of idat) all.set(d, (p += d.length) - d.length);
  const raw = await inflate(all);
  const pixels = new Uint8Array(width * height);
  // 逐行反滤波（每像素 1 字节）
  for (let y = 0; y < height; y++) {
    const f = raw[y * (width + 1)];
    const src = raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1));
    const row = pixels.subarray(y * width, (y + 1) * width);
    const up = y ? pixels.subarray((y - 1) * width, y * width) : new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const a = x ? row[x - 1] : 0, b = up[x], c = x ? up[x - 1] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 0xff;
    }
  }
  return { width, height, pixels };
}
