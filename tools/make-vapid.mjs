#!/usr/bin/env node
// 產生一組 VAPID 金鑰:node tools/make-vapid.mjs
//
// 推播的「寄件人身分」。公鑰給網頁用(公開的,直接貼進程式裡),
// 私鑰是機密,只放在 GitHub Secrets,不要進版本庫、不要貼到聊天室。
//
// 產好之後照 README〈手機提醒〉那一節做兩件事:
//   1. 公鑰貼進 assets/push.js 的 VAPID_PUBLIC_KEY
//   2. 私鑰存成 GitHub repo 的 secret:VAPID_PRIVATE_KEY
//
// 換金鑰會讓所有人既有的訂閱全部失效,要重新開一次提醒,所以產一次就好。

import { generateKeyPairSync } from "node:crypto";

const b64url = (buf) => buf.toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

// Web Push 要的是未壓縮的公鑰點(65 bytes,0x04 開頭),
// 以及 32 bytes 的私鑰純量 —— 都不是 PEM,所以從 JWK 取比較穩。
const pubJwk = publicKey.export({ format: "jwk" });
const privJwk = privateKey.export({ format: "jwk" });

const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const pub = b64url(Buffer.concat([Buffer.from([4]), fromB64url(pubJwk.x), fromB64url(pubJwk.y)]));
const priv = b64url(fromB64url(privJwk.d));

console.log(`
公鑰(貼進 assets/push.js 的 VAPID_PUBLIC_KEY)
${pub}

私鑰(存成 GitHub Secret:VAPID_PRIVATE_KEY,不要進版本庫)
${priv}
`);
