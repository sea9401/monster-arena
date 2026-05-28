// 의존성 0 Web Push 모듈 — Node 내장 crypto만 사용.
// RFC 8291(aes128gcm 페이로드 암호화) + RFC 8292(VAPID) 직접 구현.
// 외부 web-push 라이브러리 대신, 서버의 "의존성 0" 기조를 유지하기 위함.
"use strict";

const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

// ---------- VAPID 키 생성/임포트 ----------
// JWK 형태로 저장(영속·이식 용이). 반환: { publicKey(b64url uncompressed point), privateKey(b64url d), jwk }
function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pubJwk = publicKey.export({ format: "jwk" });
  const privJwk = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([0x04]), fromB64url(pubJwk.x), fromB64url(pubJwk.y)]);
  return {
    publicKey: b64url(point),
    privateKey: privJwk.d,
    jwk: privJwk, // {kty,crv,x,y,d}
  };
}

function privateKeyObjFromJwk(jwk) {
  return crypto.createPrivateKey({ key: jwk, format: "jwk" });
}

// ---------- VAPID JWT(ES256) ----------
function vapidAuthHeader(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12h
  const payload = b64url(JSON.stringify({ aud, exp, sub: subject || "mailto:admin@example.com" }));
  const signingInput = header + "." + payload;
  const keyObj = privateKeyObjFromJwk(vapid.jwk);
  // ieee-p1363 → raw r||s 64바이트(JOSE 형식). 기본 DER는 안 됨.
  const sig = crypto.sign("sha256", Buffer.from(signingInput), { key: keyObj, dsaEncoding: "ieee-p1363" });
  const jwt = signingInput + "." + b64url(sig);
  return `vapid t=${jwt}, k=${vapid.publicKey}`;
}

// ---------- 페이로드 암호화 (RFC 8291, aes128gcm) ----------
function encryptPayload(payload, uaPublicB64, authSecretB64) {
  const uaPublic = fromB64url(uaPublicB64);     // 수신자 공개키(65바이트 uncompressed)
  const authSecret = fromB64url(authSecretB64); // 16바이트

  // 송신자 임시(ephemeral) ECDH 키쌍
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // 65바이트 uncompressed
  const ecdhSecret = ecdh.computeSecret(uaPublic); // 32바이트 공유 비밀

  const salt = crypto.randomBytes(16);

  // IKM = HKDF(salt=authSecret, ikm=ecdhSecret, info="WebPush: info\0"+ua+as, L=32)
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));

  // CEK / NONCE = HKDF(salt=recordSalt, ikm=IKM, info="Content-Encoding: ...\0")
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  // 단일 레코드: plaintext = payload || 0x02(마지막 레코드 구분자)
  const plaintext = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // aes128gcm 헤더: salt(16) || rs(4, BE) || idlen(1) || keyid(asPublic 65)
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  const idlen = Buffer.from([asPublic.length]);
  return Buffer.concat([salt, rs, idlen, asPublic, encrypted]);
}

// ---------- 발송 ----------
// subscription: { endpoint, keys: { p256dh, auth } }
// 반환: Promise<{ ok, statusCode }>  (404/410 → 구독 만료, 호출측에서 제거 권장)
function sendNotification(subscription, payloadStr, vapid, opts = {}) {
  return new Promise((resolve) => {
    let body = Buffer.alloc(0);
    const headers = {
      "TTL": String(opts.ttl || 2419200),
      "Authorization": vapidAuthHeader(subscription.endpoint, vapid, opts.subject),
    };
    if (payloadStr) {
      body = encryptPayload(payloadStr, subscription.keys.p256dh, subscription.keys.auth);
      headers["Content-Encoding"] = "aes128gcm";
      headers["Content-Type"] = "application/octet-stream";
      headers["Content-Length"] = String(body.length);
    } else {
      headers["Content-Length"] = "0";
    }
    let u;
    try { u = new URL(subscription.endpoint); } catch { return resolve({ ok: false, statusCode: 0 }); }
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      { method: "POST", hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + u.search, headers },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode }));
      }
    );
    req.on("error", () => resolve({ ok: false, statusCode: 0 }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, statusCode: 0 }); });
    if (body.length) req.write(body);
    req.end();
  });
}

module.exports = { generateVapidKeys, sendNotification, vapidAuthHeader, encryptPayload };
