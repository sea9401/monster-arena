// 종단간 발송 테스트: 모의 푸시 엔드포인트를 띄우고 sendNotification이 보낸
// 실제 HTTP 요청을 받아 복호화·VAPID JWT 검증.
"use strict";
const crypto = require("crypto");
const http = require("http");
const wp = require("./webpush");

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

const recv = crypto.createECDH("prime256v1");
recv.generateKeys();
const authSecret = crypto.randomBytes(16);
const PAYLOAD = JSON.stringify({ title: "🎁 선물 도착!", body: "친구가 선물을 보냈어요." });

function decrypt(body, recvEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const ecdhSecret = recvEcdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), recvEcdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const enc = ciphertext.subarray(0, ciphertext.length - 16);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(tag);
  let out = Buffer.concat([d.update(enc), d.final()]);
  let end = out.length;
  while (end > 0 && out[end - 1] === 0x00) end--;
  if (end > 0 && out[end - 1] === 0x02) end--;
  return out.subarray(0, end).toString("utf8");
}

let failed = 0;
const ok = (c, m) => { if (!c) { console.error("✗", m); failed++; } else console.log("✓", m); };

const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    try {
      ok(req.headers["content-encoding"] === "aes128gcm", "Content-Encoding: aes128gcm");
      ok(/^vapid t=.+, k=.+$/.test(req.headers["authorization"]), "Authorization vapid 헤더");
      ok(Number(req.headers["ttl"]) > 0, "TTL 헤더");
      const recovered = decrypt(body, recv, authSecret);
      ok(recovered === PAYLOAD, "수신 페이로드 복호화 일치");
    } catch (e) { ok(false, "처리 중 예외: " + e.message); }
    res.writeHead(201); res.end();
  });
});

srv.listen(0, async () => {
  const port = srv.address().port;
  const vapid = wp.generateVapidKeys();
  const subscription = {
    endpoint: `http://localhost:${port}/push/xyz`,
    keys: { p256dh: b64url(recv.getPublicKey()), auth: b64url(authSecret) },
  };
  const r = await wp.sendNotification(subscription, PAYLOAD, vapid, { subject: "mailto:t@x.com" });
  ok(r.ok && r.statusCode === 201, `발송 응답 2xx (status ${r.statusCode})`);
  srv.close();
  console.log(failed === 0 ? "\n✅ E2E 전부 통과" : `\n❌ ${failed}개 실패`);
  process.exit(failed === 0 ? 0 : 1);
});
