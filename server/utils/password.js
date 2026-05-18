const crypto = require("crypto");

const SCRYPT_KEYLEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(plain), salt, SCRYPT_KEYLEN, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== "string") {
    return Promise.resolve(false);
  }
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(plain), salt, SCRYPT_KEYLEN, (err, derivedKey) => {
      if (err) reject(err);
      else {
        const expected = Buffer.from(hashHex, "hex");
        const actual = derivedKey;
        resolve(
          expected.length === actual.length &&
            crypto.timingSafeEqual(expected, actual)
        );
      }
    });
  });
}

module.exports = { hashPassword, verifyPassword };
