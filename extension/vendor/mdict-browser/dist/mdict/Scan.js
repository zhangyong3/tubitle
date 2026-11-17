"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scan = void 0;
const lzo1x_1 = require("../lib/lzo1x");
const pako_1 = require("pako");
const util_1 = require("./util");
class Scan {
    constructor(attrs) {
        attrs.Encoding = attrs.Encoding || 'UTF-16';
        this.searchTextLen = (dv, offset) => {
            let mark = offset;
            if (attrs.Encoding === 'UTF-16') {
                while (this.dv.getUint16(offset)) {
                    offset += this.bpu;
                }
                return offset - mark;
            }
            else {
                while (dv.getUint8(offset++)) {
                }
                return offset - mark - 1;
            }
        };
        this.decoder = new util_1.textDecoder(attrs.Encoding || 'UTF-16LE');
        this.bpu = (attrs.Encoding === 'UTF-16') ? 2 : 1;
        this.readShort = () => this.readUint8();
        this.readNum = () => this.readInt();
        if (parseInt(attrs.GeneratedByEngineVersion, 10) >= 2.0) {
            this.v2 = true;
            this.tail = this.bpu;
            this.readNum = () => {
                this.forward(4);
                return this.readInt();
            };
            this.readShort = () => this.readUint16();
            this.checksumV2 = () => this.checksum();
        }
        else {
            this.tail = 0;
        }
    }
    init(buf) {
        this.offset = 0;
        this.buf = buf;
        this.dv = new util_1.dataView(buf);
        return this;
    }
    forward(len) {
        this.offset += len;
        return this;
    }
    readInt() {
        return [this.dv.getUint32(this.offset), this.forward(4)][0];
    }
    readUint16() {
        return [this.dv.getUint16(this.offset), this.forward(2)][0];
    }
    readUint8() {
        return [this.dv.getUint8(this.offset), this.forward(1)][0];
    }
    readText() {
        let len = this.searchTextLen(this.dv, this.offset);
        return [this.decoder.decode(util_1.newUint8Array(this.buf, this.offset, len)), this.forward(len + this.bpu)][0];
    }
    readTextSized(len) {
        len *= this.bpu;
        return [this.decoder.decode(util_1.newUint8Array(this.buf, this.offset, len)), this.forward(len + this.tail)][0];
    }
    checksum() {
        this.forward(4);
    }
    readBlock(len, expectedBufSize, decryptor) {
        let comp_type = this.dv.getUint8(this.offset);
        if (comp_type === 0) {
            if (this.v2)
                this.forward(8);
            return this;
        }
        else {
            let tmp;
            this.offset += 8;
            len -= 8;
            if (util_1.isBrowser) {
                tmp = new Uint8Array(this.buf, this.offset, len);
            }
            else {
                tmp = new Uint8Array(len);
                this.buf.copy(tmp, 0, this.offset, this.offset + len);
            }
            if (decryptor) {
                let passkey = new Uint8Array(8);
                if (util_1.isBrowser) {
                    passkey.set(new Uint8Array(this.buf, this.offset - 4, 4));
                }
                else {
                    this.buf.copy(passkey, 0, this.offset - 4, this.offset);
                }
                passkey.set([0x95, 0x36, 0x00, 0x00], 4);
                tmp = decryptor(tmp, passkey);
            }
            tmp = comp_type === 2 ? pako_1.inflate(tmp) : lzo1x_1.lzo.decompress(tmp);
            this.forward(len);
            return this.init(util_1.isBrowser ? tmp.buffer : Buffer.from(tmp));
        }
    }
    readRaw(len) {
        return this.buf.slice(this.offset, this.offset + len);
    }
}
exports.Scan = Scan;
