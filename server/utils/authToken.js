const crypto = require("crypto");

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET or AUTH_SECRET must be set in production");
  }
  return "dev-insecure-change-me";
}

function signToken(userId) {
  const payload = JSON.stringify({
    sub: String(userId),
    exp: Date.now() + TOKEN_TTL_MS,
  });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data?.sub || typeof data.exp !== "number" || data.exp < Date.now()) {
    return null;
  }
  return data.sub;
}

module.exports = { signToken, verifyToken, TOKEN_TTL_MS };
