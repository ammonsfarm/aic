import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

test("the security-pinned sharp native runtime can transform uploads", async () => {
  const source = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 25, g: 50, b: 75, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const { data, info } = await sharp(source)
    .resize(1, 1)
    .webp()
    .toBuffer({ resolveWithObject: true });

  assert.ok(data.length > 0);
  assert.equal(info.width, 1);
  assert.equal(info.height, 1);
  assert.equal(info.format, "webp");
});
