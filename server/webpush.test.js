// webpush.js 자가 검증 — 라운드트립 암복호 + VAPID JWT 서명 검증.
"use strict";
const crypto = require("crypto");
const wp = require("./webpush");

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

let failed = 0;
function assert(cond, msg) { if (!cond) { console.error("✗ FAIL:", msg); failed++; } else { console.log("✓", msg); } }

// ---- 1. 페이로드 암호화 라운드트립 ----
// 수신자(브라우저) 역할 키쌍 생성
const recv = crypto.createECDH("prime256v1");
recv.generateKeys();
const uaPublic = recv.getPublicKey();         // p256dh
const authSecret = crypto.randomBytes(16);    // auth
const p256dh = b64url(uaPublic);
const auth = b64url(authSecret);

const message = "When I grow up, I want to be a watermelon 🍉";
const body = wp.encryptPayload(message, p256dh, auth);

// 수신자측 복호화(브라우저가 하는 일을 재현)
function decrypt(body, recvEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const ecdhSecret = recvEcdh.computeSecret(asPublic);
  const uaPub = recvEcdh.getPublicKey();
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const enc = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  let out = Buffer.concat([decipher.update(enc), decipher.final()]);
  // 마지막 패딩 구분자 0x02 제거
  let end = out.length;
  while (end > 0 && out[end - 1] === 0x00) end--;
  if (end > 0 && out[end - 1] === 0x02) end--;
  return out.subarray(0, end).toString("utf8");
}

const recovered = decrypt(body, recv, authSecret);
assert(recovered === message, `페이로드 라운드트립: "${recovered}"`);
assert(body[20] === 65, "keyid 길이 65바이트(uncompressed point)");
assert(body.readUInt32BE(16) === 4096, "record size 4096");

// ---- 2. VAPID 키 생성 ----
const vapid = wp.generateVapidKeys();
assert(fromB64url(vapid.publicKey).length === 65 && fromB64url(vapid.publicKey)[0] === 0x04, "VAPID 공개키 65바이트 uncompressed");
assert(vapid.jwk && vapid.jwk.d, "VAPID jwk에 private d 포함");

// ---- 3. VAPID JWT 서명 + 검증 ----
const header = wp.vapidAuthHeader("https://fcm.googleapis.com/fcm/send/abc123", vapid, "mailto:test@x.com");
assert(header.startsWith("vapid t=") && header.includes(", k="), "Authorization 헤더 형식 vapid t=..., k=...");
const jwt = header.slice("vapid t=".length, header.indexOf(", k="));
const parts = jwt.split(".");
assert(parts.length === 3, "JWT 3-part 구조");
// 공개키로 서명 검증
const pubPoint = fromB64url(vapid.publicKey);
const pubJwk = { kty: "EC", crv: "P-256", x: b64url(pubPoint.subarray(1, 33)), y: b64url(pubPoint.subarray(33, 65)) };
const pubKeyObj = crypto.createPublicKey({ key: pubJwk, format: "jwk" });
const ok = crypto.verify("sha256", Buffer.from(parts[0] + "." + parts[1]), { key: pubKeyObj, dsaEncoding: "ieee-p1363" }, fromB64url(parts[2]));
assert(ok, "JWT ES256 서명 검증 통과");
const claims = JSON.parse(fromB64url(parts[1]).toString());
assert(claims.aud === "https://fcm.googleapis.com", `JWT aud = endpoint origin (${claims.aud})`);
assert(claims.exp > Math.floor(Date.now() / 1000), "JWT exp 미래");

console.log(failed === 0 ? "\n✅ 전부 통과" : `\n❌ ${failed}개 실패`);
process.exit(failed === 0 ? 0 : 1);
