export interface HeaderSection {
    GeneratedByEngineVersion: string;
    RequiredEngineVersion: string;
    Encrypted: number;
    Format: string;
    CreationDate: string;
    Compact: string;
    Compat: string;
    KeyCaseSensitive: string;
    Description: string;
    Title: string;
    DataSourceFormat: string;
    StyleSheet: string;
    RegisterBy: string;
    RegCode: string;
    StripKey: string;
}
export interface Keyword {
    num_blocks: number;
    num_entries: number;
    key_index_decomp_len: number;
    key_index_comp_len: number;
    key_blocks_len: number;
    chksum: number;
    len: number;
}
export declare class MDictParser {
    file: string;
    headerSection: any;
    KEY_INDEX: any;
    RECORD_BLOCK_TABLE: {
        alloc: (len: number) => void;
        put: (offset_comp: any, offset_decomp: any) => void;
        find: (keyAt: number) => {
            block_no: number;
            comp_offset: any;
            comp_size: number;
            decomp_offset: any;
            decomp_size: number;
        };
    };
    ext: any;
    read: any;
    scan: any;
    adaptKey: any;
    private keywordIndexDecryptor;
    StyleSheet: any;
    slicedKeyBlock: any;
    constructor(file: string);
    init(): Promise<void>;
    private read_header_sect;
    private read_keyword_summary;
    private read_keyword_index;
    private read_record_summary;
    private read_record_block;
}
