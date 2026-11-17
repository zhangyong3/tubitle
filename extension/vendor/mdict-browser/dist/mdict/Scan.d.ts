export declare class Scan {
    private readonly searchTextLen;
    private decoder;
    private readonly bpu;
    private readShort;
    private readNum;
    private readonly v2;
    private dv;
    private readonly tail;
    private checksumV2;
    private offset;
    private buf;
    constructor(attrs: any);
    init(buf: any): this;
    forward(len: any): this;
    readInt(): any;
    readUint16(): any;
    readUint8(): any;
    readText(): string | this;
    readTextSized(len: any): string | this;
    checksum(): void;
    readBlock(len: any, expectedBufSize: any, decryptor?: any): this;
    readRaw(len: number): any;
}
