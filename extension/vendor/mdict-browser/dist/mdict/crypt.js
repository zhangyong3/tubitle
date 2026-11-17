"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decrypt = void 0;
const ripemd128_1 = require("../lib/ripemd128");
function decrypt(buf, key) {
    key = ripemd128_1.default(key);
    let byte, keylen = key.length, prev = 0x36, i = 0, len = buf.length;
    for (; i < len; i++) {
        byte = buf[i];
        byte = ((byte >> 4) | (byte << 4));
        byte = byte ^ prev ^ (i & 0xFF) ^ key[i % keylen];
        prev = buf[i];
        buf[i] = byte;
    }
    return buf;
}
exports.decrypt = decrypt;
