"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRes = exports.getGlobalStyle = exports.createRecordBlockTable = exports.getAdaptKey = exports.readUTF16 = exports.isTrue = exports.parseXml = exports.REGEXP_STRIPKEY = exports.getExtension = exports.readFile = exports.newUint8Array = exports.resolve = exports.textDecoder = exports.dataView = exports.isBrowser = void 0;
exports.isBrowser = true;
let dataView = DataView, textDecoder = TextDecoder, parse = DOMParser;
exports.dataView = dataView;
exports.textDecoder = textDecoder;
function resolve(value) {
    return Promise.resolve(value);
}
exports.resolve = resolve;
function newUint8Array(buf, offset, len) {
    if (!exports.isBrowser) {
        const ret = new Uint8Array(len);
        buf.copy(ret, 0, offset, offset + len);
        return ret;
    }
    else {
        return new Uint8Array(buf, offset, len);
    }
}
exports.newUint8Array = newUint8Array;
async function readFile(file, offset, len) {
    return file.slice(offset, offset + len).arrayBuffer();
}
exports.readFile = readFile;
exports.getExtension = file => /(?:\.([^.]+))?$/.exec(file.name || String(file))[1];
exports.REGEXP_STRIPKEY = {
    'mdx': /[()., '/\\@_-]()/g,
    'mdd': /([.][^.]*$)|[()., '/\\@_-]/g
};
function parseXml(xml) {
    return new parse().parseFromString(xml, 'text/xml');
}
exports.parseXml = parseXml;
function isTrue(v) {
    v = ((v || false) + '').toLowerCase();
    return v === 'yes' || v === 'true';
}
exports.isTrue = isTrue;
function readUTF16(buf, len) {
    return new textDecoder('utf-16le').decode(newUint8Array(buf, 0, len));
}
exports.readUTF16 = readUTF16;
function getAdaptKey(attrs, ext) {
    let regexp = exports.REGEXP_STRIPKEY[ext];
    if (isTrue(attrs.KeyCaseSensitive)) {
        return key => {
            return isTrue(attrs.StripKey) ? key.replace(regexp, '$1') : key;
        };
    }
    else {
        return key => {
            return isTrue(attrs.StripKey || (this.v2 ? '' : 'yes')) ?
                key.toLowerCase().replace(regexp, '$1') :
                key.toLowerCase();
        };
    }
}
exports.getAdaptKey = getAdaptKey;
function createRecordBlockTable() {
    let pos = 0, arr;
    return {
        alloc: function (len) {
            arr = new Uint32Array(len * 2);
        },
        put: function (offset_comp, offset_decomp) {
            arr[pos++] = offset_comp;
            arr[pos++] = offset_decomp;
        },
        find: function (keyAt) {
            let hi = (arr.length >> 1) - 1, lo = 0, i = (lo + hi) >> 1, val = arr[(i << 1) + 1];
            if (keyAt > arr[(hi << 1) + 1] || keyAt < 0)
                return;
            while (true) {
                if (hi - lo <= 1) {
                    if (i < hi) {
                        return {
                            block_no: i,
                            comp_offset: arr[i <<= 1],
                            comp_size: arr[i + 2] - arr[i],
                            decomp_offset: arr[i + 1],
                            decomp_size: arr[i + 3] - arr[i + 1]
                        };
                    }
                    else {
                        return;
                    }
                }
                (keyAt < val) ? hi = i : lo = i;
                i = (lo + hi) >> 1;
                val = arr[(i << 1) + 1];
            }
        },
    };
}
exports.createRecordBlockTable = createRecordBlockTable;
function getGlobalStyle(stylesheet) {
    let res = [], i = 0;
    stylesheet.split(' ').forEach(e => {
        if (!e)
            return;
        if (isNaN(Number(e))) {
            if (!res[i])
                res[i] = [''];
            e.indexOf('/') < 0 ? res[i][0] += (' ' + e) : res[i].push(e);
        }
        else {
            i++;
        }
    });
    return res;
}
exports.getGlobalStyle = getGlobalStyle;
function parseRes(str, style) {
    let result = '';
    let split = str.split('`');
    for (let k = 0; k < split.length; k++) {
        let num = Number(split[k]);
        if (split[k] && num)
            result += (style[num][0] + split[++k] + style[num][1]);
    }
    return result;
}
exports.parseRes = parseRes;
