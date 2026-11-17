"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MDictParser = void 0;
const util_1 = require("./util");
const crypt_1 = require("./crypt");
const Scan_1 = require("./Scan");
class MDictParser {
    constructor(file) {
        this.RECORD_BLOCK_TABLE = util_1.createRecordBlockTable();
        this.file = file;
        this.ext = util_1.getExtension(file);
        this.read = util_1.readFile.bind(null, this.file);
    }
    async init() {
        let pos = 0;
        await this.read(0, 4).then(async (data) => {
            const headerLength = new util_1.dataView(data).getUint32(0);
            const res = await this.read(4, headerLength + 48);
            const headerRemainLen = await this.read_header_sect(res, headerLength);
            pos += headerRemainLen + 4;
            return this.read_keyword_summary(res, headerRemainLen);
        }).then(async (keyword) => {
            pos += keyword.len;
            const res = await this.read(pos, keyword.key_index_comp_len);
            this.KEY_INDEX = await this.read_keyword_index(res, keyword);
            pos += keyword.key_index_comp_len;
            this.slicedKeyBlock = this.read(pos, keyword.key_blocks_len);
            pos += keyword.key_blocks_len;
            return this.read_record_summary(await this.read(pos, 32), pos);
        }).then(async (recordSummary) => {
            pos += recordSummary.len;
            await this.read_record_block(await this.read(pos, recordSummary.index_len), recordSummary);
        });
    }
    read_header_sect(input, len) {
        let header_str = util_1.readUTF16(input, len).replace(/\0$/, '');
        const doc = util_1.parseXml(header_str);
        let xml = doc.getElementsByTagName('Dictionary')[0];
        if (!xml)
            xml = doc.getElementsByTagName('Library_Data')[0];
        let attrs = {
            GeneratedByEngineVersion: '',
            RequiredEngineVersion: '',
            Encrypted: 0,
            Format: '',
            CreationDate: '',
            Compact: '',
            Compat: '',
            KeyCaseSensitive: '',
            Description: '',
            Title: '',
            DataSourceFormat: '',
            StyleSheet: '',
            RegisterBy: '',
            RegCode: '',
            StripKey: ''
        };
        for (let i = 0, item; i < xml.attributes.length; i++) {
            item = xml.attributes[i];
            attrs[item.nodeName] = item.nodeValue;
        }
        this.headerSection = attrs;
        attrs.Encrypted = parseInt(String(attrs.Encrypted), 10) || 0;
        this.scan = new Scan_1.Scan(attrs);
        if (attrs.Encrypted & 0x02)
            this.keywordIndexDecryptor = crypt_1.decrypt;
        this.adaptKey = util_1.getAdaptKey(attrs, this.ext);
        this.StyleSheet = util_1.getGlobalStyle(attrs.StyleSheet);
        return len + 4;
    }
    read_keyword_summary(input, offset) {
        const scanner = this.scan.init(input).forward(offset);
        return {
            num_blocks: scanner.readNum(),
            num_entries: scanner.readNum(),
            key_index_decomp_len: scanner.v2 && scanner.readNum(),
            key_index_comp_len: scanner.readNum(),
            key_blocks_len: scanner.readNum(),
            chksum: scanner.checksumV2(),
            len: scanner.offset - offset,
        };
    }
    read_keyword_index(input, keyword_summary) {
        let scanner = this.scan.init(input).readBlock(keyword_summary.key_index_comp_len, keyword_summary.key_index_decomp_len, this.keywordIndexDecryptor), keyword_index = Array(keyword_summary.num_blocks), offset = 0;
        for (let i = 0, size; i < keyword_summary.num_blocks; i++) {
            keyword_index[i] = {
                num_entries: [scanner.readNum(), size = scanner.readShort()][0],
                first_word: [scanner.readTextSized(size), size = scanner.readShort()][0],
                last_word: scanner.readTextSized(size),
                comp_size: size = scanner.readNum(),
                decomp_size: scanner.readNum(),
                offset: offset,
                index: i
            };
            offset += size;
        }
        return keyword_index;
    }
    read_record_summary(input, pos) {
        let scanner = this.scan.init(input), record_summary = {
            num_blocks: scanner.readNum(),
            num_entries: scanner.readNum(),
            index_len: scanner.readNum(),
            blocks_len: scanner.readNum(),
            len: scanner.offset,
            block_pos: 0
        };
        record_summary.block_pos = pos + record_summary.index_len + record_summary.len;
        return record_summary;
    }
    read_record_block(input, record_summary) {
        let scanner = this.scan.init(input), size = record_summary.num_blocks, record_index = Array(size), p0 = record_summary.block_pos, p1 = 0;
        this.RECORD_BLOCK_TABLE.alloc(size + 1);
        for (let i = 0, rdx; i < size; i++) {
            record_index[i] = rdx = {
                comp_size: scanner.readNum(),
                decomp_size: scanner.readNum()
            };
            this.RECORD_BLOCK_TABLE.put(p0, p1);
            p0 += rdx.comp_size;
            p1 += rdx.decomp_size;
        }
        this.RECORD_BLOCK_TABLE.put(p0, p1);
    }
}
exports.MDictParser = MDictParser;
