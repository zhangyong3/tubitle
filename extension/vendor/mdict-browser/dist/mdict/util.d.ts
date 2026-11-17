import { HeaderSection } from "./mdict-parser";
export declare const isBrowser: boolean;
declare let dataView: any, textDecoder: any;
export { dataView, textDecoder };
export declare function resolve(value: any[]): Promise<any[]>;
export declare function newUint8Array(buf: any, offset: any, len: any): Uint8Array;
export declare function readFile(file: any, offset: number, len: number): Promise<unknown>;
export declare const getExtension: (filename: any) => string;
export declare const REGEXP_STRIPKEY: {
    mdx: RegExp;
    mdd: RegExp;
};
export declare function parseXml(xml: any): any;
export declare function isTrue(v: any): boolean;
export declare function readUTF16(buf: any, len: any): any;
export declare function getAdaptKey(attrs: HeaderSection, ext: any): (key: any) => any;
export declare function createRecordBlockTable(): {
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
export declare function getGlobalStyle(stylesheet: string): any[];
export declare function parseRes(str: string, style: any): string;
