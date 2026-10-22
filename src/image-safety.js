// Read dimensions before invoking a browser decoder. Extensions/MIME are untrusted.
export const IMAGE_LIMITS = Object.freeze({ bytes: 30 * 1024 * 1024, pixels: 24_000_000, edge: 12000 });
export function checkDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > IMAGE_LIMITS.edge || height > IMAGE_LIMITS.edge || width * height > IMAGE_LIMITS.pixels)
    throw new Error("图片尺寸过大或无效，请缩小至 2400 万像素、单边 12000 像素以内");
}
export async function inspectImage(file) {
  if (!file || file.size > IMAGE_LIMITS.bytes) throw new Error("图片超过 30 MB，请缩小后导入");
  const b = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const v = new DataView(b.buffer), text = (at, n) => String.fromCharCode(...b.subarray(at, at + n));
  let width, height, type;
  if (b.length >= 33 && text(1, 3) === "PNG" && b[0] === 137 &&
      b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10 &&
      v.getUint32(8) === 13 && text(12, 4) === "IHDR") {
    width = v.getUint32(16); height = v.getUint32(20); type = "image/png";
  } else if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    let at = 2;
    while (at + 3 < b.length) {
      if (b[at++] !== 255) break;
      while (b[at] === 255) at++;
      const marker = b[at++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > b.length) break;
      const size = v.getUint16(at);
      if (size < 2 || at + size > b.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size >= 8) {
        height = v.getUint16(at + 3); width = v.getUint16(at + 5); type = "image/jpeg"; break;
      }
      at += size;
    }
  } else if (b.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    const tag = text(12, 4);
    if (tag === "VP8X") {
      if (b[20] & 2) throw new Error("请将动态图转为静态 JPG 或 PNG 后导入");
      width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
      height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    } else if (tag === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42) {
      width = v.getUint16(26, true) & 16383; height = v.getUint16(28, true) & 16383;
    } else if (tag === "VP8L" && b[20] === 47) {
      const bits = v.getUint32(21, true);
      width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1;
    }
    type = "image/webp";
  } else if (b.length >= 54 && text(0, 2) === "BM" && v.getUint32(14, true) >= 40) {
    width = v.getInt32(18, true); height = Math.abs(v.getInt32(22, true)); type = "image/bmp";
  } else if (b.length >= 24 && text(4, 4) === "ftyp") {
    // HEIF/AVIF dimensions live in bounded, nested ISO-BMFF property boxes.
    const brandEnd = v.getUint32(0);
    if (brandEnd >= 16 && brandEnd <= b.length) {
      const brands = [text(8, 4)];
      for (let at = 16; at + 4 <= brandEnd; at += 4) brands.push(text(at, 4));
      if (brands.some(x => ["heic", "heix", "hevc", "hevx", "avif"].includes(x))) {
        type = brands.includes("avif") ? "image/avif" : "image/heic";
        function boxes(start, end, depth = 0) {
          if (depth > 5) return;
          for (let at = start; at + 8 <= end;) {
            const n = v.getUint32(at), tag = text(at + 4, 4);
            if (n < 8 || at + n > end) break;
            if (tag === "ispe" && n >= 20) {
              const w = v.getUint32(at + 12), h = v.getUint32(at + 16);
              checkDimensions(w, h); width = Math.max(width || 0, w); height = Math.max(height || 0, h);
            } else if (["meta", "iprp", "ipco"].includes(tag)) boxes(at + (tag === "meta" ? 12 : 8), at + n, depth + 1);
            at += n;
          }
        }
        boxes(brandEnd, b.length);
      }
    }
  }
  if (!type || width === undefined || height === undefined)
    throw new Error("无法验证图片格式或尺寸，请转为静态 JPG、PNG 或 WebP 后导入");
  checkDimensions(width, height);
  return { type, width, height };
}
